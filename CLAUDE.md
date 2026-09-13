# CLAUDE.md — Bootstrap de ambiente (infra + ai-base)

Este arquivo é pra um agente de IA com acesso a shell (Claude Code, `pi`, ou equivalente) que vai configurar uma máquina do zero — não é convenção de código, é um roteiro de execução. Pressupõe `infra/` e `ai-base/` clonados como pastas irmãs (`C:\Users\danib\source\repos\infra` e `...\ai-base`). Se só um dos dois existir ainda, clone o outro antes de começar.

A fonte de verdade de cada comando fica nos docs abaixo — este arquivo só define **ordem, o que automatizar sozinho, e onde parar pra esperar o humano**. Não copie os comandos pra cá: se um comando mudar no doc de origem, este arquivo não deveria precisar mudar junto.

## Regra fixa: quando PARAR e não seguir sozinho

- **Segredo real** (chave de API, senha de banco, token): nunca inventar, nunca gerar um placeholder e seguir como se fosse valor final. Peça o valor ao humano, ou peça que ele mesmo rode o comando que grava o segredo (`setx`, `/login`, editar `.env`).
- **Instalador gráfico** (Alethe, Google Drive for Desktop): o agente não consegue clicar em wizard nenhum. Diga ao humano quais 2-3 cliques faltam e espere confirmação antes de considerar a fase concluída.
- **`git push`**: nunca, em nenhuma fase deste bootstrap, mesmo depois de tudo funcionando. Deixe os commits locais (`git log --oneline` pra revisão) e pare.
- **Qualquer coisa marcada como pendência/decisão em aberto** em `ai-base/docs-human/pendencias.md` (ex: política de rede do Kubernetes, `pgdsat` manual vs. agendado): não decida por conta própria. Pule essa parte, avise que ficou pendente, e continue o resto do bootstrap.
- **Promoção de branch** (`dev → qa → hml → master`) e qualquer coisa em `docs/agents/esteira-deploy.md`: fora do escopo deste bootstrap — isso é fluxo de projeto já nascido, não configuração de máquina.

Se uma fase exigir parar, não aborte o bootstrap inteiro — registre o que falta, pule pra próxima fase que não depende daquilo, e retome quando o humano confirmar.

## Ordem de execução

### Fase 0 — Pré-requisitos da máquina
Verificar `node -v`, `npm -v`, `git --version`, `docker --version`. Se algum faltar, PARE e peça pro humano instalar (não existe comando único de instalação pros 4 que valha rodar às cegas em qualquer Windows). Detalhe: `ai-base/docs-human/comandos-para-rodar.md`, passo 1.

### Fase 1 — Instalar `pi.dev` + adapter de MCP
Automatizável: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`, depois `pi install npm:pi-mcp-adapter`. Confirmar com `pi --version`. Detalhe: passo 2 do mesmo doc.

### Fase 2 — Chaves de API (Deepseek, OpenAI)
PARE aqui. Peça as duas chaves ao humano (ou peça que ele rode `/login deepseek` e `/login openai` dentro de uma sessão `pi`, se preferir não usar `setx`). Sem isso, a Fase 6 não confirma nada. Detalhe: passo 3.

### Fase 3 — Alethe (app dos painéis)
PARE aqui — instalador gráfico. Peça ao humano pra baixar e instalar (link no passo 4 do doc) e confirmar que abriu.

### Fase 4 — `glab` (CLI do GitLab)
Automatizável a instalação (`winget install GLab.GLab`). A autenticação (`glab auth login`) abre navegador — PARE e espere o humano logar. Detalhe: passo 5.

### Fase 5 — Subir a infra compartilhada (`infra/container`)
1. Verificar se `infra/container/.env` já existe. Se não existir: copiar de `container/examples/env.example` e **PARAR** — cada valor ali é segredo real (Postgres, RabbitMQ, Keycloak, DefectDojo, Grafana), não preencher com placeholder e seguir.
2. Com `.env` preenchido, automatizável: `docker compose up -d --build` dentro de `infra/container/` (`--build` é obrigatório, o Postgres builda local com pgAudit).
3. Confirmar saudável: Postgres (`5432`), pgAdmin (`15432`), Keycloak (`8080`), Redis (`6379`), RabbitMQ (`15672`), DefectDojo (`8443`, demora no primeiro boot), Grafana (`3000`), Prometheus (`9090`).
4. Se `falco` não subir (driver eBPF sem BTF em WSL2/Docker Desktop é um risco conhecido, não uma falha de configuração): comentar o serviço no `docker-compose.yml` e seguir — não bloqueia o resto.
Detalhe: `infra/docs-human/container-setup.md`.

### Fase 6 — Testar tudo junto
Automatizável: `cd ai-base && pi`, dentro da sessão rodar `/model` e confirmar que `deepseek-v4-flash` e `gpt-5.6-luna` aparecem (prova que a Fase 2 funcionou). Sair com `/exit`. Detalhe: passo 6.

### Fase 7 — Skills base do `ai-base`
Automatizável, idempotente (reinstala/atualiza, não duplica): Matt Pocock (`npx skills add https://github.com/mattpocock/skills -s '*' -a claude-code -y`), Angular (`npx skills add https://github.com/angular/skills -s '*' -a claude-code -y`), `avoid-ai-design` (`git clone` direto em `.claude/skills/avoid-ai-design`). Confirmar com `/skills` dentro de uma sessão Claude Code. Detalhe: passo 8.

