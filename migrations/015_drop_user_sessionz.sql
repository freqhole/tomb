-- drop unused user_sessionz table
-- sessions are managed by tower_sessions library (tower_sessions table)
-- this table was never queried anywhere in the codebase

DROP INDEX IF EXISTS idx_user_sessionz_user_id;
DROP INDEX IF EXISTS idx_user_sessionz_expires;
DROP INDEX IF EXISTS idx_user_sessionz_last_accessed;
DROP TABLE IF EXISTS user_sessionz;
