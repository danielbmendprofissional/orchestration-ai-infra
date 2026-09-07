-- =====================================================================================
-- Valuto — Init Script (DEV)
-- Roda automaticamente via docker-entrypoint-initdb.d na 1a inicialização do container.
-- Em hml/prd: mesmo script, executado manualmente (ou via pipeline) na instância
-- Postgres daquele namespace AKS, com senhas vindas do Azure Key Vault (ADR-016).
--
-- Modelo: 1 banco "valuto" por ambiente. Módulos = schemas (ADR-002).
-- Cada módulo tem 2 roles:
--   vp_owner_{module} -> dono do schema, usado em MIGRATIONS (DDL)
--   vp_usu_{module}   -> usado pela API em runtime (DML apenas, sem DDL — ADR-026)
-- =====================================================================================

-- O banco "valuto" já é criado via POSTGRES_DB no .env — conectar nele.
\c valuto

-- =====================================================================================
-- IDENTITY
-- =====================================================================================
CREATE ROLE vp_owner_identity LOGIN PASSWORD 'owner_identity_dev';

CREATE ROLE vp_usu_identity LOGIN PASSWORD 'usu_identity_dev';

CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION vp_owner_identity;

GRANT ALL ON SCHEMA identity TO vp_owner_identity;

GRANT USAGE ON SCHEMA identity TO vp_usu_identity;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_identity IN SCHEMA identity
GRANT DELETE,
INSERT
,
SELECT,
UPDATE ON TABLES TO vp_usu_identity;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_identity IN SCHEMA identity
GRANT
SELECT, USAGE ON SEQUENCES TO vp_usu_identity;

-- =====================================================================================
-- FINANCIAL
-- =====================================================================================
CREATE ROLE vp_owner_financial LOGIN PASSWORD 'owner_financial_dev';

CREATE ROLE vp_usu_financial LOGIN PASSWORD 'usu_financial_dev';

CREATE SCHEMA IF NOT EXISTS financial AUTHORIZATION vp_owner_financial;

GRANT ALL ON SCHEMA financial TO vp_owner_financial;

GRANT USAGE ON SCHEMA financial TO vp_usu_financial;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_financial IN SCHEMA financial
GRANT DELETE,
INSERT
,
SELECT,
UPDATE ON TABLES TO vp_usu_financial;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_financial IN SCHEMA financial
GRANT
SELECT, USAGE ON SEQUENCES TO vp_usu_financial;

-- =====================================================================================
-- PERSONAL
-- =====================================================================================
CREATE ROLE vp_owner_personal LOGIN PASSWORD 'owner_personal_dev';

CREATE ROLE vp_usu_personal LOGIN PASSWORD 'usu_personal_dev';

CREATE SCHEMA IF NOT EXISTS personal AUTHORIZATION vp_owner_personal;

GRANT ALL ON SCHEMA personal TO vp_owner_personal;

GRANT USAGE ON SCHEMA personal TO vp_usu_personal;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_personal IN SCHEMA personal
GRANT DELETE,
INSERT
,
SELECT,
UPDATE ON TABLES TO vp_usu_personal;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_personal IN SCHEMA personal
GRANT
SELECT, USAGE ON SEQUENCES TO vp_usu_personal;

-- =====================================================================================
-- CALENDAR
-- =====================================================================================
CREATE ROLE vp_owner_calendar LOGIN PASSWORD 'owner_calendar_dev';

CREATE ROLE vp_usu_calendar LOGIN PASSWORD 'usu_calendar_dev';

CREATE SCHEMA IF NOT EXISTS calendar AUTHORIZATION vp_owner_calendar;

GRANT ALL ON SCHEMA calendar TO vp_owner_calendar;

GRANT USAGE ON SCHEMA calendar TO vp_usu_calendar;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_calendar IN SCHEMA calendar
GRANT DELETE,
INSERT
,
SELECT,
UPDATE ON TABLES TO vp_usu_calendar;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_calendar IN SCHEMA calendar
GRANT
SELECT, USAGE ON SEQUENCES TO vp_usu_calendar;

-- =====================================================================================
-- NOTIFICATIONS
-- =====================================================================================
CREATE ROLE vp_owner_notifications LOGIN PASSWORD 'owner_notifications_dev';

CREATE ROLE vp_usu_notifications LOGIN PASSWORD 'usu_notifications_dev';

CREATE SCHEMA IF NOT EXISTS notifications AUTHORIZATION vp_owner_notifications;

GRANT ALL ON SCHEMA notifications TO vp_owner_notifications;

GRANT USAGE ON SCHEMA notifications TO vp_usu_notifications;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_notifications IN SCHEMA notifications
GRANT DELETE,
INSERT
,
SELECT,
UPDATE ON TABLES TO vp_usu_notifications;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_notifications IN SCHEMA notifications
GRANT
SELECT
,
    USAGE ON SEQUENCES TO vp_usu_notifications;

-- =====================================================================================
-- WOLVERINE (outbox / mensageria — schema compartilhado, ADR-007)
-- Todos os módulos publicam/consomem mensagens através deste schema.
-- Role própria, sem vínculo a um módulo específico.
-- =====================================================================================
CREATE ROLE vp_owner_wolverine LOGIN PASSWORD 'owner_wolverine_dev';

CREATE ROLE vp_usu_wolverine LOGIN PASSWORD 'usu_wolverine_dev';

CREATE SCHEMA IF NOT EXISTS wolverine AUTHORIZATION vp_owner_wolverine;

GRANT ALL ON SCHEMA wolverine TO vp_owner_wolverine;

GRANT USAGE ON SCHEMA wolverine TO vp_usu_wolverine;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_wolverine IN SCHEMA wolverine
GRANT DELETE,
INSERT
,
SELECT,
UPDATE ON TABLES TO vp_usu_wolverine;

ALTER DEFAULT PRIVILEGES FOR ROLE vp_owner_wolverine IN SCHEMA wolverine
GRANT
SELECT, USAGE ON SEQUENCES TO vp_usu_wolverine;

-- Cada vp_usu_wolverine precisa ler/escrever no schema wolverine independente do módulo
-- que está publicando/consumindo a mensagem (mensageria in-process no monolito).
GRANT vp_usu_wolverine TO vp_usu_identity,
vp_usu_financial,
vp_usu_personal,
vp_usu_calendar,
vp_usu_notifications;

-- =====================================================================================
-- TESTE DE ISOLAMENTO (rodar manualmente, não faz parte do init)
-- Conectar como vp_usu_financial e tentar acessar schema de outro módulo:
--   SET search_path TO identity;
--   SELECT * FROM identity.users;   -- deve falhar: permission denied for schema identity
-- =====================================================================================