### Fase 8 — Nascimento de projeto novo (só quando o humano pedir um projeto específico)
Automatizável dentro dos containers já de pé: criar banco Postgres (`CREATE DATABASE <projeto>`), vhost RabbitMQ, realm Keycloak, ACL user Redis — todos via `docker exec` nos containers da Fase 5. Depois disso, criar `infra/banco/<projeto>/init-db.sql`. As senhas geradas aqui: guardar do jeito que o humano já guarda as outras, nunca hardcoded em arquivo versionado. Detalhe: passo 11 de `comandos-para-rodar.md`.

### Fase 9 — MCP do projeto
Automatizável: seguir `infra/docs/mcp-setup.md` + `infra/docs-human/mcp-templates.md` — copiar bloco GitLab (sempre) e GitHub (só se o projeto precisar) pro `.mcp.json` do projeto, sempre `"disabled": true`, sempre `${VAR}` nunca token literal. Se a variável de ambiente referenciada ainda não existir na máquina, PARE e peça ao humano pra criar — não adivinhar valor.

### Fase 10 — Skills de segurança (auditoria manual, opcional)
Automatizável quando o humano pedir auditoria de um projeto específico: comandos do passo 13 de `comandos-para-rodar.md` (núcleo: `getsentry/skills` seletivo + `briiirussell/cybersecurity-skills` seletivo — **nunca "Select All"**, colide com `/code-review` do Matt Pocock). Depois de instalar, confirmar/adicionar `disable-model-invocation: true` em cada `SKILL.md` instalado — os repos de origem não garantem esse campo sozinhos.

### Fase 11 — Kubernetes local (opcional, só treino)
Só executar se o humano pedir explicitamente essa prática — não é parte obrigatória do bootstrap de máquina. Detalhe completo: `infra/docs-human/kubernetes-local.md`.

## O que este bootstrap **não** cobre

Kubernetes de produção em nuvem (`infra/docs-human/infra.md`), a esteira de CI/CD do `template-ci` (gap conhecido: `code-review-verify.yml` órfão, falta job `deploy-kubernetes` — ver `ai-base/docs-human/pendencias.md`), design system por projeto (`impeccable`/`ui-ux-pro-max-skill`/PrimeNG — só faz sentido dentro de um projeto Angular real, não na máquina). Essas fases têm dono e doc próprios; não improvisar aqui.

## Checklist final de verificação

- `pi --version` responde e `/model` lista os dois modelos.
- `docker compose ps` dentro de `infra/container` mostra os serviços saudáveis (exceto `falco`, se for o caso conhecido).
- `/skills` dentro do Claude Code lista Matt Pocock + Angular + `avoid-ai-design`.
- `glab auth status` confirma login.
- Nenhum commit foi dado `push` — `git status`/`git log` mostram só trabalho local.