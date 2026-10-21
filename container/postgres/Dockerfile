# Postgres 17 + pgAudit. Versão fixa — upgrade de MAJOR (17 → 18) nunca é só trocar a tag:
# exige dump/restore (ou pg_upgrade); o agent infra-versions-config trata como "depende do humano".
FROM postgres:17.11-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-pgaudit \
    && rm -rf /var/lib/apt/lists/*
