#!/usr/bin/env node
// Config-as-code do OmniRoute: config/*.json (git, sem segredo) + infra/container/.env (segredo) <-> instância.
// Uso e regras: README.md desta pasta. Node 22+, sem dependência.
//
//   node omniroute-config.mjs export [--harvest-secrets] [--overwrite-secrets]
//   node omniroute-config.mjs diff
//   node omniroute-config.mjs apply [--dry-run] [--prune] [--sync-secrets] [--setx]
//
// Opções comuns: --url=http://127.0.0.1:20128  --env=<.env>  --config=<pasta>
// Auth: OMNIROUTE_PASSWORD (variável) > --ask-password (pergunta sem eco) > OMNIROUTE_INITIAL_PASSWORD (.env)
//       > OMNIROUTE_MANAGE_KEY (Bearer, API key com escopo "manage").

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(
  rest.map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : true];
  })
);
const BASE = String(opt.url || process.env.OMNIROUTE_URL || "http://127.0.0.1:20128").replace(/\/$/, "");
const ENV_FILE = resolve(opt.env || join(HERE, "../../container/.env"));
const CONFIG_DIR = resolve(opt.config || join(HERE, "config"));
const DRY = !!opt["dry-run"] || cmd === "diff";

if (!["export", "apply", "diff"].includes(cmd)) {
  console.error("uso: node omniroute-config.mjs <export|diff|apply> [opções] — ver README.md");
  process.exit(2);
}

// ───────────────────────── .env (segredos) ─────────────────────────
// Nunca imprime valor. Escrita atômica (arquivo temporário + rename), preserva linhas e comentários.
const envFile = {
  lines: existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [],
  get(name) {
    const l = this.lines.find((x) => x.startsWith(name + "="));
    return l ? l.slice(name.length + 1).replace(/^"(.*)"$/, "$1") : undefined;
  },
  set(name, value) {
    if (/[\r\n]/.test(value)) throw new Error(`segredo ${name} tem quebra de linha`);
    const i = this.lines.findIndex((x) => x.startsWith(name + "="));
    if (i >= 0) this.lines[i] = `${name}=${value}`;
    else {
      if (!this.lines.some((x) => x.includes("OMNIROUTE — gerado por omniroute-config.mjs"))) {
        while (this.lines.length && this.lines.at(-1) === "") this.lines.pop();
        this.lines.push("", "# =================================", "# = OMNIROUTE — gerado por omniroute-config.mjs (não editar o nome)", "# =================================");
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
const secret = (name) => process.env[name] ?? envFile.get(name);

// ───────────────────────── HTTP / auth ─────────────────────────
let cookie = "";
let bearer = "";
async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    const msg = typeof json === "object" ? JSON.stringify(json.error ?? json).slice(0, 400) : String(text).slice(0, 200);
    throw new Error(`${method} ${path} → HTTP ${res.status}: ${msg}`);
  }
  return json;
}
// Senha digitada sem eco (só quando há terminal interativo).
function askHidden(prompt) {
  return new Promise((done) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
        process.stdout.write("\n"); done(value);
      } else if (ch === "\u0003") process.exit(130);
      else if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
      else value += ch;
    };
    stdin.on("data", onData);
  });
}
async function login() {
  let password = process.env.OMNIROUTE_PASSWORD || (opt["ask-password"] ? "" : envFile.get("OMNIROUTE_INITIAL_PASSWORD"));
  if (!password && opt["ask-password"] && process.stdin.isTTY) password = await askHidden("Senha do dashboard do OmniRoute: ");
  if (password) {
    const res = await fetch(BASE + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    const token = set.map((c) => c.split(";")[0]).find((c) => c.startsWith("auth_token="));
    if (res.ok && token) { cookie = token; return; }
    throw new Error(`login falhou (HTTP ${res.status}) — senha do dashboard diferente da usada?`);
  }
  const key = process.env.OMNIROUTE_MANAGE_KEY || envFile.get("OMNIROUTE_MANAGE_KEY");
  if (key) { bearer = key; return; }
  throw new Error("sem credencial de gerenciamento: defina OMNIROUTE_PASSWORD, OMNIROUTE_INITIAL_PASSWORD no .env, ou OMNIROUTE_MANAGE_KEY");
}

// ───────────────────────── util ─────────────────────────
const canon = (v) =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : v;
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
// "A config está satisfeita pela instância": todo campo declarado bate; campo a mais na instância
// (default novo de versão mais nova do OmniRoute) não conta como diferença. Arrays comparam exato.
const covers = (want, have) => {
  if (want && typeof want === "object" && !Array.isArray(want))
    return !!have && typeof have === "object" && !Array.isArray(have) && Object.keys(want).every((k) => covers(want[k], have[k]));
  return same(want, have);
};
// Merge profundo: config por cima da instância, preservando campos que a config não declara.
const deepMerge = (base, over) => {
  if (!(over && typeof over === "object" && !Array.isArray(over)) || !(base && typeof base === "object" && !Array.isArray(base))) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
};
const envName = (...parts) => parts.filter(Boolean).join("_").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
const omit = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const readCfg = (f) => (existsSync(join(CONFIG_DIR, f)) ? JSON.parse(readFileSync(join(CONFIG_DIR, f), "utf8")) : undefined);
const writeCfg = (f, data) => {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, f), JSON.stringify(canon(data), null, 2) + "\n");
};

