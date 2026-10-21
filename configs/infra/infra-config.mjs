#!/usr/bin/env node
// Config-as-code da infra compartilhada: projects.json (git) + ai-infra/container/.env (segredo)
// → container/generated/ (arquivos derivados, fora do git) + Postgres/Redis/RabbitMQ/Keycloak/pgAdmin.
// Uso e regras: README.md desta pasta. Node 22+, sem dependência. Nunca imprime valor de segredo.
//
//   node infra-config.mjs up                    render → compose up na ordem certa → apply → verify
//   node infra-config.mjs apply [--dry-run]     render + reconcilia os serviços que estão de pé
//   node infra-config.mjs diff                  = apply --dry-run (não muda nada, nem o .env)
//   node infra-config.mjs verify                saúde + muros entre projetos + portas + segredos
//   node infra-config.mjs dashboards export     painéis do Grafana (UI) → container/grafana/dashboards/
//
// Opções: --env=<.env>  --only=postgres,redis,rabbitmq,keycloak,pgadmin (apply)

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const INFRA_ROOT = resolve(HERE, "../..");                 // ai-infra/
const CONTAINER = join(INFRA_ROOT, "container");
const GENERATED = join(CONTAINER, "generated");
const [cmd, ...rest] = process.argv.slice(2);
const args = rest.filter((a) => !a.startsWith("--"));
const opt = Object.fromEntries(
  rest.filter((a) => a.startsWith("--")).map((a) => {
    const [k, ...v] = a.slice(2).split("=");
    return [k, v.length ? v.join("=") : true];
  })
);
const ENV_FILE = resolve(opt.env || join(CONTAINER, ".env"));
const DRY = !!opt["dry-run"] || cmd === "diff" || cmd === "verify";   // verify nunca escreve (nem .env)
const ONLY = opt.only ? String(opt.only).split(",") : null;
const wants = (svc) => !ONLY || ONLY.includes(svc);

if (!["up", "apply", "diff", "verify", "dashboards"].includes(cmd) || (cmd === "dashboards" && args[0] !== "export")) {
  console.error("uso: node infra-config.mjs <up|apply|diff|verify|dashboards export> [opções] — ver README.md");
  process.exit(2);
}

// ───────────────────────── saída ─────────────────────────
const say = {
  step: (t) => console.log(`\n── ${t}`),
  ok: (t) => console.log(`  ✔ ${t}`),
  change: (t) => console.log(`  ${DRY ? "~" : "+"} ${t}`),
  skip: (t) => console.log(`  · ${t}`),
  warn: (t) => console.log(`  ! ${t}`),
  fail: (t) => console.log(`  ✘ ${t}`),
};

// ───────────────────────── .env (segredos) ─────────────────────────
// Mesmo formato do omniroute-config.mjs: preserva linhas/comentários, escrita atômica.
// Senha de humano (admin de cada ferramenta) = ele preenche. Senha de máquina (serviço↔serviço,
// por projeto) = gerada aqui na primeira vez, gravada no .env, nunca impressa.
const HUMAN_KEYS = [
  "POSTGRES_USER", "POSTGRES_PASSWORD", "PGADMIN_DEFAULT_EMAIL", "PGADMIN_DEFAULT_PASSWORD",
  "RABBITMQ_DEFAULT_USER", "RABBITMQ_DEFAULT_PASS", "KEYCLOAK_ADMIN", "KEYCLOAK_ADMIN_PASSWORD",
  "GF_SECURITY_ADMIN_USER", "GF_SECURITY_ADMIN_PASSWORD", "OMNIROUTE_INITIAL_PASSWORD",
];
const INFRA_SECRETS = ["PG_KEYCLOAK_PASSWORD", "PG_MONITORING_PASSWORD", "REDIS_ADMIN_PASSWORD", "REDIS_EXPORTER_PASSWORD", "OMNIROUTE_REDIS_PASSWORD"];
const GENERATED_HEADER = "INFRA — gerado por infra-config.mjs (não editar o nome)";

const envFile = {
  lines: existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : null,
  get(name) {
    const l = this.lines?.find((x) => x.startsWith(name + "="));
    return l ? l.slice(name.length + 1).replace(/^"(.*)"$/, "$1") : undefined;
  },
  set(name, value) {
    if (/[\r\n]/.test(value)) throw new Error(`segredo ${name} tem quebra de linha`);
    const i = this.lines.findIndex((x) => x.startsWith(name + "="));
    if (i >= 0) this.lines[i] = `${name}=${value}`;
    else {
      if (!this.lines.some((x) => x.includes(GENERATED_HEADER))) {
        while (this.lines.length && this.lines.at(-1) === "") this.lines.pop();
        this.lines.push("", "# =================================", `# = ${GENERATED_HEADER}`, "# =================================");
      }
      this.lines.push(`${name}=${value}`);
    }
    this.dirty = true;
  },
  save() {
    if (!this.dirty) return;
    const tmp = ENV_FILE + ".tmp";
    writeFileSync(tmp, this.lines.join("\n").replace(/\n*$/, "\n"));
    renameSync(tmp, ENV_FILE);
    this.dirty = false;
  },
};
const secret = (name) => envFile.get(name);
const newSecret = () => randomBytes(24).toString("hex");   // hex: seguro em URL, SQL, ACL e connection string
const missingSecrets = [];
// Garante que o segredo de máquina existe; no dry-run só anota que seria gerado.
function ensureSecret(name) {
  if (secret(name)) return secret(name);
  missingSecrets.push(name);
  if (DRY) return "<seria-gerado>";
  envFile.set(name, newSecret());
  return secret(name);
}

