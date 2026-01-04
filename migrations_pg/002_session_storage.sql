-- Session Storage for Tower Sessions
-- PostgreSQL backend for session management

-- Sessions table for tower-sessions-sqlx-store
CREATE TABLE IF NOT EXISTS tower_sessions (
    id TEXT PRIMARY KEY,
    data BYTEA NOT NULL,
    expiry_date TIMESTAMPTZ NOT NULL
);

-- Indexes for efficient session management
CREATE INDEX IF NOT EXISTS idx_tower_sessions_expiry ON tower_sessions(expiry_date);
CREATE INDEX IF NOT EXISTS idx_tower_sessions_id ON tower_sessions(id);

-- Cleanup function for expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM tower_sessions WHERE expiry_date < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- Comments for documentation
COMMENT ON TABLE tower_sessions IS 'Session storage for tower-sessions with PostgreSQL backend';
COMMENT ON COLUMN tower_sessions.id IS 'Unique session identifier';
COMMENT ON COLUMN tower_sessions.data IS 'Serialized session data';
COMMENT ON COLUMN tower_sessions.expiry_date IS 'Session expiration timestamp';
COMMENT ON FUNCTION cleanup_expired_sessions() IS 'Utility function to clean up expired sessions';
