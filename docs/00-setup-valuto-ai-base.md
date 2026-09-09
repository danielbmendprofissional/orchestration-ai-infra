# Setup de ambiente — valuto / ai-base / infra / template-ci

Registro do que foi feito nos 4 blocos de preparação, antes de retomar o pipeline `/grill-me` → spec → implementação. Escrito em 2026-09-07, depois dos 4 blocos genuinamente concluídos e testados (não é um plano — é o que já rodou).

---

## Bloco 1 — Ambiente da máquina

Confirmado instalado e funcional: Node v24.11.0, npm 11.6.1, git 2.55.0, dotnet 10.0.400, Docker 29.7.2, pi 0.85.1. Variáveis de ambiente confirmadas: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GITLAB_TOKEN`, `GITHUB_TOKEN`.

Nada precisou ser instalado — a máquina já tinha a base completa.

---

## Bloco 2 — Docker + Kubernetes local

### Infra compartilhada (`infra/container`)

Criado `infra/container/.env` (valores reais vêm do cofre pessoal, nunca commitados) com `POSTGRES_USER`, `POSTGRES_PASSWORD`, `PGADMIN_DEFAULT_EMAIL`, `PGADMIN_DEFAULT_PASSWORD`, `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`, `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD`.

**Problema encontrado e corrigido:** o `docker-compose.yml` não montava nenhum script em `docker-entrypoint-initdb.d` — nem o banco do Keycloak nem o do valuto eram criados automaticamente. Corrigido com:

- `infra/banco/00-global-databases.sql` (novo — bancos de nível infra, hoje `keycloak` e `valuto` via `CREATE DATABASE`).
- `docker-compose.yml`, serviço `postgres`, `volumes:` ganhou:
  ```yaml
  - ./init-db/00-global-databases.sql:/docker-entrypoint-initdb.d/00-global-databases.sql:ro
  - ../banco/valuto/init-db.sql:/docker-entrypoint-initdb.d/01-init-valuto-db.sql:ro
  ```
  (o script do valuto continua com fonte única em `infra/banco/valuto/init-db.sql`, só montado, não duplicado.)

Resultado confirmado via `docker compose up -d` + `docker compose ps`: os 5 serviços saudáveis — `postgres` (healthy), `pgadmin`, `keycloak` (schema Liquibase aplicado, 148 changesets, sem erro), `redis`, `rabbitmq`.

### Kubernetes local

Escolhido `kind` (Kubernetes-in-Docker, mesmo `kubectl`/API/manifests de produção — não é substituto "de brinquedo") via `winget install Kubernetes.kind`, em vez de Chocolatey+k3d, pra não precisar de um gerenciador de pacotes extra.

```powershell
kind create cluster --name valuto-local
kubectl cluster-info --context kind-valuto-local
kubectl get nodes
```

Node confirmado `Ready`. Visualização via extensão oficial "Kubernetes" do VS Code (detecta `kind-valuto-local` automaticamente pelo kubeconfig) — alternativa a "Docker Desktop pra Kubernetes" é o app **Lens** (`k8slens.dev`), não usado ainda mas documentado como opção.

---

## Bloco 3 — template-ci

Repo reestruturado: pasta `personal/` promovida pra raiz (o split `personal/` vs `tce/` não fazia mais sentido — o repo virou pessoal, `tce/` continua isolado e fora de qualquer edição).

**Correções aplicadas:**

1. **Self-reference do `include:`** — `ci-template.yml` e `ci-execucao.yml` apontavam pra `devsecops/templates_ci/templates_deploy` (projeto interno da TCE, inacessível do gitlab.com pessoal) e depois, numa correção intermediária, pra `personal/template-ci` (namespace incompleto). Corrigido em 17 ocorrências (nos dois arquivos principais + `banco/`, `build/`, `security/`, `examples/`) pra `project: personal.daniel.bmend/template-ci`, o path real do repo.

2. **Validação de MAJOR/MINOR no fluxo de tags** (`common/controlar-pipeline.yml`), pro modelo de versionamento adotado:
   - `vX.Y.Z-rcN` sempre nasce em dev (primeiro estágio do fluxo).
   - Toda alteração durante o ciclo de candidata incrementa `-rcN`, mantendo o core (`X.Y.Z`) intacto.
   - Nova candidata (`rc1`) só é aceita se for `MAJOR+1.0.0` ou `MAJOR.MINOR+1.0` sobre a última tag publicada — validado tanto na criação do `rc1` quanto na graduação pra tag final em produção (fecha uma brecha onde uma candidata desatualizada podia graduar depois de uma versão maior já ter sido publicada).
   - `Z` (patch) só muda como hotfix direto em produção — removido o atalho antigo de "minor direto sem passar por rc", que não fazia sentido pro modelo pessoal (era um resquício do fluxo da TCE).

3. **`.NET`: build once / deploy many** (`build/dotnet.yml` + `deploy/dotnet.yml`) — antes, `build-dotnet` só fazia `dotnet restore`; o build de verdade (`WebPublishMethod=MSDeploy`, build+publish acoplados) rodava dentro do job de deploy, uma vez por ambiente. Agora:
   - `build-dotnet` gera o pacote (`WebPublishMethod=Package`) uma vez por `csproj` listado em `DOTNET_DEPLOYS`, publica `publish/<nome>/<nome>.zip` + `.SetParameters.xml` como artifact.
   - `deploy-dotnet` consome esse artifact via `needs:` e roda só `msdeploy.exe -verb:sync`, sem recompilar.
   - **Pendente de validação real:** caminho do `msdeploy.exe` (`C:\Program Files\IIS\Microsoft Web Deploy V3\msdeploy.exe`) assumido, não confirmado contra o runner de verdade — só vai ser validado na primeira execução real do pipeline.

Tag `v1.0.0` publicada e confirmada (`git fetch --tags` no terminal real).

---

## Bloco 4 — GitLab

Token `GITLAB_TOKEN` já configurado (Bloco 1). MCP (`@zereight/mcp-gitlab`, já presente em `valuto/.mcp.json`) testado numa sessão local de Claude Code dentro do `valuto`: retornou as 3 issues reais abertas no projeto (`personal.daniel.bmend/valuto`), com labels e relação de bloqueio corretas — confirma que o token tem escopo suficiente e o MCP está funcional.

**Encontrado nesse teste:** as 3 issues (`#1` Registrar usuário, `#2` Confirmar email, `#3` Consentimento no primeiro login) tinham descrição apontando pro caminho antigo de spec (`backend/src/Modules/Identity/specs/NN-*.md`) em vez do atual (`specs/feature/identity/NN-nome.md`). Correção pedida à sessão local do valuto (fora do escopo desta sessão, que não tem acesso ao GitLab).

---

## Próximo passo

Com os 4 blocos fechados, o degrau antes da primeira fatia de verdade é o bootstrap: `.sln` do backend e a spec `shell/00-bootstrap-frontend.md` do frontend (já existe, ainda não executada). Depois disso: Fatia 1 (Registrar usuário) → Fatia 2 (Confirmar email) → Fatia 2.5 (Login — a fatia escolhida como prova prática completa do pipeline `/grill-me` → spec → tickets → implementação via `pi.dev` → code review → esteira).