// ───────────────────────── manifesto ─────────────────────────
const MANIFEST = JSON.parse(readFileSync(join(HERE, "projects.json"), "utf8"));
const REALM_DEFAULTS = JSON.parse(readFileSync(join(HERE, "keycloak/realm-defaults.json"), "utf8"));
const PROJECTS = Object.entries(MANIFEST.projects).map(([name, p]) => {
  if (!/^[a-z][a-z0-9]{1,30}$/.test(name)) throw new Error(`nome de projeto inválido "${name}": só minúsculas e dígitos (vira banco, role, vhost, realm, prefixo)`);
  return { name, ...p };
});
const P = (p) => `PROJECT_${p.name.toUpperCase()}`;
const pgRoles = (p) => ({
  owner: `${p.name}_owner`,
  app: (p.postgres.roles ?? "infra") === "infra" ? `${p.name}_app` : null,
  connect: `${p.name}_connect`,
  pattern: p.postgres.memberPattern ?? `${p.name}\\_%`,
});
const kcClientId = (p) => `${p.name}-api`;

// Todos os segredos que o manifesto exige (humanos checados, de máquina gerados).
function resolveSecrets() {
  if (!envFile.lines) throw new Error(`${ENV_FILE} não existe — copiar container/examples/env.example e preencher (ver README.md)`);
  const missingHuman = HUMAN_KEYS.filter((k) => !secret(k));
  if (missingHuman.length) throw new Error(`faltam no .env (preenchimento humano): ${missingHuman.join(", ")}`);
  for (const k of INFRA_SECRETS) ensureSecret(k);
  for (const p of PROJECTS) {
    if (p.postgres) { ensureSecret(`${P(p)}_PG_OWNER_PASSWORD`); if (pgRoles(p).app) ensureSecret(`${P(p)}_PG_APP_PASSWORD`); }
    if (p.rabbitmq) ensureSecret(`${P(p)}_RABBITMQ_PASSWORD`);
    if (p.redis) ensureSecret(`${P(p)}_REDIS_PASSWORD`);
    if (p.keycloak) { ensureSecret(`${P(p)}_KEYCLOAK_CLIENT_SECRET`); if (p.keycloak.devUsers?.length ?? 1) ensureSecret(`${P(p)}_KEYCLOAK_DEV_PASSWORD`); }
  }
  if (missingSecrets.length) say.change(`.env: ${DRY ? "geraria" : "gerado"} ${missingSecrets.join(", ")}`);
  if (!DRY) envFile.save();
}

