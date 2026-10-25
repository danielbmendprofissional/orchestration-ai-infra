# OmniRoute — combos e configuração

Decisões e justificativas da configuração do OmniRoute (serviço `omniroute` em `container/docker-compose.yml`). A configuração aplicável mora em `config/*.json` e é aplicada por `omniroute-config.mjs` — ver `README.md` desta pasta. Este arquivo explica o **porquê**; quando uma decisão mudar, atualizar aqui e em `config/` no mesmo commit.

Sem segredo neste arquivo nem em `config/`: chave de provider e valor de API key de cliente só em `ai-infra/container/.env`.

## Princípios

1. **Só provider com API key.** Nunca OAuth de assinatura (Claude Pro, ChatGPT Plus, Antigravity/`agy/*`) — rotear assinatura pessoal por proxy viola ToS e é o que bane conta. Claude Code fica fora do OmniRoute, direto na assinatura.
2. **Free primeiro, pago por último.** DeepSeek e OpenAI são pré-pagos (recarga automática desligada) — o saldo é o teto de gasto.
3. **Failover dentro do mesmo nível de qualidade.** O mesmo modelo em vários providers (`deepseek-v4.1-flash` via ollama-cloud/nvidia/bazaarlink/openrouter) é o failover ideal: contorna limite sem trocar qualidade.
4. **Conversa fixa num alvo.** Sessão ou subagente do Claude Code é uma conversa multi-turn com tool calls — trocar de modelo a cada request perde prompt cache e muda comportamento no meio da task. Estratégia dentro de pool free: `lkgp` (fixa no último alvo que funcionou, só troca quando ele falha). `quota-weighted` seria melhor (balanceia carga entre sessões paralelas mantendo a conversa fixa), mas **não existe na 3.8.51** (só no README de versões mais novas) — reavaliar no próximo upgrade. `round-robin` nunca.
5. **A ordem abaixo é estimativa** (porte/família do modelo). Ela é substituída pelo ranking real do `ai-ops/tools/omniroute-eval` assim que ele rodar — ver seção "Ranking".

## Combos

### `pool-exec-free` (interno, não usado direto por cliente)

Estratégia: `lkgp` (ver princípio 4). Ordem pelo eval de 2026-10-19 (ver "Ranking").

| # | Modelo | Eval |
|---|---|---|
| 1 | `bazaarlink/deepseek/deepseek-v4-flash-0731free:free` | 3/3, ~11s |
| 2 | `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | 3/3, ~24s |
| 3 | `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | 3/3, mesmo modelo, outro provider (write-test lento: 200s) |
| 4 | `groq/openai/gpt-oss-120b` | 2/3, o mais rápido (~3s) — falhou só em escrever teste |

### `pi-exec` — executor geral

Estratégia: `priority`, `nestedComboMode: execute` (o pool roda com a própria estratégia). Usado por `tests` e tarefa corriqueira (o código vai no `pi-code`).

| # | Alvo |
|---|---|
| 1 | combo `pool-exec-free` |
| 2 | `deepseek/deepseek-v4-flash` (pago, último recurso) |

Combo dentro de combo é suportado na 3.8.51 (passo `"kind": "combo-ref"`), testado. Sem `nestedComboMode: execute` o OmniRoute achata o pool e ignora o `lkgp` dele.

### `pi-light` — tarefa mecânica

Estratégia: `lkgp`, `nestedComboMode: execute`. Usado por `qa`. Sem modelo pago. Todos acertam ler/editar (2/3); nenhum passou em "escrever teste que pega bug" — por isso só `qa` usa este combo.

| # | Modelo |
|---|---|
| 1 | `groq/openai/gpt-oss-20b` (escreveu tool call com JSON inválido 1x) |
| 2 | `mistral/ministral-14b-latest` |
| 3 | `cloudflare-ai/@cf/zai-org/glm-4.7-flash` |
| 4 | `cloudflare-ai/@cf/google/gemma-4-26b-a4b-it` |
| 5 | combo `pool-exec-free` (se o nível leve inteiro estiver esgotado) |

### `pi-code` e `pi-quality` — só pagos (código, pai, review, segurança)

Estratégia: `priority`, `failoverBeforeRetry: false`, `maxRetries: 3`, `retryDelayMs: 3000` — falha tenta o **mesmo** modelo 3x antes de trocar. `pi-code`: `data`, `backend`, `front`, `ui` e o agente-pai. `pi-quality`: `review`, `security`. **Sem modelo free** (2026-10-24: o Nemotron no fim do `pi-quality` fez quase todo o trabalho das primeiras rodadas sem ninguém ver).

| # | Alvo |
|---|---|
| 1 | `deepseek/deepseek-v4-flash` (pago) |
| 2 | `openai/gpt-5.6-luna` (pago) |

