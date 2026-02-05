-- 005: user accounts - authentication and authorization

-- user accounts
CREATE TABLE user_accountz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('root', 'admin', 'member', 'viewer')),
  api_key TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

CREATE UNIQUE INDEX idx_user_accountz_username ON user_accountz(username);
CREATE INDEX idx_user_accountz_role ON user_accountz(role);
CREATE INDEX idx_user_accountz_created_at ON user_accountz(created_at DESC);
CREATE INDEX idx_user_accountz_active ON user_accountz(deleted_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_user_accountz_api_key ON user_accountz(api_key) WHERE api_key IS NOT NULL;

CREATE TRIGGER trg_user_accountz_updated_at
AFTER UPDATE ON user_accountz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE user_accountz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- invite codes
CREATE TABLE invite_codez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  code TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  used_at INTEGER,
  used_by_id TEXT,
  is_active INTEGER DEFAULT 1,
  code_type TEXT DEFAULT 'invite' CHECK (code_type IN ('invite', 'account-link')),
  link_for_user_id TEXT,
  link_expires_at INTEGER,
  FOREIGN KEY (used_by_id) REFERENCES user_accountz(id),
  FOREIGN KEY (link_for_user_id) REFERENCES user_accountz(id)
);

CREATE UNIQUE INDEX idx_invite_codez_code ON invite_codez(code);
CREATE INDEX idx_invite_codez_created_at ON invite_codez(created_at DESC);
CREATE INDEX idx_invite_codez_used_at ON invite_codez(used_at);
CREATE INDEX idx_invite_codez_active ON invite_codez(is_active) WHERE is_active = 1;
CREATE INDEX idx_invite_codez_type ON invite_codez(code_type);
CREATE INDEX idx_invite_codez_expires ON invite_codez(link_expires_at) WHERE link_expires_at IS NOT NULL;

-- webauthn credentials
CREATE TABLE user_credentialz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  credential_id BLOB NOT NULL UNIQUE,
  credential_data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  deleted_at INTEGER
);

CREATE INDEX idx_user_credentialz_user_id ON user_credentialz(user_id);
CREATE INDEX idx_user_credentialz_last_used ON user_credentialz(last_used_at DESC);
CREATE INDEX idx_user_credentialz_active ON user_credentialz(deleted_at) WHERE deleted_at IS NULL;

-- user sessions
CREATE TABLE user_sessionz (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,
  user_agent TEXT,
  ip_address TEXT
);

CREATE INDEX idx_user_sessionz_user_id ON user_sessionz(user_id);
CREATE INDEX idx_user_sessionz_expires ON user_sessionz(expires_at);
CREATE INDEX idx_user_sessionz_last_accessed ON user_sessionz(last_accessed_at DESC);