// Campo secreto dentro de objeto de config: vira placeholder "${ENV:NOME}" no git.
const SECRET_KEY = /(secret|password|token|apikey|api_key|cookie|extraapikeys)$/i;
const NOT_SECRET = new Set(["apiKeyHealth", "hasPassword", "oidcDisablePasswordLogin"]);
const isPlaceholder = (v) => typeof v === "string" && /^\$\{ENV:[A-Z0-9_]+\}$/.test(v);
const placeholderName = (v) => v.slice(6, -1);
// Segredo = nome de campo suspeito E valor texto (ou lista de texto). Objeto com nome suspeito é config
// (ex.: resilience.connectionCooldown.apikey = perfil do tipo de auth "apikey"), não segredo.
const isSecretField = (k, v) =>
  SECRET_KEY.test(k) && !NOT_SECRET.has(k) && (typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string")));
function sanitizeSecrets(obj, prefix, harvested) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const empty = v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (isSecretField(k, v) && !empty) {
      const name = envName(prefix, k);
      out[k] = `\${ENV:${name}}`;
      if (harvested && harvested[k] !== undefined) harvestSecret(name, harvested[k]);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = sanitizeSecrets(v, envName(prefix, k), harvested?.[k]);
    } else out[k] = v;
  }
  return out;
}
// Resolve placeholders. Retorna { value, missing[] }. Arrays de segredo são guardados como JSON no .env.
function resolveSecrets(obj) {
  const missing = [];
  const walk = (v) => {
    if (isPlaceholder(v)) {
      const raw = secret(placeholderName(v));
      if (raw === undefined || raw === "") { missing.push(placeholderName(v)); return undefined; }
      return raw.startsWith("[") ? JSON.parse(raw) : raw;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]).filter(([, x]) => x !== undefined));
    return v;
  };
  return { value: walk(obj), missing };
}
// Remove campos secretos (placeholder) — usado pra comparar config x instância sem enxergar segredo.
function stripSecrets(v) {
  if (isPlaceholder(v)) return undefined;
  if (Array.isArray(v)) return v.map(stripSecrets);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => !isPlaceholder(x) && !isSecretField(k, x)).map(([k, x]) => [k, stripSecrets(x)]));
  return v;
}
let harvestCount = 0;
function harvestSecret(name, value) {
  if (!opt["harvest-secrets"]) return;
  const v = Array.isArray(value) ? JSON.stringify(value) : String(value);
  if (!v || /\*{3,}/.test(v)) return; // valor mascarado nunca vira segredo
  if (envFile.get(name) !== undefined && !opt["overwrite-secrets"]) return;
  envFile.set(name, v);
  harvestCount++;
}