// ───────────────────────── processos ─────────────────────────
function run(bin, argv, { input, env, allowFail } = {}) {
  const r = spawnSync(bin, argv, { input, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1", ...env }, maxBuffer: 64 << 20 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    const msg = (r.stderr || r.stdout || "").trim().split("\n").slice(-6).join("\n");
    throw new Error(`${bin} ${argv.filter((a) => !/PASSWORD|PASS=|AUTH=/.test(a)).slice(0, 6).join(" ")} → saída ${r.status}\n${msg}`);
  }
  return r;
}
const compose = (...a) => run("docker", ["compose", "-f", join(CONTAINER, "docker-compose.yml"), "--env-file", ENV_FILE, ...a]);
const running = (c) => run("docker", ["inspect", "-f", "{{.State.Running}}", c], { allowFail: true }).stdout.trim() === "true";
const health = (c) => run("docker", ["inspect", "-f", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", c], { allowFail: true }).stdout.trim();
async function waitHealthy(containers, timeoutS = 180) {
  const end = Date.now() + timeoutS * 1000;
  for (const c of containers) {
    let h;
    while ((h = health(c)) !== "healthy" && h !== "running") {
      if (Date.now() > end) throw new Error(`${c} não ficou saudável em ${timeoutS}s (estado: ${h || "não existe"}) — ver docker logs ${c}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    say.ok(`${c}: ${h}`);
  }
}

// psql dentro do container como superusuário. SQL sempre por stdin (nunca na linha de comando).
// SET pgaudit.log/log_statement = none: o pgAudit loga ALTER ROLE ... PASSWORD com a senha em texto.
function psql(db, sql, { allowFail } = {}) {
  const head = "SET pgaudit.log = 'none'; SET log_statement = 'none';\n";
  return run("docker", ["exec", "-i", "postgres", "psql", "-U", secret("POSTGRES_USER"), "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-At", "-f", "-"],
    { input: head + sql, allowFail }).stdout.trim();
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

async function http(method, url, { auth, bearer, body, form } = {}) {
  const headers = {};
  if (auth) headers.authorization = "Basic " + Buffer.from(auth.join(":")).toString("base64");
  if (bearer) headers.authorization = "Bearer " + bearer;
  let payload;
  if (form) { headers["content-type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}
async function must(method, url, o) {
  const r = await http(method, url, o);
  if (!r.ok) throw new Error(`${method} ${url.replace(/\?.*/, "")} → HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

// ───────────────────────── render (container/generated/) ─────────────────────────
function writeGenerated(rel, content) {
  const file = join(GENERATED, rel);
  const old = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (old === content) return say.ok(`generated/${rel}`);
  say.change(`generated/${rel}${old === null ? " (novo)" : " (atualizado)"}`);
  if (DRY) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + ".tmp", content);
  renameSync(file + ".tmp", file);
}
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function render() {
  say.step("render → container/generated/");
  // Redis: default desligado; cada projeto só "<projeto>:*" (chaves e canais), sem comando perigoso nem SCAN.
  // (arquivo .acl não aceita comentário — o aviso de "gerado, não editar" fica no redis.conf)
  const acl = [
    "user default off resetkeys resetchannels -@all",
    "user healthcheck on nopass resetkeys resetchannels -@all +ping",
    `user admin on #${sha256(secret("REDIS_ADMIN_PASSWORD") ?? "")} ~* &* +@all`,
    `user exporter on #${sha256(secret("REDIS_EXPORTER_PASSWORD") ?? "")} resetkeys resetchannels -@all +@connection +info +ping +config|get +client|list +slowlog +latency +memory|stats +cluster|info +select +dbsize`,
    ...PROJECTS.filter((p) => p.redis).map((p) =>
      `user ${p.name} on #${sha256(secret(`${P(p)}_REDIS_PASSWORD`) ?? "")} resetkeys ~${p.name}:* resetchannels &${p.name}:* +@all -@dangerous -scan`),
  ].join("\n") + "\n";
  writeGenerated("redis/users.acl", acl);

  // Prometheus: /metrics da API de cada projeto (file_sd — recarrega sozinho).
  const targets = PROJECTS.filter((p) => p.metrics).map((p) => ({ targets: [p.metrics], labels: { project: p.name } }));
  writeGenerated("prometheus/projects.json", JSON.stringify(targets, null, 2) + "\n");

  // pgAdmin: grupo Infra (superusuário) + um grupo por projeto, conectando com a role dona e vendo só o próprio banco.
  const servers = { "1": { Name: "postgres (superusuário)", Group: "Infra", Host: "postgres", Port: 5432, MaintenanceDB: "postgres", Username: secret("POSTGRES_USER"), SSLMode: "prefer" } };
  PROJECTS.filter((p) => p.postgres).forEach((p, i) => {
    servers[String(i + 2)] = { Name: `${p.name} (${pgRoles(p).owner})`, Group: p.name, Host: "postgres", Port: 5432, MaintenanceDB: p.name, Username: pgRoles(p).owner, SSLMode: "prefer", DBRestriction: p.name };
  });
  writeGenerated("pgadmin/servers.json", JSON.stringify({ Servers: servers }, null, 2) + "\n");

  // Por projeto: tudo que o app precisa pra rodar em dev, nos nomes do contrato (ai-base/docs/agents/infra-local.md).
  for (const p of PROJECTS) {
    const kv = projectSettings(p);
    const env = ["# gerado por ai-infra/configs/infra/infra-config.mjs — NÃO versionar, NÃO editar (refeito a cada apply)",
      `# projeto: ${p.name}. .NET: Get-Content <este .json> | dotnet user-secrets set --project <csproj>`,
      ...Object.entries(kv).map(([k, v]) => `${k.replace(/:/g, "__")}=${v}`)].join("\n") + "\n";
    writeGenerated(`projects/${p.name}.env`, env);
    writeGenerated(`projects/${p.name}.secrets.json`, JSON.stringify(kv, null, 2) + "\n");
  }
}

// Chaves no formato de configuração do .NET ("Seção:Chave"); no .env viram "Seção__Chave".
function projectSettings(p) {
  const kv = {};
  if (p.postgres) {
    const r = pgRoles(p);
    const cs = (user, pass) => `Host=localhost;Port=5432;Database=${p.name};Username=${user};Password=${pass}`;
    if (r.app) kv["ConnectionStrings:Postgres"] = cs(r.app, secret(`${P(p)}_PG_APP_PASSWORD`));
    kv["ConnectionStrings:PostgresMigrations"] = cs(r.owner, secret(`${P(p)}_PG_OWNER_PASSWORD`));
  }
  if (p.redis) {
    kv["ConnectionStrings:Redis"] = `localhost:6379,user=${p.name},password=${secret(`${P(p)}_REDIS_PASSWORD`)},abortConnect=false`;
    kv["Redis:KeyPrefix"] = `${p.name}:`;
  }
  if (p.rabbitmq) {
    Object.assign(kv, {
      "RabbitMQ:Host": "localhost", "RabbitMQ:Port": "5672", "RabbitMQ:VirtualHost": p.name,
      "RabbitMQ:UserName": p.name, "RabbitMQ:Password": secret(`${P(p)}_RABBITMQ_PASSWORD`),
    });
  }
  if (p.keycloak) {
    Object.assign(kv, {
      "Keycloak:Authority": `http://localhost:8080/realms/${p.name}`, "Keycloak:Realm": p.name,
      "Keycloak:ClientId": kcClientId(p), "Keycloak:ClientSecret": secret(`${P(p)}_KEYCLOAK_CLIENT_SECRET`),
    });
  }
  kv["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://localhost:4318";
  kv["OTEL_EXPORTER_OTLP_PROTOCOL"] = "http/protobuf";
  kv["OTEL_RESOURCE_ATTRIBUTES"] = `service.namespace=${p.name}`;
  return kv;
}

// ───────────────────────── Postgres ─────────────────────────
// Muro: REVOKE CONNECT de PUBLIC em todo banco; cada projeto conecta só no próprio via o grupo <p>_connect.
async function applyPostgres() {
  say.step("Postgres");
  if (!running("postgres")) return say.warn("container postgres fora — pulado");
  const roles = new Set(psql("postgres", "SELECT rolname FROM pg_roles;").split("\n"));
  const dbs = new Set(psql("postgres", "SELECT datname FROM pg_database WHERE NOT datistemplate;").split("\n"));
  const sql = [];
  const role = (name, { login = true, pass } = {}) => {
    if (!roles.has(name)) { say.change(`role ${name}`); sql.push(`CREATE ROLE ${ident(name)} ${login ? "LOGIN" : "NOLOGIN"};`); }
    if (pass) sql.push(`ALTER ROLE ${ident(name)} PASSWORD ${lit(pass)};`);
  };
  role("keycloak", { pass: secret("PG_KEYCLOAK_PASSWORD") });
  role("monitoring", { pass: secret("PG_MONITORING_PASSWORD") });
  sql.push(`GRANT pg_monitor TO monitoring;`);
  for (const p of PROJECTS.filter((x) => x.postgres)) {
    const r = pgRoles(p);
    role(r.owner, { pass: secret(`${P(p)}_PG_OWNER_PASSWORD`) });
    role(r.connect, { login: false });
    if (r.app) role(r.app, { pass: secret(`${P(p)}_PG_APP_PASSWORD`) });
  }
  if (!DRY && sql.length) psql("postgres", sql.join("\n"));

  // bancos (CREATE DATABASE não roda em bloco/transação → um por vez)
  const created = [];
  const owners = { keycloak: "keycloak", ...Object.fromEntries(PROJECTS.filter((p) => p.postgres).map((p) => [p.name, pgRoles(p).owner])) };
  for (const [db, owner] of Object.entries(owners)) {
    if (!dbs.has(db)) {
      say.change(`banco ${db} (dono ${owner})`);
      if (!DRY) psql("postgres", `CREATE DATABASE ${ident(db)} OWNER ${ident(owner)};`);
      created.push(db);
    }
  }
  if (DRY) {
    const open = psql("postgres", "SELECT datname FROM pg_database WHERE NOT datistemplate AND has_database_privilege('public', datname, 'CONNECT');").split("\n").filter(Boolean);
    if (open.length) say.change(`muro: PUBLIC ainda conecta em ${open.join(", ")}`);
    return;
  }

  // script inicial do projeto: só quando o banco acabou de nascer (não precisa ser idempotente)
  for (const p of PROJECTS.filter((x) => x.postgres?.initScript && created.includes(x.name))) {
    say.change(`${p.name}: ${p.postgres.initScript}`);
    psql(p.name, readFileSync(join(INFRA_ROOT, p.postgres.initScript), "utf8"));
  }

  // dono de cada banco + pgaudit em cada um
  for (const [db, owner] of Object.entries(owners)) {
    psql("postgres", `ALTER DATABASE ${ident(db)} OWNER TO ${ident(owner)};`);
    psql(db, "CREATE EXTENSION IF NOT EXISTS pgaudit;");
  }
  // keycloak antes usava o superusuário: as tabelas dele passam pra role keycloak
  const moved = psql("keycloak", `
    DO $$ DECLARE r record; n int := 0; BEGIN
      FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
               WHERE s.nspname = 'public' AND c.relkind IN ('r','S','v','m','p') AND pg_get_userbyid(c.relowner) <> 'keycloak'
               AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a','i'))) LOOP
        EXECUTE format('ALTER %s public.%I OWNER TO keycloak',
          CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END, r.relname);
        n := n + 1;
      END LOOP;
      RAISE NOTICE '%', n;
    END $$;
    SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND pg_get_userbyid(c.relowner) <> 'keycloak';`);
  if (moved !== "0") say.warn(`keycloak: ${moved} objeto(s) do schema public ainda não são da role keycloak`);

  // muros
  const allDbs = psql("postgres", "SELECT datname FROM pg_database WHERE NOT datistemplate;").split("\n").filter(Boolean);
  const wall = allDbs.map((d) => `REVOKE ALL ON DATABASE ${ident(d)} FROM PUBLIC;`);
  wall.push(`GRANT CONNECT ON DATABASE postgres TO monitoring;`);
  for (const p of PROJECTS.filter((x) => x.postgres)) {
    const r = pgRoles(p);
    wall.push(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(p.name)} TO ${ident(r.connect)};`);
    wall.push(`GRANT ${ident(r.connect)} TO ${[r.owner, r.app].filter(Boolean).map(ident).join(", ")};`);
    wall.push(`DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE ${lit(r.pattern)} AND rolname NOT IN (${lit(r.connect)}) LOOP
        EXECUTE format('GRANT %I TO %I', ${lit(r.connect)}, r.rolname);
      END LOOP; END $$;`);
  }
  psql("postgres", wall.join("\n"));
  // owner/app padrão (roles: "infra"): app só DML no que o owner criar, em qualquer schema
  for (const p of PROJECTS.filter((x) => x.postgres && pgRoles(x).app)) {
    const { owner, app } = pgRoles(p);
    psql(p.name, `
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO ${ident(app)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} GRANT USAGE ON SCHEMAS TO ${ident(app)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(app)};
      ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} GRANT USAGE, SELECT ON SEQUENCES TO ${ident(app)};`);
  }
  say.ok(`roles, bancos, pgaudit e muros: ${Object.keys(owners).join(", ")}`);
}

// ───────────────────────── Redis ─────────────────────────
async function applyRedis() {
  say.step("Redis");
  if (!running("redis")) return say.warn("container redis fora — pulado (sobe com generated/redis/users.acl já pronto)");
  if (DRY) return say.skip("ACL LOAD recarregaria generated/redis/users.acl");
  const r = run("docker", ["exec", "-e", `REDISCLI_AUTH=${secret("REDIS_ADMIN_PASSWORD")}`, "redis", "redis-cli", "--no-auth-warning", "--user", "admin", "ACL", "LOAD"], { allowFail: true });
  const out = (r.stdout + r.stderr).trim();
  if (out === "OK") return say.ok(`ACL recarregada (${PROJECTS.filter((p) => p.redis).map((p) => p.name).join(", ")})`);
  say.warn(`ACL LOAD: ${out.split("\n")[0]} — container ainda com config antiga? recriando`);
  compose("up", "-d", "--force-recreate", "redis");
  await waitHealthy(["redis"], 60);
}

// ───────────────────────── RabbitMQ ─────────────────────────
// Muro: vhost + usuário por projeto, permissão só no próprio vhost, sem tag de gerenciamento.
async function applyRabbit() {
  say.step("RabbitMQ");
  if (!running("rabbitmq")) return say.warn("container rabbitmq fora — pulado");
  const base = "http://127.0.0.1:15672/api";
  const auth = [secret("RABBITMQ_DEFAULT_USER"), secret("RABBITMQ_DEFAULT_PASS")];
  const vhosts = new Set((await must("GET", `${base}/vhosts`, { auth })).map((v) => v.name));
  const users = new Set((await must("GET", `${base}/users`, { auth })).map((u) => u.name));
  for (const p of PROJECTS.filter((x) => x.rabbitmq)) {
    const v = encodeURIComponent(p.name);
    if (!vhosts.has(p.name)) { say.change(`vhost ${p.name}`); if (!DRY) await must("PUT", `${base}/vhosts/${v}`, { auth, body: { description: `projeto ${p.name}` } }); }
    if (!users.has(p.name)) say.change(`usuário ${p.name}`);
    if (DRY) continue;
    await must("PUT", `${base}/users/${v}`, { auth, body: { password: secret(`${P(p)}_RABBITMQ_PASSWORD`), tags: "" } });
    await must("PUT", `${base}/permissions/${v}/${v}`, { auth, body: { configure: ".*", write: ".*", read: ".*" } });
    await must("PUT", `${base}/permissions/${v}/${encodeURIComponent(auth[0])}`, { auth, body: { configure: ".*", write: ".*", read: ".*" } });
    for (const perm of await must("GET", `${base}/users/${v}/permissions`, { auth })) {
      if (perm.vhost !== p.name) { say.change(`remove permissão de ${p.name} no vhost ${perm.vhost}`); await must("DELETE", `${base}/permissions/${encodeURIComponent(perm.vhost)}/${v}`, { auth }); }
    }
    say.ok(`${p.name}: vhost, usuário e permissões`);
  }
}

// ───────────────────────── Keycloak ─────────────────────────
// Muro: realm por projeto. Padrão de client (BFF, ver ai-base/docs/agents/infra-local.md):
// <projeto>-api confidencial, Authorization Code + PKCE S256, sem implicit/password grant.
async function kcToken() {
  const r = await must("POST", "http://127.0.0.1:8080/realms/master/protocol/openid-connect/token",
    { form: { grant_type: "password", client_id: "admin-cli", username: secret("KEYCLOAK_ADMIN"), password: secret("KEYCLOAK_ADMIN_PASSWORD") } });
  return r.access_token;
}
function kcClientRep(p) {
  const k = p.keycloak;
  return {
    clientId: kcClientId(p), name: `${p.name} API (BFF)`, protocol: "openid-connect", enabled: true,
    publicClient: false, clientAuthenticatorType: "client-secret", secret: secret(`${P(p)}_KEYCLOAK_CLIENT_SECRET`),
    standardFlowEnabled: true, implicitFlowEnabled: false, directAccessGrantsEnabled: !!k.directAccessGrants,
    serviceAccountsEnabled: (k.serviceAccountRoles?.length ?? 0) > 0,
    redirectUris: k.redirectUris ?? [], webOrigins: k.webOrigins ?? [], frontchannelLogout: true,
    attributes: { "pkce.code.challenge.method": "S256", "post.logout.redirect.uris": (k.postLogoutRedirectUris ?? []).join("##") },
  };
}
async function applyKeycloak() {
  say.step("Keycloak");
  if (!running("keycloak")) return say.warn("container keycloak fora — pulado");
  const KC = "http://127.0.0.1:8080/admin/realms";
  const bearer = await kcToken();
  const kc = (m, path, body) => must(m, `${KC}${path}`, { bearer, body });
  for (const p of PROJECTS.filter((x) => x.keycloak)) {
    const r = p.name, k = p.keycloak;
    const exists = (await http("GET", `${KC}/${r}`, { bearer })).ok;
    if (!exists) { say.change(`realm ${r}`); if (!DRY) await kc("POST", "", { realm: r, ...REALM_DEFAULTS }); }
    if (DRY) { say.skip(`${r}: realm/client/roles/usuários reaplicados no apply (idempotente)`); continue; }
    await kc("PUT", `/${r}`, { realm: r, ...REALM_DEFAULTS });

    // roles do realm + roles padrão (todo usuário novo ganha)
    for (const name of k.realmRoles ?? []) {
      if (!(await http("GET", `${KC}/${r}/roles/${encodeURIComponent(name)}`, { bearer })).ok) { say.change(`${r}: role ${name}`); await kc("POST", `/${r}/roles`, { name }); }
    }
    const defaults = await Promise.all((k.defaultRoles ?? []).map((n) => kc("GET", `/${r}/roles/${encodeURIComponent(n)}`)));
    if (defaults.length) await kc("POST", `/${r}/roles/default-roles-${r}/composites`, defaults);

    // client <projeto>-api
    const rep = kcClientRep(p);
    let [client] = await kc("GET", `/${r}/clients?clientId=${encodeURIComponent(rep.clientId)}`);
    if (!client) { say.change(`${r}: client ${rep.clientId}`); await kc("POST", `/${r}/clients`, rep); [client] = await kc("GET", `/${r}/clients?clientId=${encodeURIComponent(rep.clientId)}`); }
    else await kc("PUT", `/${r}/clients/${client.id}`, { ...client, ...rep, attributes: { ...client.attributes, ...rep.attributes } });
    // audience: o access token sai com aud=<projeto>-api (validação de audience na API)
    const mappers = await kc("GET", `/${r}/clients/${client.id}/protocol-mappers/models`);
    if (!mappers.some((m) => m.name === "audience")) {
      await kc("POST", `/${r}/clients/${client.id}/protocol-mappers/models`, {
        name: "audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper",
        config: { "included.client.audience": rep.clientId, "access.token.claim": "true", "id.token.claim": "false" },
      });
    }
    // service account (ex.: Admin API pra criar usuário) — roles "<client>/<role>"
    if (rep.serviceAccountsEnabled) {
      const sa = await kc("GET", `/${r}/clients/${client.id}/service-account-user`);
      for (const ref of k.serviceAccountRoles) {
        const [cid, role] = ref.split("/");
        const [target] = await kc("GET", `/${r}/clients?clientId=${encodeURIComponent(cid)}`);
        const roleRep = await kc("GET", `/${r}/clients/${target.id}/roles/${encodeURIComponent(role)}`);
        await kc("POST", `/${r}/users/${sa.id}/role-mappings/clients/${target.id}`, [roleRep]);
      }
    }
    // usuários de teste (senha única por projeto, no .env)
    for (const u of k.devUsers ?? [{ username: "dev" }]) {
      let [user] = await kc("GET", `/${r}/users?username=${encodeURIComponent(u.username)}&exact=true`);
      if (!user) {
        say.change(`${r}: usuário de teste ${u.username}`);
        await kc("POST", `/${r}/users`, { username: u.username, email: `${u.username}@${r}.local`, firstName: "Dev", lastName: r, enabled: true, emailVerified: true });
        [user] = await kc("GET", `/${r}/users?username=${encodeURIComponent(u.username)}&exact=true`);
      }
      await kc("PUT", `/${r}/users/${user.id}/reset-password`, { type: "password", value: secret(`${P(p)}_KEYCLOAK_DEV_PASSWORD`), temporary: false });
      const roles = await Promise.all((u.roles ?? []).map((n) => kc("GET", `/${r}/roles/${encodeURIComponent(n)}`)));
      if (roles.length) await kc("POST", `/${r}/users/${user.id}/role-mappings/realm`, roles);
    }
    say.ok(`${r}: realm, client ${rep.clientId}, roles, usuários de teste`);
  }
}

// ───────────────────────── pgAdmin / Prometheus / Alloy ─────────────────────────
async function applyPgadmin() {
  say.step("pgAdmin");
  if (!running("pgadmin")) return say.warn("container pgadmin fora — pulado");
  if (DRY) return say.skip("recarregaria generated/pgadmin/servers.json");
  run("docker", ["exec", "pgadmin", "sh", "-c", `cd /pgadmin4 && /venv/bin/python3 setup.py load-servers /infra/servers.json --user "$PGADMIN_DEFAULT_EMAIL" --replace`]);
  say.ok("servidores recarregados (um grupo por projeto)");
}
async function reloadObservability() {
  say.step("Prometheus / Alloy");
  if (DRY) return say.skip("recarregaria a config (POST /-/reload)");
  for (const [name, url] of [["prometheus", "http://127.0.0.1:9090/-/reload"], ["alloy", "http://127.0.0.1:12345/-/reload"]]) {
    if (!running(name)) { say.warn(`${name} fora — pulado`); continue; }
    const r = await http("POST", url).catch((e) => ({ ok: false, status: e.message }));
    r.ok ? say.ok(`${name}: config recarregada`) : say.warn(`${name}: reload → ${r.status}`);
  }
}

// ───────────────────────── verify ─────────────────────────
async function verify() {
  let failures = 0;
  const check = (cond, okMsg, failMsg) => (cond ? say.ok(okMsg) : (failures++, say.fail(failMsg)));

  say.step("containers");
  const services = compose("config", "--services").stdout.trim().split("\n");
  for (const s of services) {
    const c = compose("ps", "-a", "--format", "{{.Name}}\t{{.State}}\t{{.Health}}", s).stdout.trim();
    const [name, state, h] = c.split("\t");
    check(state === "running" && (!h || h === "healthy"), `${name}: ${state}${h ? `/${h}` : ""}`, `${s}: ${c || "não existe"}`);
  }

  say.step("exposição e segredos");
  const ports = run("docker", ["ps", "--filter", "label=com.docker.compose.project=infra", "--format", "{{.Names}} {{.Ports}}"]).stdout.trim().split("\n");
  const exposed = ports.filter((l) => /0\.0\.0\.0:|\[::\]:/.test(l));
  check(!exposed.length, "nenhuma porta fora de 127.0.0.1", `porta exposta na rede: ${exposed.join(" | ")}`);
  const allSecrets = envFile.lines.map((l) => l.split("=")[0]).filter((k) => /PASS|SECRET|KEY/.test(k));
  for (const c of ["postgres", "pgadmin", "keycloak", "rabbitmq", "grafana", "redis", "loki", "alloy", "prometheus"]) {
    if (!running(c)) continue;
    const env = run("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", c]).stdout.split("\n").map((l) => l.split("=")[0]);
    const leaked = env.filter((k) => /^OMNIROUTE_KEY|^OMNIROUTE_CLIENT_KEY|^PROJECT_/.test(k) && allSecrets.includes(k));
    check(!leaked.length, `${c}: só os próprios segredos`, `${c} recebe segredo alheio: ${leaked.join(", ")}`);
  }
  const latest = run("docker", ["ps", "--filter", "label=com.docker.compose.project=infra", "--format", "{{.Image}}"]).stdout.split("\n").filter((i) => /:latest$|^[^:]+$/.test(i) && i && !i.startsWith("infra-"));
  check(!latest.length, "todas as imagens com versão fixa", `imagem sem versão fixa: ${latest.join(", ")}`);

  say.step("muros — Postgres");
  const pgProjects = PROJECTS.filter((p) => p.postgres);
  const dbs = ["postgres", "keycloak", ...pgProjects.map((p) => p.name)];
  for (const p of pgProjects) {
    const { owner } = pgRoles(p);
    const tryConn = (db) => run("docker", ["exec", "-e", `PGPASSWORD=${secret(`${P(p)}_PG_OWNER_PASSWORD`)}`, "postgres", "psql", "-h", "127.0.0.1", "-U", owner, "-d", db, "-Atc", "select 1"], { allowFail: true });
    const own = tryConn(p.name);
    check(own.status === 0, `${owner} → ${p.name}: entra`, `${owner} não entra no próprio banco: ${own.stderr.trim()}`);
    for (const db of dbs.filter((d) => d !== p.name)) {
      const r = tryConn(db);
      check(r.status !== 0 && /permission denied/.test(r.stderr), `${owner} → ${db}: barrado`, `${owner} → ${db}: ${r.status === 0 ? "ENTROU" : r.stderr.trim()}`);
    }
  }
  const publicOpen = psql("postgres", "SELECT string_agg(datname, ', ') FROM pg_database WHERE NOT datistemplate AND has_database_privilege('public', datname, 'CONNECT');");
  check(!publicOpen, "PUBLIC não conecta em nenhum banco", `PUBLIC conecta em: ${publicOpen}`);

  say.step("muros — Redis");
  const rcli = (user, pass, ...cmd) => run("docker", ["exec", "-e", `REDISCLI_AUTH=${pass}`, "redis", "redis-cli", "--no-auth-warning", ...(user ? ["--user", user] : []), ...cmd], { allowFail: true }).stdout.trim();
  check(/NOAUTH|WRONGPASS|denied/i.test(run("docker", ["exec", "redis", "redis-cli", "get", "x"], { allowFail: true }).stdout), "usuário default desligado", "redis aceita comando sem login");
  for (const p of PROJECTS.filter((x) => x.redis)) {
    const pass = secret(`${P(p)}_REDIS_PASSWORD`);
    check(rcli(p.name, pass, "set", `${p.name}:__verify__`, "1", "EX", "10") === "OK", `${p.name}: escreve em ${p.name}:*`, `${p.name}: não escreve no próprio prefixo`);
    for (const [what, cmd] of [["chave alheia", ["get", "outro:__verify__"]], ["KEYS", ["keys", "*"]], ["SCAN", ["scan", "0"]], ["FLUSHALL", ["flushall"]], ["CONFIG", ["config", "get", "*"]]]) {
      check(/NOPERM/i.test(rcli(p.name, pass, ...cmd)), `${p.name}: ${what} barrado`, `${p.name}: ${what} PERMITIDO`);
    }
  }

  say.step("muros — RabbitMQ");
  const rabbitAuth = [secret("RABBITMQ_DEFAULT_USER"), secret("RABBITMQ_DEFAULT_PASS")];
  for (const p of PROJECTS.filter((x) => x.rabbitmq)) {
    const perms = (await http("GET", `http://127.0.0.1:15672/api/users/${p.name}/permissions`, { auth: rabbitAuth })).json;
    const vhosts = Array.isArray(perms) ? perms.map((x) => x.vhost) : [];
    check(vhosts.length === 1 && vhosts[0] === p.name, `${p.name}: permissão só no vhost ${p.name}`, `${p.name}: permissões em [${vhosts.join(", ")}]`);
    const auth = run("docker", ["exec", "rabbitmq", "rabbitmqctl", "-q", "authenticate_user", p.name, secret(`${P(p)}_RABBITMQ_PASSWORD`)], { allowFail: true });
    check(auth.status === 0, `${p.name}: senha do .env autentica`, `${p.name}: senha não autentica`);
    const mgmt = await http("GET", `http://127.0.0.1:15672/api/vhosts`, { auth: [p.name, secret(`${P(p)}_RABBITMQ_PASSWORD`)] });
    check(mgmt.status === 401, `${p.name}: sem acesso à API de gerenciamento`, `${p.name}: API de gerenciamento respondeu ${mgmt.status}`);
  }

  say.step("Keycloak");
  for (const p of PROJECTS.filter((x) => x.keycloak)) {
    const wk = await http("GET", `http://127.0.0.1:8080/realms/${p.name}/.well-known/openid-configuration`);
    check(wk.ok, `realm ${p.name} publicado`, `realm ${p.name}: HTTP ${wk.status}`);
    // client_credentials: sucesso (service account) ou "unauthorized_client" = segredo certo; "invalid_client" = errado
    const t = await http("POST", `http://127.0.0.1:8080/realms/${p.name}/protocol/openid-connect/token`,
      { form: { grant_type: "client_credentials", client_id: kcClientId(p), client_secret: secret(`${P(p)}_KEYCLOAK_CLIENT_SECRET`) } });
    check(t.ok || t.json?.error === "unauthorized_client", `${kcClientId(p)}: segredo do .env confere`, `${kcClientId(p)}: ${t.json?.error ?? t.status}`);
    const pw = await http("POST", `http://127.0.0.1:8080/realms/${p.name}/protocol/openid-connect/token`,
      { form: { grant_type: "password", client_id: kcClientId(p), client_secret: secret(`${P(p)}_KEYCLOAK_CLIENT_SECRET`), username: "dev", password: secret(`${P(p)}_KEYCLOAK_DEV_PASSWORD`) } });
    check(p.keycloak.directAccessGrants ? pw.ok : pw.json?.error === "unauthorized_client", `${kcClientId(p)}: password grant ${p.keycloak.directAccessGrants ? "ligado" : "desligado"} conforme manifesto`, `${kcClientId(p)}: password grant → ${pw.json?.error ?? pw.status}`);
  }

  say.step("observabilidade");
  const gf = [secret("GF_SECURITY_ADMIN_USER"), secret("GF_SECURITY_ADMIN_PASSWORD")];
  for (const uid of ["prometheus", "loki"]) {
    const h = await http("GET", `http://127.0.0.1:3000/api/datasources/uid/${uid}/health`, { auth: gf }).catch(() => ({ ok: false }));
    check(h.ok, `grafana → ${uid}: ok`, `grafana → ${uid}: ${h.json?.message ?? h.status}`);
  }
  const dashCount = (await http("GET", "http://127.0.0.1:3000/api/search?type=dash-db", { auth: gf }).catch(() => ({ json: [] }))).json?.length ?? 0;
  check(dashCount > 0, `grafana: ${dashCount} painéis`, "grafana: nenhum painel");
  const targets = (await http("GET", "http://127.0.0.1:9090/api/v1/targets?state=active").catch(() => ({ json: {} }))).json?.data?.activeTargets ?? [];
  for (const t of targets) {
    const isProject = t.labels.job === "projects";
    if (t.health === "up") say.ok(`prometheus ${t.labels.job}${isProject ? ` (${t.labels.project})` : ""}: up`);
    else if (isProject) say.warn(`prometheus projects (${t.labels.project}): ${t.health} — API do projeto não está rodando?`);
    else check(false, "", `prometheus ${t.labels.job}: ${t.health} ${t.lastError ?? ""}`);
  }
  const lokiLabels = (await http("GET", "http://127.0.0.1:3100/loki/api/v1/label/project/values").catch(() => ({ json: {} }))).json?.data ?? [];
  check(lokiLabels.includes("infra"), `loki: logs com rótulo project (${lokiLabels.join(", ")})`, "loki: nenhum log com rótulo project");

  console.log(failures ? `\n✘ ${failures} verificação(ões) falharam` : "\n✔ tudo conferido");
  return failures;
}

// ───────────────────────── dashboards export ─────────────────────────
async function exportDashboards() {
  const gf = [secret("GF_SECURITY_ADMIN_USER"), secret("GF_SECURITY_ADMIN_PASSWORD")];
  const dir = join(CONTAINER, "grafana/dashboards");
  const byUid = {};
  for (const sub of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(join(dir, sub.name)).filter((f) => f.endsWith(".json"))) {
      const uid = JSON.parse(readFileSync(join(dir, sub.name, f), "utf8")).uid;
      if (uid) byUid[uid] = join(dir, sub.name, f);
    }
  }
  for (const d of (await must("GET", "http://127.0.0.1:3000/api/search?type=dash-db", { auth: gf }))) {
    const full = await must("GET", `http://127.0.0.1:3000/api/dashboards/uid/${d.uid}`, { auth: gf });
    const dash = { ...full.dashboard, id: null };
    delete dash.version;
    const folder = (d.folderTitle || "infra").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-");
    const file = byUid[d.uid] ?? join(dir, folder, `${d.uid}.json`);
    const content = JSON.stringify(dash, null, 2) + "\n";
    if (existsSync(file) && readFileSync(file, "utf8") === content) { say.ok(relative(CONTAINER, file)); continue; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    say.change(relative(CONTAINER, file));
  }
  console.log("\nrevisar com git diff e commitar.");
}

// ───────────────────────── comandos ─────────────────────────
async function apply() {
  resolveSecrets();
  render();
  if (wants("postgres")) await applyPostgres();
  if (wants("redis")) await applyRedis();
  if (wants("rabbitmq")) await applyRabbit();
  if (wants("keycloak")) await applyKeycloak();
  if (wants("pgadmin")) await applyPgadmin();
  if (!ONLY) await reloadObservability();
}

async function up() {
  say.step("docker");
  if (run("docker", ["info", "--format", "{{.ServerVersion}}"], { allowFail: true }).status !== 0) throw new Error("Docker Desktop não está respondendo — abrir e tentar de novo");
  resolveSecrets();
  render();
  // Postgres/Redis primeiro: o keycloak precisa da role/banco dele, o redis precisa do .acl.
  say.step("subindo postgres e redis");
  compose("up", "-d", "--build", "postgres", "redis");
  await waitHealthy(["postgres", "redis"]);
  await applyPostgres();
  await applyRedis();
  say.step("subindo o resto");
  compose("up", "-d", "--build");
  await waitHealthy(["keycloak", "rabbitmq", "omniroute"], 300);
  await applyRabbit();
  await applyKeycloak();
  await applyPgadmin();
  await reloadObservability();
  return verify();
}

try {
  if (cmd === "up") process.exitCode = (await up()) ? 1 : 0;
  else if (cmd === "apply" || cmd === "diff") await apply();
  else if (cmd === "verify") { resolveSecrets(); process.exitCode = (await verify()) ? 1 : 0; }
  else if (cmd === "dashboards") await exportDashboards();
} catch (e) {
  console.error(`\n✘ ${e.message}`);
  process.exitCode = 1;
}
