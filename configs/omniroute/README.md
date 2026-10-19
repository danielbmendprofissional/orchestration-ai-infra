# OmniRoute — configuração como código

O OmniRoute guarda tudo no próprio SQLite e não lê arquivo de configuração. Esta pasta torna a configuração fixa e versionada. Recriar o container, trocar de máquina ou perder o volume vira só rodar `apply`.

| Onde | O quê | Git |
|---|---|---|
| `config/*.json` | Tudo que é configuração: providers, combos, settings, compressão, RTK, cache, banco, resiliência, modelos ocultos/custom, API keys de cliente (permissões) | sim, **sem nenhum segredo** |
| `infra/container/.env` | Segredos: chave de cada provider (`OMNIROUTE_KEY_<PROVIDER>`), chaves extras, valor das API keys de cliente (`OMNIROUTE_CLIENT_KEY_<NOME>`), senha do dashboard (`OMNIROUTE_INITIAL_PASSWORD`) | **nunca** |
| volume `infra_omniroute_data` | Estado de runtime: logs, uso, catálogo de modelos sincronizado, segredos internos que o container gera sozinho (`JWT_SECRET`, `STORAGE_ENCRYPTION_KEY`, `API_KEY_SECRET`) | não — descartável, `apply` reconstrói |
| `combos.md` | Por que cada combo/setting é como é (decisões) | sim |

O `.env` é a única coisa que não se reconstrói: fazer backup dele (Google Drive / gerenciador de senhas).

Segredo dentro de `config/*.json` aparece só como placeholder `"${ENV:NOME}"`, resolvido do `.env` na hora do `apply`.

## Comandos

```powershell
cd infra\configs\omniroute
node omniroute-config.mjs diff                  # o que o apply mudaria (não muda nada)
node omniroute-config.mjs apply                 # git + .env → instância
node omniroute-config.mjs apply --setx          # idem, e grava no Windows a key de cliente recém-criada (OMNIROUTE_API_KEY etc.)
node omniroute-config.mjs export                # instância → config/*.json (pra versionar o que mudou no dashboard)
```

Opções: `--url=` (padrão `http://127.0.0.1:20128`), `--env=` (padrão `infra/container/.env`), `--config=` (padrão `./config`).

| Opção | Efeito |
|---|---|
| `--prune` | `apply`/`diff` também removem da instância o que não está no git (provider, combo, key, modelo custom) e reexibem modelos ocultos fora da lista. Sem ela, só cria/atualiza. |
| `--sync-secrets` | Reenvia as chaves de provider do `.env` (rotação de chave). Sem ela, chave só é enviada na criação — a instância nunca devolve a chave real, então não dá pra comparar. |
| `--harvest-secrets` | No `export`: lê as chaves reais da instância e grava no `.env` (só as que ainda não existem lá; `--overwrite-secrets` sobrescreve). Valor nunca aparece no terminal. |
| `--ask-password` | Pergunta a senha do dashboard sem eco, em vez de usar `OMNIROUTE_INITIAL_PASSWORD` do `.env`. |

Login: `OMNIROUTE_PASSWORD` (variável) › `--ask-password` › `OMNIROUTE_INITIAL_PASSWORD` do `.env` › `OMNIROUTE_MANAGE_KEY` (API key com escopo `manage`). **Não trocar a senha no dashboard** sem atualizar o `.env` — o `apply` loga com ela.

## Fluxo do dia a dia

- **Mudar config:** editar `config/*.json` → `diff` → `apply` → commit. Ou mudar no dashboard → `export` → revisar `git diff` → commit. Os dois caminhos acabam no git; `diff` limpo = instância e git iguais.
- **Chave de provider nova/rotacionada:** editar a linha no `.env` → `apply --sync-secrets`.
- **Provider novo:** adicionar no `providers.json` com `"apiKey": "${ENV:OMNIROUTE_KEY_<PROVIDER>}"`, a chave no `.env`, `apply`.

## Semântica do apply

- Identidade: provider = `provider/name`, combo = `name`, API key = `name`. Ids internos não são versionados (mudam entre instâncias); combo que fixa conexão usa `"connection": "provider/name"`.
- Comparação por cobertura: todo campo declarado no git precisa bater; campo que a instância tem a mais (default novo de versão mais nova) não conta como diferença. Escrita faz merge profundo, sem apagar esses defaults.
- Combo que referencia outro (`"kind": "combo-ref"`) é criado depois do referenciado.
- API key de cliente: o **valor** é sempre gerado pelo servidor. Na criação, o `apply` grava em `OMNIROUTE_CLIENT_KEY_<NOME>` no `.env`; se a key tiver `"windowsEnv"` no `api-keys.json` e o `apply` rodar com `--setx`, grava também na variável do Windows (vale em terminal novo).
- Campos de runtime/derivados nunca entram no git (`settingsRevision`, portas, `embeddingOptions`, `apiKeyHealth`, `stats`...) — lista no topo do script (`readOnly`).
- Provider OAuth (assinatura) não é aplicado — só API key (ver `combos.md`, princípio 1).

## Upgrade do OmniRoute

A imagem é fixa em `container/docker-compose.yml`. Pra subir de versão: trocar a tag, `docker compose up -d omniroute`, `diff` (deve continuar limpo — campo novo não conta), `export` pra registrar os defaults novos no git, commit. Testado: export da 3.8.50 aplicado na 3.8.51 converge sem perda.