// ───────────────────────── recursos "objeto" ─────────────────────────
// Configurações globais: um objeto por recurso. readOnly = campos derivados/de runtime, nunca versionados.
const OBJECT_RESOURCES = [
  {
    file: "settings.json", get: "/api/settings", write: ["PATCH", "/api/settings"], mode: "diff-keys",
    readOnly: [
      "settingsRevision", "hasPassword", "runtimePorts", "apiPort", "dashboardPort", "cloudConfigured", "cloudUrl",
      "machineId", "setupComplete", "provider_limits_auto_sync_last_run", "codex_catalog_revalidated_version",
      "codexConnectionDefaultsMigrationV1", "requireLogin", "resilienceSettings", "radarAdminUrl", "password",
      "call_log_pipeline_enabled", // legado, duplicado de database.logs.callLogPipelineEnabled
      "autoDisableBannedAccounts", "autoDisableBannedThreshold", "autoDisableBannedScope", // → auto-disable.json
      "cloudEnabled", // só muda via ação de cloud sync; sem NEXT_PUBLIC_CLOUD_URL a sync nem funciona
    ],
  },
  { file: "compression.json", get: "/api/settings/compression", write: ["PUT", "/api/settings/compression"], mode: "diff-keys", readOnly: ["enginesExplicit"] },
  { file: "rtk.json", get: "/api/context/rtk/config", write: ["PUT", "/api/context/rtk/config"], mode: "diff-keys" },
  { file: "cache.json", get: "/api/settings/cache-config", write: ["PUT", "/api/settings/cache-config"], mode: "diff-keys", readOnly: ["embeddingOptions"] }, // catálogo derivado
  { file: "database.json", get: "/api/settings/database", write: ["PUT", "/api/settings/database"], mode: "full", readOnly: ["location", "stats"] },
  { file: "auto-disable.json", get: "/api/settings/auto-disable-accounts", write: ["PUT", "/api/settings/auto-disable-accounts"], mode: "diff-keys" },
  { file: "resilience.json", get: "/api/resilience", write: ["PATCH", "/api/resilience"], mode: "diff-keys", readOnly: ["legacy"] },
];

// ───────────────────────── providers ─────────────────────────
const PROVIDER_FIELDS = [
  "provider", "name", "priority", "globalPriority", "defaultModel", "isActive", "group", "maxConcurrent",
  "rateLimitOverrides", "proxyEnabled", "perKeyProxyEnabled", "quotaVisible", "quotaWindowThresholds", "providerSpecificData",
];
const PSD_RUNTIME = ["apiKeyHealth"];
const providerId = (p) => `${p.provider}/${p.name}`;
const providerKeyEnv = (p) => envName("OMNIROUTE_KEY", p.provider, p.name === "main" ? "" : p.name);
function exportProvider(c, full) {
  const out = pick(c, PROVIDER_FIELDS);
  const psd = omit(full?.providerSpecificData ?? c.providerSpecificData, PSD_RUNTIME);
  out.providerSpecificData = Object.keys(psd).length ? sanitizeSecrets(psd, envName("OMNIROUTE_KEY", c.provider, c.name === "main" ? "" : c.name), psd) : undefined;
  if (c.authType && c.authType !== "apikey") out.authType = c.authType; // OAuth: fora do escopo (ToS), só registrado
  out.apiKey = `\${ENV:${providerKeyEnv(c)}}`;
  if (full?.apiKey) harvestSecret(providerKeyEnv(c), full.apiKey);
  return JSON.parse(JSON.stringify(out));
}

