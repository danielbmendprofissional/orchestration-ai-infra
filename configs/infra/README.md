# Infra compartilhada — configuração como código

Postgres, Redis, RabbitMQ, Keycloak, pgAdmin, Prometheus, Loki, Alloy e Grafana rodam **uma vez só** na máquina (`container/docker-compose.yml`) e servem vários projetos que não se conhecem. Cada projeto tem a sua "casa" em cada ferramenta e não enxerga a dos outros. O OmniRoute segue o mesmo princípio, com script próprio (`../omniroute/`).

Nada disso é configurado clicando na interface. Tudo sai de:

| Onde | O quê | Git |
|---|---|---|
| `projects.json` | **Manifesto**: quais projetos existem e o que cada um usa (Postgres, RabbitMQ, Redis, Keycloak, métricas) | sim |
| `keycloak/realm-defaults.json` | Política padrão de todo realm (senha, brute force, tempo de token, idioma) | sim |
| `container/<ferramenta>/` | Config de cada ferramenta (`redis.conf`, `rabbitmq.conf`, `loki.yaml`, `config.alloy`, `prometheus.yml` + `rules.yml`, provisioning e painéis do Grafana) | sim |
| `container/.env` | Segredos. Os de humano (admin de cada ferramenta) você preenche; os de máquina (`PG_*`, `REDIS_*`, `PROJECT_*`) o script gera | **nunca** |
| `container/generated/` | Derivado do manifesto + `.env`: ACL do Redis, alvos do Prometheus, servidores do pgAdmin, configuração de cada projeto | **nunca** (refeito a cada apply) |

## Comandos

```powershell
cd ai-infra\configs\infra
node infra-config.mjs up          # máquina nova / depois de mudar o compose: tudo, na ordem certa, e verifica no fim
node infra-config.mjs diff        # o que o apply mudaria (não muda nada, nem o .env)
node infra-config.mjs apply       # manifesto/.env → instâncias (só os serviços que estão de pé)
node infra-config.mjs verify      # saúde + muros entre projetos + portas + segredos; sai com erro se algo falhar
node infra-config.mjs dashboards export   # painel ajustado na UI do Grafana → container/grafana/dashboards/
node infra-versions.mjs check     # versão nova de cada imagem (só leitura; quem atualiza é o agent infra-versions-config)
```

`apply --only=postgres,redis,rabbitmq,keycloak,pgadmin` aplica só parte. Tudo é idempotente: rodar de novo não muda nada se já está certo.

**Nunca `docker compose up` puro numa máquina nova:** o Redis não sobe sem `generated/redis/users.acl`, e o Keycloak precisa da role/banco que o `apply` cria. Para reiniciar um serviço que já existe, `docker compose restart <serviço>` é ok.

## Os muros entre projetos (o que o `verify` prova)

| Ferramenta | Casa de cada projeto | Muro |
|---|---|---|
| Postgres | banco `<projeto>`, role dona `<projeto>_owner`, grupo `<projeto>_connect` (+ `<projeto>_app` no padrão) | `REVOKE CONNECT ... FROM PUBLIC` em **todo** banco. Só quem está no grupo do projeto conecta no banco dele |
| Redis | usuário ACL `<projeto>` | só chaves e canais `<projeto>:*`; `KEYS`/`SCAN`/`FLUSHALL`/`CONFIG` e todo comando `@dangerous` barrados; usuário `default` desligado |
| RabbitMQ | vhost `<projeto>` + usuário `<projeto>` | permissão só no próprio vhost; sem acesso à API/UI de gerenciamento |
| Keycloak | realm `<projeto>` | realm é isolado por natureza (usuários, clients, chaves próprios) |
| Prometheus / Loki / Grafana | rótulo `project=<projeto>` | aqui você é a "prefeitura": vê o bairro todo. Filtra por projeto |
| pgAdmin | grupo `<projeto>`, conectando como `<projeto>_owner`, restrito ao próprio banco | ferramenta da prefeitura |

E pra todos: porta só em `127.0.0.1`, imagem com versão fixa, cada container recebe só os próprios segredos.

## Manifesto (`projects.json`)

```jsonc
{
  "projects": {
    "<projeto>": {                       // só minúsculas e dígitos: vira banco, role, vhost, realm e prefixo
      "postgres": {},                    // banco + <projeto>_owner (migrations) + <projeto>_app (runtime, só DML)
      "rabbitmq": {},                    // vhost + usuário
      "redis": {},                       // usuário ACL em <projeto>:*
      "keycloak": {                      // realm + client <projeto>-api (BFF)
        "redirectUris": ["http://localhost:4200/api/v1/auth/callback"],
        "postLogoutRedirectUris": ["http://localhost:4200/*"],
        "devUsers": [{ "username": "dev" }]
      },
      "metrics": "host.docker.internal:<porta-da-api>"   // /metrics da API rodando no host
    }
  }
}
```

Opções, quando o projeto precisa fugir do padrão:

| Campo | Padrão | Uso |
|---|---|---|
| `postgres.roles` | `"infra"` | `"project"` = o projeto cria as próprias roles no script inicial (não cria `<projeto>_app`). Caso do Valuto: `vp_owner_*`/`vp_usu_*` por schema |
| `postgres.memberPattern` | `<projeto>\_%` | `LIKE` das roles do projeto que entram no grupo `<projeto>_connect` (Valuto: `vp\_%`) |
| `postgres.initScript` | — | SQL rodado **uma vez**, quando o banco nasce (caminho a partir de `ai-infra/`, ex. `banco/<projeto>/init-db.sql`) |
| `keycloak.realmRoles` | `[]` | roles do realm |
| `keycloak.defaultRoles` | `[]` | roles que todo usuário novo ganha |
| `keycloak.serviceAccountRoles` | `[]` | liga a service account do client, ex. `"realm-management/manage-users"` (API que cria usuário) |
| `keycloak.devUsers` | `[{ "username": "dev" }]` | usuários de teste, `<username>@<projeto>.local`, senha em `PROJECT_<P>_KEYCLOAK_DEV_PASSWORD`; `roles` opcional |
| `keycloak.directAccessGrants` | `false` | password grant. Fica desligado: o padrão é BFF + Authorization Code + PKCE |
| `keycloak.webOrigins` | `[]` | CORS. Vazio porque o BFF é mesma origem |

**Projeto novo** = acrescentar a entrada → `diff` → `apply` → `verify` → commit. Remover projeto do manifesto **não apaga nada** (banco/vhost/realm ficam): apagar dado é sempre manual.

## Segredos

| Variável | Quem preenche | Uso |
|---|---|---|
| `POSTGRES_USER/PASSWORD`, `PGADMIN_DEFAULT_*`, `RABBITMQ_DEFAULT_*`, `KEYCLOAK_ADMIN*`, `GF_SECURITY_ADMIN_*`, `OMNIROUTE_INITIAL_PASSWORD` | você (`container/examples/env.example`) | login de admin de cada ferramenta |
| `PG_KEYCLOAK_PASSWORD`, `PG_MONITORING_PASSWORD`, `REDIS_ADMIN_PASSWORD`, `REDIS_EXPORTER_PASSWORD`, `OMNIROUTE_REDIS_PASSWORD` | script | serviço ↔ serviço da infra |
| `PROJECT_<P>_PG_OWNER_PASSWORD`, `_PG_APP_PASSWORD`, `_RABBITMQ_PASSWORD`, `_REDIS_PASSWORD`, `_KEYCLOAK_CLIENT_SECRET`, `_KEYCLOAK_DEV_PASSWORD` | script | do projeto |

Gerado = 48 caracteres hex, gravado no `.env` na primeira vez e nunca impresso. Para trocar, apagar a linha e rodar `apply`, que gera uma nova e reaplica em todo lugar. Perder o `.env` não perde a infra: preencher de novo os logins de admin e rodar `apply` regenera e reaplica todas as senhas de máquina (depois recarregar o user-secrets dos projetos). O que **não** se recupera são as chaves de provider do OmniRoute — por isso o backup do `.env`.

O app do projeto não lê o `.env` da infra. Ele recebe `container/generated/projects/<projeto>.secrets.json` (formato .NET) e `<projeto>.env` (formato variável de ambiente), com os nomes do contrato em `ai-base/docs/agents/infra-local.md`.

## Observabilidade

- **Logs:** o Alloy lê o stdout de todo container (rótulos `project`, `service_name`, `container`) e recebe OTLP em `127.0.0.1:4317/4318` de app rodando fora do Docker (`service.namespace` vira `project`). O Loki detecta o nível sozinho (`detected_level`) em JSON/logfmt. Retenção de 30 dias.
- **Métricas:** Prometheus raspa a infra (exporters, Keycloak, RabbitMQ por fila/vhost, Loki, Alloy, Grafana) e a API de cada projeto (`metrics` no manifesto, via `generated/prometheus/projects.json`). Retenção de 30 dias. Alertas em `container/prometheus/rules.yml` (sem Alertmanager: aparecem no Prometheus e no Grafana).
- **Grafana:** datasources e painéis provisionados (`container/grafana/`). Pasta `infra`: Visão geral, Logs, PostgreSQL, Redis, RabbitMQ, APIs .NET (prometheus-net). Ajuste na UI → `dashboards export` → commit. Datasource só muda no arquivo (reiniciar o `grafana`).

Mudou `loki.yaml` → `docker compose restart loki`. Mudou `config.alloy`, `prometheus.yml` ou `rules.yml` → `apply` (recarrega sozinho). Mudou `redis.conf`/`rabbitmq.conf` → `docker compose restart <serviço>`.

## Upgrade de versão

Só pelo agent `ai-ops/agents/infra/infra-versions-config` (lê a release note, atualiza uma imagem por vez, `verify`, rollback se quebrar). `node infra-versions.mjs check` mostra o que existe de novo.
