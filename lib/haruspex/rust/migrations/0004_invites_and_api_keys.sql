-- 0004: invite codes (from tomb's invite_codez) + api keys (from tomb's
-- user_accountz.api_key semantics), both keyed off haruspex's identityz.

-- invite codes: a single-use (or account-link) code that grants a role on
-- redemption. code_type distinguishes a regular invite (brand-new identity)
-- from an account-link code (redeemed by an existing identity to link a
-- new device - tomb's self-service "add a passkey on another device" flow).
CREATE TABLE invite_codez (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  code_type TEXT NOT NULL,
  grants_role TEXT NOT NULL,
  link_for_user_id TEXT REFERENCES identityz(id) ON DELETE CASCADE,
  link_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES identityz(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_invite_codez_active ON invite_codez(is_active) WHERE is_active = 1;

-- api keys: one active key per identity (tomb's user_accountz.api_key
-- column, lifted into its own table rather than a column on identityz so
-- issuing/revoking a key is a plain insert/delete, not an update racing
-- identityz's own upsert semantics).
CREATE TABLE api_keyz (
  identity_id TEXT PRIMARY KEY REFERENCES identityz(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL UNIQUE,
  issued_at INTEGER NOT NULL
);