// ───────────────────────── combos ─────────────────────────
const COMBO_FIELDS = [
  "name", "description", "strategy", "config", "context_cache_protection", "system_message", "tool_filter_regex",
  "allowedProviders", "allowedModelFamilies", "context_length", "compressionOverride", "isActive",
];
function exportCombo(c, connById) {
  const out = pick(c, COMBO_FIELDS);
  out.models = (c.models || []).map((s) => {
    if (typeof s === "string") return s;
    const step = omit(s, ["id", "connectionId"]);
    if (s.connectionId && connById[s.connectionId]) step.connection = connById[s.connectionId];
    if (step.weight === 0) delete step.weight;
    return step;
  });
  if (out.config && !Object.keys(out.config).length) delete out.config;
  return out;
}
function comboPayload(c, connByRef) {
  const body = omit(c, ["models"]);
  body.models = c.models.map((s) => {
    if (typeof s === "string") return s;
    const step = omit(s, ["connection"]);
    if (s.connection) {
      if (!connByRef[s.connection]) throw new Error(`combo ${c.name}: conexão ${s.connection} não existe`);
      step.connectionId = connByRef[s.connection];
    }
    return step;
  });
  return body;
}
// Combo que referencia outro (combo-ref) precisa ser criado depois dele.
function topoCombos(list) {
  const byName = Object.fromEntries(list.map((c) => [c.name, c]));
  const done = new Set(), out = [];
  const visit = (c, stack = []) => {
    if (done.has(c.name)) return;
    if (stack.includes(c.name)) throw new Error(`ciclo de combo-ref: ${[...stack, c.name].join(" → ")}`);
    for (const s of c.models) if (s?.kind === "combo-ref" && byName[s.comboName]) visit(byName[s.comboName], [...stack, c.name]);
    done.add(c.name); out.push(c);
  };
  list.forEach((c) => visit(c));
  return out;
}

// ───────────────────────── API keys de cliente ─────────────────────────
const KEY_FIELDS = [
  "name", "modelAccessMode", "allowedModels", "allowedCombos", "allowedConnections", "noLog", "autoResolve", "isActive",
  "throttleDelayMs", "maxSessions", "accessSchedule", "rateLimits", "scopes", "allowedEndpoints", "streamDefaultMode",
  "compressionEnabled", "cacheDefaultMode", "disableNonPublicModels", "allowUsageCommand", "usageLimitEnabled",
  "dailyUsageLimitUsd", "weeklyUsageLimitUsd", "chaosModeEnabled", "expiresAt",
];
const CREATE_KEY_FIELDS = ["name", "noLog", "allowUsageCommand", "usageLimitEnabled", "dailyUsageLimitUsd", "weeklyUsageLimitUsd", "chaosModeEnabled", "scopes"];
const KEY_NULLABLE = ["dailyUsageLimitUsd", "weeklyUsageLimitUsd", "expiresAt", "accessSchedule", "rateLimits"];
const clientKeyEnv = (name) => envName("OMNIROUTE_CLIENT_KEY", name);
function exportKey(k, full) {
  // GET devolve null em campo que o PATCH só aceita como número (ex.: throttleDelayMs) — null = default, omite
  const out = Object.fromEntries(Object.entries(pick(k, KEY_FIELDS)).filter(([f, v]) => v !== null || KEY_NULLABLE.includes(f)));
  out.allowedConnections = undefined; // ids de conexão não são estáveis entre instâncias
  if (full?.key) harvestSecret(clientKeyEnv(k.name), full.key);
  return JSON.parse(JSON.stringify(out));
}

// ───────────────────────── estado da instância ─────────────────────────
async function readLive() {
  const live = {};
  for (const r of OBJECT_RESOURCES) live[r.file] = await api("GET", r.get);
  live.providers = (await api("GET", "/api/providers")).connections;
  live.combos = (await api("GET", "/api/combos")).combos;
  live.keys = (await api("GET", "/api/keys")).keys;
  live.models = await api("GET", "/api/provider-models");
  return live;
}

