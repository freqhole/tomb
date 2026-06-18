-- 046_webauthn_challenges.sql
--
-- adds a server-side challenge store for webauthn over p2p transport.
-- http transport uses tower_sessions for challenge storage; p2p has no
-- cookie session available, so challenges are persisted here keyed by
-- a short-lived nonce that the client echoes back in the finish call.
--
-- cleanup: expired rows are deleted lazily on take_challenge reads plus
-- an optional periodic sweep. ttl is driven by server config
-- (server.auth.webauthn_challenge_ttl_minutes, default 15).

CREATE TABLE IF NOT EXISTS webauthn_challenges (
    -- random uuid generated on register_start / login_start
    nonce           TEXT PRIMARY KEY,
    -- "registration" or "authentication"
    kind            TEXT NOT NULL,
    -- serialized PasskeyRegistration or PasskeyAuthentication JSON
    challenge_json  TEXT NOT NULL,
    -- set for authentication (null during registration before user is looked up)
    user_id         TEXT,
    -- set for registration
    username        TEXT,
    -- whether this challenge was created via an account-link invite flow
    is_account_link INTEGER NOT NULL DEFAULT 0,
    -- optional invite code carried through from start to finish
    invite_code     TEXT,
    -- unix epoch seconds
    created_at      INTEGER NOT NULL,
    -- unix epoch seconds; row should be rejected and deleted after this time
    expires_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at
    ON webauthn_challenges (expires_at);
