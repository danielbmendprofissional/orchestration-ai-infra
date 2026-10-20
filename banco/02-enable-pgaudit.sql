-- ai-infra/banco/02-enable-pgaudit.sql
-- pgaudit é extensão por banco (não global) — precisa CREATE EXTENSION em cada um.
-- Roda depois de 00-global-databases.sql (cria keycloak/valuto) e
-- 01-init-valuto-db.sql, por ordem alfabética do docker-entrypoint-initdb.d.

\c keycloak
CREATE EXTENSION IF NOT EXISTS pgaudit;

\c valuto
CREATE EXTENSION IF NOT EXISTS pgaudit;