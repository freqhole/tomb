-- 0003: webauthn challenge storage (the p2p-friendly replacement for
-- cookie-based challenge sessions - see stores::challenge_store).

CREATE TABLE webauthn_challengez (
  nonce TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  challenge_json TEXT NOT NULL,
  identity_id TEXT,
  username TEXT,
  is_account_link INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_webauthn_challengez_expires_at ON webauthn_challengez(expires_at);
