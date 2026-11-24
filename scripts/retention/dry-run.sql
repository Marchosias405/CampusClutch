\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '3s';
SELECT CURRENT_TIMESTAMP AS retention_as_of \gset
\ir report.sql
SELECT * FROM safety_private.routine_log_inventory();
ROLLBACK;