// ───────────────────────── export ─────────────────────────
async function doExport() {
  const live = await readLive();
  const full = opt["harvest-secrets"] ? await api("GET", "/api/settings/export-json") : null;
  const fullConn = Object.fromEntries((full?.providerConnections ?? []).map((c) => [providerId(c), c]));
  const fullKeys = Object.fromEntries((full?.apiKeys ?? []).map((k) => [k.name, k]));

  for (const r of OBJECT_RESOURCES) {
    const data = omit(live[r.file], r.readOnly ?? []);
    const harvestedSrc = r.file === "settings.json" ? full?.settings : undefined;
    writeCfg(r.file, sanitizeSecrets(data, envName("OMNIROUTE", r.file.replace(".json", "")), harvestedSrc));
  }
  const connById = Object.fromEntries(live.providers.map((c) => [c.id, providerId(c)]));
  writeCfg("providers.json", live.providers.map((c) => exportProvider(c, fullConn[providerId(c)])).sort((a, b) => providerId(a).localeCompare(providerId(b))));
  writeCfg("combos.json", [...live.combos].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((c) => exportCombo(c, connById)));
  writeCfg("api-keys.json", live.keys.map((k) => exportKey(k, fullKeys[k.name])).sort((a, b) => a.name.localeCompare(b.name)));
  writeCfg("models.json", {
    hidden: Object.fromEntries(Object.entries(live.models.hiddenModelsByProvider || {}).map(([p, ids]) => [p, [...ids].sort()])),
    custom: Object.fromEntries(Object.entries(live.models.models || {}).map(([p, ms]) => [p, ms.map((m) => omit(m, ["source"])).sort((a, b) => a.id.localeCompare(b.id))])),
  });
  envFile.save();
  console.log(`export ok → ${CONFIG_DIR}`);
  if (opt["harvest-secrets"]) console.log(`segredos gravados em ${ENV_FILE}: ${harvestCount} (valores nunca exibidos)`);
}

// ───────────────────────── apply / diff ─────────────────────────
const plan = [];
const problems = [];
async function step(desc, fn) {
  plan.push(desc);
  console.log((DRY ? "[plano] " : "[aplica] ") + desc);
  if (!DRY) {
    try { await fn(); } catch (e) { problems.push(`${desc}: ${e.message}`); console.log("   ✗ " + e.message); }
  }
}