**DeepSeek primeiro e `reasoning_effort: "none"`:** no modo de raciocínio o DeepSeek exige o `reasoning_content` de cada turno anterior; conversa que começou na Luna e cai pra ele recebe 400 (o OmniRoute descarta `reasoning_content: ""`). Com `reasoning_effort: "none"` os dois aceitam o histórico um do outro, nos dois sentidos (testado 2026-10-24). O `pi` manda `none` sempre: em `~/.pi/agent/models.json`, os modelos `pi-code`/`pi-quality` têm `reasoning: true`, `compat.supportsReasoningEffort: true` e `thinkingLevelMap` todo em `none`.

**Kaspersky:** inspeciona HTTPS e o container não confia na raiz dele (`SELF_SIGNED_CERT_IN_CHAIN`, intermitente) — derrubava o pago e o combo caía no free. Exceção no Kaspersky: aplicativo `com.docker.backend.exe`, "Não verificar todo o tráfego" só na porta 443.

### `harness` — código do trabalho (DeepSeek Harness)

**Pendente** — revisar depois: código profissional não deveria passar por provider free que treina com prompt. Até lá, não usar o `harness` com código do trabalho.

### Fora dos combos (eval de 2026-10-19)

| Modelo | Motivo | Volta quando |
|---|---|---|
| `nvidia/moonshotai/kimi-k3` | 410 `model_shutdown` (NVIDIA desligou) — e o OmniRoute marcou a conexão nvidia inteira como sem credencial em seguida, derrubando os outros nvidia do mesmo combo | nunca, nessa conexão |
| `ollama-cloud/*` | 402: modelos fora do plano free ($20/mês) | se assinar o Pro |
| `sambanova/*` | 402: exige forma de pagamento; provider desativado (`isActive: false`) | se cadastrar pagamento |
| `gemini/*` | 403 "project denied access" | resolver o projeto no Google AI Studio |
| `nvidia/deepseek-ai/deepseek-v4.1-flash` | timeout de 120s nas 3 tarefas | reavaliar no próximo eval |
| `mistral/mistral-small-2603` | 429 nas 3 tarefas | reavaliar no próximo eval |
| `gemini/gemini-2.5-pro-preview-tts`, `bazaarlink/auto:free`, `glm/glm-4.7` | voz / aleatório / sem saldo (decisão de 2026-10-18) | — |

Pool free ficou fino (4 modelos, 3 providers): com várias sessões `claude-free` em paralelo, o DeepSeek pago vai ser acionado mais vezes que o planejado — acompanhar o saldo.

## Configurações globais

| Configuração | Valor | Por quê |
|---|---|---|
| Caveman (`cavemanConfig.enabled`) | `false` | Medido líquido negativo em sessão de código (`ai-ops/docs-human/ai-base/less-tokens.md`) |
| Pipeline de compressão padrão | só `rtk` (sem `caveman`) | idem |
| `semanticCacheEnabled` | `false` | Em trabalho agentic, prompt parecido com contexto diferente pode receber resposta velha — risco direto pro TDD |
| `promptCacheEnabled` | `true` | Cache de prefixo do próprio provider: corta custo sem risco de resposta velha |
| `context_cache_protection` | `true` nos combos `pi-*` | |
| `modelLockout` | só 403/404/429; 15s, máx. 2 min | erro de rede (502/503/504) é passageiro — antes travava até 30 min e tirava o pago da sessão |
| `modelLockout` | só 403/404/429, 15s → máx. 2 min | erro de rede (502/503/504) é passageiro; antes travava até 30 min e tirava o pago da sessão |

## API keys de cliente

| Nome | Uso | Acesso |
|---|---|---|
| `pi` | modos `claude-pago`/`claude-free` do Claude Code (variável `OMNIROUTE_API_KEY`, lida pelo `apiKeyHelper` de `~/.claude/modos/`). Nome e prefixo `pi-*` dos combos são históricos (do pi.dev, removido em 2026-10-24) — renomear gera chave nova | combos `pi-code`, `pi-exec`, `pi-light`, `pi-quality` |
| `eval` | `ai-ops/tools/omniroute-eval` | modelos individuais (sem combo) |
| `harness-geral` | DeepSeek Harness | pendente (ver `harness` acima) |

## Ranking

Fonte: `ai-ops/tools/omniroute-eval`. Última rodada: 2026-10-19, 1 run por tarefa (amostra pequena — rodar `node eval.mjs` com 2 runs pra confirmar a ordem).

| Modelo | Qualidade | Disponib. | Mediana |
|---|---|---|---|
| `bazaarlink/deepseek/deepseek-v4-flash-0731free:free` | 100% | 100% | 11s |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | 100% | 100% | 23s |
| `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | 100% | 100% | 24s |
| `groq/openai/gpt-oss-20b` | 100% | 67% | 14s |
| `groq/openai/gpt-oss-120b` | 67% | 100% | 3s |
| `cloudflare-ai/@cf/zai-org/glm-4.7-flash` | 67% | 100% | 14s |
| `mistral/ministral-14b-latest` | 67% | 100% | 15s |
| `cloudflare-ai/@cf/google/gemma-4-26b-a4b-it` | 67% | 100% | 25s |
| demais 8 | 0% | 0% | — (ver "Fora dos combos") |
