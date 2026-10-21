# ai-infra

Infra compartilhada de **dev local**: uma instância de cada serviço, rodando permanentemente na máquina, servindo todos os projetos (um "bairro" onde cada projeto tem a sua casa e não enxerga a dos outros). Nenhum ambiente publicado aponta pra cá: qa/hml/produção rodam os serviços dentro do cluster de cada projeto (`ai-ops/docs-human/ai-base/infra.md`).

| Serviço | Acesso (só `127.0.0.1`) | Casa de cada projeto |
|---|---|---|
| Postgres 17 + pgAudit | `localhost:5432` | banco + roles |
| pgAdmin | http://localhost:15432 | grupo de servidores |
| Keycloak | http://localhost:8080 | realm + client `<projeto>-api` |
| Redis | `localhost:6379` | usuário ACL `<projeto>:*` |
| RabbitMQ | `localhost:5672`, UI http://localhost:15672 | vhost + usuário |
| Grafana | http://localhost:3000 | rótulo `project` |
| Prometheus | http://localhost:9090 | rótulo `project` |
| Loki / Alloy | `localhost:3100` / UI http://localhost:12345, OTLP `localhost:4317-4318` | rótulo `project` |
| OmniRoute (gateway LLM do `pi`) | http://localhost:20128 | — |

## Estrutura

```
configs/
  infra/        projects.json (manifesto) + infra-config.mjs (up/apply/diff/verify) + infra-versions.mjs  → README.md
  omniroute/    config do gateway de LLM (mesmo princípio, script próprio)                               → README.md
  vscode/       profiles do VS Code
container/
  docker-compose.yml      planta dos serviços (versões fixas, portas em 127.0.0.1, segredos por serviço)
  <ferramenta>/           config de cada uma (redis, rabbitmq, loki, alloy, prometheus, grafana, postgres/Dockerfile)
  .env                    segredos (fora do git) — modelo em examples/env.example
  generated/              derivado do manifesto (fora do git)
banco/<projeto>/          SQL inicial de projeto que cria as próprias roles (ver abaixo)
backup/                   backup do Postgres (pg_dump por banco + globals)
```

## Uso

```powershell
# máquina nova: copiar container\examples\env.example → container\.env e preencher os logins de admin
cd configs\infra
node infra-config.mjs up        # sobe, configura os projetos e verifica
node infra-config.mjs verify    # a qualquer momento: saúde + muros
```

Projeto novo: entrada em `configs/infra/projects.json` → `node infra-config.mjs apply`. Feito pelo agent `ai-ops/agents/infra/local-environment-config`. Detalhes, opções do manifesto e segredos: [configs/infra/README.md](configs/infra/README.md).

Atualizar versão de imagem: agent `ai-ops/agents/infra/infra-versions-config`.

## `banco/valuto/`

Específico do Valuto (roles `vp_owner_*`/`vp_usu_*` por schema), rodado uma vez quando o banco nasce (`initScript` no manifesto). **Canônico: o repo do `valuto`** (`valuto/backend/infra/banco/01-init-valuto-db.sql`). Quando ele mudar, sincronizar aqui:

```powershell
Copy-Item "..\valuto\backend\infra\banco\01-init-valuto-db.sql" "banco\valuto\init-db.sql" -Force
```

Projeto no padrão (`postgres.roles: "infra"`) não precisa de pasta aqui: owner/app vêm do manifesto, e o schema é das migrations do próprio projeto.
