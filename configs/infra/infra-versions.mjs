#!/usr/bin/env node
// Lista as imagens fixadas em container/docker-compose.yml (e o FROM do Postgres) e o que existe
// de versão mais nova em cada registry. Só leitura — não muda nada. Usado pelo agent
// ai-ops/agents/infra/infra-versions-config (que decide e aplica, com aprovação).
//
//   node infra-versions.mjs check [--json]
//
// Classificação: patch (mesmo major.minor), minor (mesmo major), major (troca de major).
// Mesmo "sabor" da tag atual: prefixo (v), quantidade de números e sufixo (-alpine, -management-alpine...).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTAINER = resolve(HERE, "../../container");
const [cmd, ...rest] = process.argv.slice(2);
if (cmd !== "check") {
  console.error("uso: node infra-versions.mjs check [--json]");
  process.exit(2);
}
const JSON_OUT = rest.includes("--json");

// imagem → serviços que a usam (o mesmo redis serve redis e omniroute-redis)
function pinnedImages() {
  const found = new Map();
  const add = (image, where) => found.set(image, [...(found.get(image) ?? []), where]);
  let service = null;
  for (const line of readFileSync(join(CONTAINER, "docker-compose.yml"), "utf8").split(/\r?\n/)) {
    const s = line.match(/^ {2}([a-z0-9_-]+):\s*$/);
    if (s) service = s[1];
    const m = line.match(/^\s+image:\s*([^\s#]+)/);
    if (m && !m[1].startsWith("infra-")) add(m[1], service);
  }
  const from = readFileSync(join(CONTAINER, "postgres/Dockerfile"), "utf8").match(/^FROM\s+(\S+)/m);
  if (from) add(from[1], "postgres (Dockerfile)");
  return [...found].map(([image, services]) => ({ image, services }));
}

function parseRef(image) {
  const [repoPart, tag = "latest"] = image.split(/:(?=[^/]+$)/);
  const quay = repoPart.startsWith("quay.io/");
  let repo = repoPart.replace(/^(quay\.io|docker\.io)\//, "");
  if (!quay && !repo.includes("/")) repo = `library/${repo}`;
  return { registry: quay ? "quay" : "hub", repo, tag };
}

// "v3.15.0" → {prefix:"v", nums:[3,15,0], suffix:""}; "3.13.7-management-alpine" → suffix "-management-alpine"
function parseTag(tag) {
  const m = tag.match(/^(v?)(\d+(?:\.\d+)*)(.*)$/);
  if (!m) return null;
  return { prefix: m[1], nums: m[2].split(".").map(Number), suffix: m[3] };
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };

async function listTags({ registry, repo }, nameFilter) {
  const tags = new Set();
  if (registry === "quay") {
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://quay.io/api/v1/repository/${repo}/tag/?limit=100&onlyActiveTags=true&page=${page}`).then((x) => x.json());
      (r.tags ?? []).forEach((t) => tags.add(t.name));
      if (!r.has_additional) break;
    }
    return [...tags];
  }
  let url = `https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&ordering=last_updated${nameFilter ? `&name=${encodeURIComponent(nameFilter)}` : ""}`;
  for (let page = 0; url && page < 10; page++) {
    const r = await fetch(url).then((x) => x.json());
    (r.results ?? []).forEach((t) => tags.add(t.name));
    url = r.next;
  }
  return [...tags];
}

async function check({ image, services }) {
  const ref = parseRef(image);
  const cur = parseTag(ref.tag);
  if (!cur) return { image, services, status: "sem-versao-fixa", note: `tag "${ref.tag}" não é versão — fixar antes de qualquer upgrade` };
  const tags = await listTags(ref, cur.suffix || undefined);
  const same = tags.map(parseTag).filter((t) => t && t.prefix === cur.prefix && t.suffix === cur.suffix && t.nums.length === cur.nums.length);
  const newer = same.filter((t) => cmp(t.nums, cur.nums) > 0).sort((a, b) => cmp(b.nums, a.nums));
  const fmt = (t) => t && `${t.prefix}${t.nums.join(".")}${t.suffix}`;
  const patch = newer.find((t) => t.nums[0] === cur.nums[0] && t.nums[1] === cur.nums[1]);
  const minor = newer.find((t) => t.nums[0] === cur.nums[0] && t.nums[1] !== cur.nums[1]);
  const major = newer.find((t) => t.nums[0] !== cur.nums[0]);
  return {
    image, services, current: ref.tag,
    patch: fmt(patch), minor: fmt(minor), major: fmt(major),
    status: newer.length ? "atualizavel" : "em-dia",
  };
}

const results = [];
for (const img of pinnedImages()) {
  try { results.push(await check(img)); }
  catch (e) { results.push({ ...img, status: "erro", note: e.message }); }
}

if (JSON_OUT) console.log(JSON.stringify(results, null, 2));
else {
  console.log("imagem".padEnd(48), "atual".padEnd(28), "patch".padEnd(28), "minor".padEnd(28), "major");
  for (const r of results) {
    if (r.status === "sem-versao-fixa" || r.status === "erro") { console.log(r.image.padEnd(48), `! ${r.note}`); continue; }
    const repo = r.image.split(/:(?=[^/]+$)/)[0];
    console.log(repo.padEnd(48), r.current.padEnd(28), (r.patch ?? "—").padEnd(28), (r.minor ?? "—").padEnd(28), r.major ?? "—");
  }
}
