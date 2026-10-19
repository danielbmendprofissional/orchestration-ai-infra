# OmniRoute — combos e configuração

Decisões e justificativas da configuração do OmniRoute (serviço `omniroute` em `container/docker-compose.yml`). A configuração aplicável mora em `config/*.json` e é aplicada por `omniroute-config.mjs` — ver `README.md` desta pasta. Este arquivo explica o **porquê**; quando uma decisão mudar, atualizar aqui e em `config/` no mesmo commit.

Sem segredo neste arquivo nem em `config/`: chave de provider e valor de API key de cliente só em `infra/container/.env`.

## Princípios

1. **Só provider com API key.** Nunca OAuth de assinatura (Claude Pro, ChatGPT Plus, Antigravity/`agy/*`) — rotear assinatura pessoal por proxy viola ToS e é o que bane conta. Claude Code fica fora do OmniRoute, direto na assinatura.
2. **Free primeiro, pago por último.** DeepSeek e OpenAI são pré-pagos (recarga automática desligada) — o saldo é o teto de gasto.
3. **Failover dentro do mesmo nível de qualidade.** O mesmo modelo em vários providers (`deepseek-v4.1-flash` via ollama-cloud/nvidia/bazaarlink/openrouter) é o failover ideal: contorna limite sem trocar qualidade.
4. **Conversa fixa num alvo.** Subagent do `pi` é uma conversa multi-turn com tool calls — trocar de modelo a cada request perde prompt cache e muda comportamento no meio da task. Estratégia dentro de pool free: `lkgp` (fixa no último alvo que funcionou, só troca quando ele falha). `quota-weighted` seria melhor (balanceia carga entre sessões paralelas mantendo a conversa fixa), mas **não existe na 3.8.51** (só no README de versões mais novas) — reavaliar no próximo upgrade. `round-robin` nunca.
5. **A ordem abaixo é estimativa** (porte/família do modelo). Ela é substituída pelo ranking real do `ai-ops/tools/omniroute-eval` assim que ele rodar — ver seção "Ranking".

## Combos

### `pool-exec-free` (interno, não usado direto por cliente)

Estratégia: `lkgp` (ver princípio 4).

| # | Modelo | Obs |
|---|---|---|
| 1 | `nvidia/moonshotai/kimi-k3` | |
| 2 | `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | |
| 3 | `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | mesmo modelo, outro provider |
| 4 | `ollama-cloud/deepseek-v4.1-flash` | |
| 5 | `nvidia/deepseek-ai/deepseek-v4.1-flash` | mesmo modelo, outro provider |
| 6 | `bazaarlink/deepseek/deepseek-v4-flash-0731free:free` | mesmo modelo, outro provider |
| 7 | `ollama-cloud/glm-5.3-flash` | |
| 8 | `groq/openai/gpt-oss-120b` | |
| 9 | `gemini/gemini-3.8-flash` | em teste — 403/429 no projeto Google em 2026-10-12 |
| 10 | `sambanova/DeepSeek-V3.2` | em teste — 429 em 2026-10-12 |

### `pi-exec` — executor geral

Estratégia: `priority`. Usado por `data`, `backend`, `front`, `ui`, `tests`.

| # | Alvo |
|---|---|
| 1 | combo `pool-exec-free` |
| 2 | `deepseek/deepseek-v4-flash` (pago, último recurso) |

Combo dentro de combo é suportado na 3.8.51 (passo `"kind": "combo-ref"`), testado.

### `pi-light` — tarefa mecânica

Estratégia: `lkgp`. Usado por `qa`. Sem modelo pago — se tudo estiver esgotado, falha e o agente-pai decide.

| # | Modelo |
|---|---|
| 1 | `groq/openai/gpt-oss-20b` |
| 2 | `mistral/ministral-14b-latest` |
| 3 | `cloudflare-ai/@cf/zai-org/glm-4.7-flash` |
| 4 | `cloudflare-ai/@cf/google/gemma-4-26b-a4b-it` |
| 5 | `gemini/gemini-3.5-flash-lite` (em teste) |
| 6 | `mistral/mistral-small-2603` (em teste) |
| 7 | combo `pool-exec-free` (se o nível leve inteiro estiver esgotado) |

### `pi-quality` — review e segurança

Estratégia: `priority`. Usado por `review`, `security`.

| # | Alvo |
|---|---|
| 1 | `openai/gpt-5.6-luna` (pago) |
| 2 | `deepseek/deepseek-v4-flash` (pago) |
| 3 | `nvidia/moonshotai/kimi-k3` (free, só se os dois pagos falharem) |

### `harness` — código do trabalho (DeepSeek Harness)

**Pendente** — revisar depois: código profissional não deveria passar por provider free que treina com prompt. Até lá, não usar o `harness` com código do trabalho.

### Removidos dos combos antigos (`harness`/`pi.dev` de 2026-10-13)

- `gemini/gemini-2.5-pro-preview-tts` — modelo de voz, não serve pra código.
- `bazaarlink/auto:free` — modelo aleatório, imprevisível.
- `glm/glm-4.7` — sem saldo (429 "Insufficient balance") até recarregar o plano GLM.
- Modelos pequenos (`ministral-14b`, `gemma-4`, `flash-lite`, `mistral-small`) — saíram do executor e foram pro `pi-light`.

## Configurações globais

| Configuração | Valor | Por quê |
|---|---|---|
| Caveman (`cavemanConfig.enabled`) | `false` | Medido líquido negativo em sessão de código (`ai-ops/docs-human/ai-base/less-tokens.md`) |
| Pipeline de compressão padrão | só `rtk` (sem `caveman`) | idem |
| `semanticCacheEnabled` | `false` | Em trabalho agentic, prompt parecido com contexto diferente pode receber resposta velha — risco direto pro TDD |
| `promptCacheEnabled` | `true` | Cache de prefixo do próprio provider: corta custo sem risco de resposta velha |
| `context_cache_protection` | `true` nos combos `pi-*` | |

## API keys de cliente

| Nome | Uso | Acesso |
|---|---|---|
| `pi` | `pi.dev` (variável `OMNIROUTE_API_KEY`) | combos `pi-exec`, `pi-light`, `pi-quality` |
| `eval` | `ai-ops/tools/omniroute-eval` | modelos individuais (sem combo) |
| `harness-geral` | DeepSeek Harness | pendente (ver `harness` acima) |

## Ranking

Atualizado a partir de `ai-ops/tools/omniroute-eval`. Ainda não rodou.
