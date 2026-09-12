# Subir a infra compartilhada local — docs-human

**Você faz isso, não o agente sozinho** — envolve decidir senha/segredo real, mesmo que só de dev.

## Primeira vez numa máquina nova

1. Copiar `container/examples/env.example` pra `container/.env` (o `.gitignore` já cobre `.env`, nunca vai pro git).
2. Preencher os valores reais — cada bloco do arquivo é um grupo (Postgres, RabbitMQ, Keycloak, DefectDojo, Observability/Grafana). Guarda as senhas do jeito que você já guarda as outras.
3. Dentro de `container/`:
   ```powershell
   docker compose up -d --build
   ```
   `--build` é obrigatório — o Postgres builda local (pgAudit), não é imagem pronta.

## Confirma que subiu

Postgres (`5432`), pgAdmin (`15432`), Keycloak (`8080`), Redis (`6379`), RabbitMQ (`15672`), DefectDojo (`8443`, demora no primeiro boot — roda migration), Grafana (`3000`), Prometheus (`9090`).

Se o serviço `falco` não subir (risco conhecido em Docker Desktop/WSL2, driver eBPF pode não ter BTF): comenta ele no `docker-compose.yml` e segue, não bloqueia o resto.

## Se `.env` já existe e só precisa atualizar 1 valor

Edita direto, não precisa recriar do zero. `docker compose up -d` de novo já pega o valor novo pros serviços que dependem dele (alguns pedem restart do container específico: `docker compose restart <serviço>`).