async function doApply() {
  const live = await readLive();

  // 1. Objetos de configuração global
  for (const r of OBJECT_RESOURCES) {
    const want = readCfg(r.file);
    if (!want) continue;
    const have = omit(live[r.file], r.readOnly ?? []);
    const changed = Object.keys(want).filter((k) => {
      if (isPlaceholder(want[k])) return !!opt["sync-secrets"];
      return !covers(stripSecrets(want[k]), stripSecrets(have[k]));
    });
    if (!changed.length) continue;
    // "full": a rota exige o objeto inteiro → merge profundo com a instância. Parcial: só o declarado
    // (o servidor mescla; reenviar campo lido do GET pode ser rejeitado, ex.: requestQueue.globalConcurrentRequests).
    const body = r.mode === "full" ? deepMerge(have, want) : pick(want, changed);
    const { value, missing } = resolveSecrets(body);
    if (missing.length) problems.push(`${r.file}: segredos ausentes no .env: ${missing.join(", ")}`);
    await step(`${r.file}: ${changed.join(", ")}`, () => api(r.write[0], r.write[1], value));
  }

  // 2. Providers (identidade = provider/name)
  const wantProv = readCfg("providers.json") ?? [];
  const liveProv = Object.fromEntries(live.providers.map((c) => [providerId(c), c]));
  for (const p of wantProv) {
    const id = providerId(p);
    if (p.authType && p.authType !== "apikey") { problems.push(`${id}: authType ${p.authType} (OAuth) não é aplicado por este script`); continue; }
    const cur = liveProv[id];
    if (!cur) {
      const { value, missing } = resolveSecrets(p);
      if (missing.length) { problems.push(`${id}: segredos ausentes no .env: ${missing.join(", ")} — provider não criado`); continue; }
      await step(`provider ${id}: criar`, async () => {
        const created = await api("POST", "/api/providers", pick(value, ["provider", "name", "apiKey", "priority", "globalPriority", "defaultModel", "providerSpecificData"]));
        const extra = omit(value, ["provider", "name", "apiKey", "priority", "globalPriority", "defaultModel", "providerSpecificData"]);
        if (Object.keys(extra).length) await api("PUT", `/api/providers/${created.connection.id}`, extra);
      });
      continue;
    }
    const curCmp = exportProvider(cur, null);
    const changed = PROVIDER_FIELDS.filter((k) => !["provider", "name"].includes(k) && p[k] !== undefined && !covers(stripSecrets(p[k]), stripSecrets(curCmp[k])));
    if (opt["sync-secrets"]) changed.push("apiKey");
    if (!changed.length) continue;
    const { value, missing } = resolveSecrets(pick(p, changed));
    if (missing.length) problems.push(`${id}: segredos ausentes no .env: ${missing.join(", ")}`);
    await step(`provider ${id}: ${changed.join(", ")}`, () => api("PUT", `/api/providers/${cur.id}`, value));
  }
  if (opt.prune) for (const c of live.providers) if (!wantProv.some((p) => providerId(p) === providerId(c))) await step(`provider ${providerId(c)}: remover (fora da config)`, () => api("DELETE", `/api/providers/${c.id}`));

  // 3. Modelos ocultos e modelos customizados
  const wantModels = readCfg("models.json") ?? { hidden: {}, custom: {} };
  const liveHidden = live.models.hiddenModelsByProvider || {};
  for (const prov of new Set([...Object.keys(wantModels.hidden || {}), ...(opt.prune ? Object.keys(liveHidden) : [])])) {
    const want = new Set(wantModels.hidden?.[prov] ?? []), have = new Set(liveHidden[prov] ?? []);
    const hide = [...want].filter((m) => !have.has(m)), unhide = opt.prune ? [...have].filter((m) => !want.has(m)) : [];
    if (hide.length) await step(`modelos ${prov}: ocultar ${hide.length}`, () => api("PATCH", `/api/provider-models?provider=${encodeURIComponent(prov)}`, { modelIds: hide, isHidden: true }));
    if (unhide.length) await step(`modelos ${prov}: reexibir ${unhide.length}`, () => api("PATCH", `/api/provider-models?provider=${encodeURIComponent(prov)}`, { modelIds: unhide, isHidden: false }));
  }
  const liveCustom = live.models.models || {};
  for (const [prov, models] of Object.entries(wantModels.custom || {})) {
    for (const m of models) {
      const cur = (liveCustom[prov] || []).find((x) => x.id === m.id);
      if (cur && same(omit(cur, ["source", "isHidden"]), omit(m, ["isHidden"]))) continue;
      await step(`modelo custom ${prov}/${m.id}: ${cur ? "atualizar" : "criar"}`, () =>
        api("POST", "/api/provider-models", { provider: prov, modelId: m.id, ...omit(m, ["id", "name", "isHidden"]), modelName: m.name }));
    }
  }
  if (opt.prune)
    for (const [prov, models] of Object.entries(liveCustom))
      for (const m of models)
        if (!(wantModels.custom?.[prov] || []).some((x) => x.id === m.id))
          await step(`modelo custom ${prov}/${m.id}: remover`, () => api("DELETE", `/api/provider-models?provider=${encodeURIComponent(prov)}&model=${encodeURIComponent(m.id)}`));

  // 4. Combos (combo-ref depois do combo referenciado)
  const wantCombos = topoCombos(readCfg("combos.json") ?? []);
  const provNow = DRY ? live.providers : (await api("GET", "/api/providers")).connections;
  const connByRef = Object.fromEntries(provNow.map((c) => [providerId(c), c.id]));
  const connById = Object.fromEntries(provNow.map((c) => [c.id, providerId(c)]));
  const liveCombos = Object.fromEntries(live.combos.map((c) => [c.name, c]));
  for (const c of wantCombos) {
    const cur = liveCombos[c.name];
    if (!cur) { await step(`combo ${c.name}: criar`, () => api("POST", "/api/combos", comboPayload(c, connByRef))); continue; }
    const curCmp = exportCombo(cur, connById);
    const changed = [...COMBO_FIELDS, "models"].filter((k) => k !== "name" && c[k] !== undefined && !covers(c[k], curCmp[k]));
    if (changed.length) await step(`combo ${c.name}: ${changed.join(", ")}`, () => api("PUT", `/api/combos/${cur.id}`, pick(comboPayload(c, connByRef), changed)));
  }
  if (opt.prune) {
    // remove primeiro quem referencia (ordem inversa da topológica)
    const extra = topoCombos(live.combos.filter((c) => !wantCombos.some((w) => w.name === c.name)).map((c) => exportCombo(c, connById))).reverse();
    for (const c of extra) await step(`combo ${c.name}: remover (fora da config)`, () => api("DELETE", `/api/combos/${liveCombos[c.name].id}`));
  }

  // 5. API keys de cliente — valor gerado pelo servidor, gravado no .env (e no Windows com --setx)
  const wantKeys = readCfg("api-keys.json") ?? [];
  const liveKeys = Object.fromEntries(live.keys.map((k) => [k.name, k]));
  for (const k of wantKeys) {
    const perms = omit(k, ["windowsEnv"]);
    const cur = liveKeys[k.name];
    if (!cur) {
      await step(`api key ${k.name}: criar`, async () => {
        const res = await api("POST", "/api/keys", pick(perms, CREATE_KEY_FIELDS));
        const created = res.key && typeof res.key === "object" ? res.key : res;
        const value = typeof res.key === "string" ? res.key : created.key;
        const id = created.id ?? res.id;
        if (!value) throw new Error("resposta sem o valor da key");
        envFile.set(clientKeyEnv(k.name), value);
        envFile.save();
        const update = omit(perms, CREATE_KEY_FIELDS);
        if (Object.keys(update).length && id) await api("PATCH", `/api/keys/${id}`, update);
        if (k.windowsEnv) {
          if (opt.setx && process.platform === "win32") {
            const r = spawnSync("setx", [k.windowsEnv, value], { stdio: "ignore" });
            if (r.status !== 0) throw new Error(`setx ${k.windowsEnv} falhou`);
            console.log(`   ✓ ${k.windowsEnv} gravada no Windows (vale em terminal novo)`);
          } else problems.push(`api key ${k.name}: copie ${clientKeyEnv(k.name)} do .env para a variável ${k.windowsEnv} (ou rode apply com --setx)`);
        }
      });
      continue;
    }
    const curCmp = exportKey(cur, null);
    const changed = Object.keys(perms).filter((f) => f !== "name" && !covers(perms[f], curCmp[f]));
    if (changed.length) await step(`api key ${k.name}: ${changed.join(", ")}`, () => api("PATCH", `/api/keys/${cur.id}`, pick(perms, changed)));
  }
  if (opt.prune) for (const k of live.keys) if (!wantKeys.some((w) => w.name === k.name)) await step(`api key ${k.name}: remover (fora da config)`, () => api("DELETE", `/api/keys/${k.id}`));

  envFile.save();
  console.log(`\n${DRY ? "diff" : "apply"}: ${plan.length} mudança(s)${DRY && plan.length ? " — rode apply pra aplicar" : ""}`);
  if (problems.length) {
    console.log("\nPendências:");
    problems.forEach((p) => console.log(" - " + p));
    process.exitCode = 1;
  }
}

try {
  await login();
  if (cmd === "export") await doExport();
  else await doApply();
} catch (e) {
  console.error("erro: " + e.message);
  process.exit(1);
}
