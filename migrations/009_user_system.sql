-- User system tables - authentication, authorization, favorites, ratings

-- User accounts with roles and soft delete support
CREATE TABLE user_accountz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('root', 'admin', 'member', 'viewer')),
  api_key TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);

-- Invite codes for user registration with enhanced features
CREATE TABLE invite_codez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  code TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  used_at INTEGER,
  used_by_id TEXT,               -- reference to user_accountz.id
  is_active INTEGER DEFAULT 1,
  code_type TEXT DEFAULT 'invite' CHECK (code_type IN ('invite', 'account-link')),
  link_for_user_id TEXT,         -- for account-link codes
  link_expires_at INTEGER,       -- for account-link codes

  -- constraints
  FOREIGN KEY (used_by_id) REFERENCES user_accountz(id),
  FOREIGN KEY (link_for_user_id) REFERENCES user_accountz(id)
);

-- WebAuthn credentials for passwordless authentication
CREATE TABLE user_credentialz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  credential_id BLOB NOT NULL UNIQUE,
  credential_data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER,
  deleted_at INTEGER
);

-- User sessions (optional - can use tower-sessions instead)
CREATE TABLE user_sessionz (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_accessed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER,
  user_agent TEXT,
  ip_address TEXT
);

-- User favorites for songs, artists, albums, genres, playlists
CREATE TABLE user_favoritez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('song', 'artist', 'album', 'genre', 'playlist')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE(user_id, target_type, target_id)
);

-- User ratings for songs, artists, albums (1-5 stars)
CREATE TABLE user_ratingz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('song', 'artist', 'album')),
  target_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

  UNIQUE(user_id, target_type, target_id)
);

-- Triggers for automatic timestamp updates
CREATE TRIGGER trg_user_accountz_updated_at
AFTER UPDATE ON user_accountz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE user_accountz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER trg_user_ratingz_updated_at
AFTER UPDATE ON user_ratingz
FOR EACH ROW
WHEN OLD.updated_at = NEW.updated_at OR NEW.updated_at IS NULL
BEGIN
  UPDATE user_ratingz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- Indexes for user_accountz
CREATE UNIQUE INDEX idx_user_accountz_username ON user_accountz(username);
CREATE INDEX idx_user_accountz_role ON user_accountz(role);
CREATE INDEX idx_user_accountz_created_at ON user_accountz(created_at DESC);
CREATE INDEX idx_user_accountz_active ON user_accountz(deleted_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_user_accountz_api_key ON user_accountz(api_key) WHERE api_key IS NOT NULL;

-- Indexes for invite_codez
CREATE UNIQUE INDEX idx_invite_codez_code ON invite_codez(code);
CREATE INDEX idx_invite_codez_created_at ON invite_codez(created_at DESC);
CREATE INDEX idx_invite_codez_used_at ON invite_codez(used_at);
CREATE INDEX idx_invite_codez_active ON invite_codez(is_active) WHERE is_active = 1;
CREATE INDEX idx_invite_codez_type ON invite_codez(code_type);
CREATE INDEX idx_invite_codez_expires ON invite_codez(link_expires_at) WHERE link_expires_at IS NOT NULL;

-- Indexes for user_credentialz
CREATE INDEX idx_user_credentialz_user_id ON user_credentialz(user_id);
CREATE INDEX idx_user_credentialz_last_used ON user_credentialz(last_used_at DESC);
CREATE INDEX idx_user_credentialz_active ON user_credentialz(deleted_at) WHERE deleted_at IS NULL;

-- Indexes for user_sessionz
CREATE INDEX idx_user_sessionz_user_id ON user_sessionz(user_id);
CREATE INDEX idx_user_sessionz_expires ON user_sessionz(expires_at);
CREATE INDEX idx_user_sessionz_last_accessed ON user_sessionz(last_accessed_at DESC);

-- Indexes for user_favoritez
CREATE INDEX idx_user_favoritez_user_id ON user_favoritez(user_id);
CREATE INDEX idx_user_favoritez_target ON user_favoritez(target_type, target_id);
CREATE INDEX idx_user_favoritez_created ON user_favoritez(created_at DESC);
CREATE INDEX idx_user_favoritez_user_type ON user_favoritez(user_id, target_type);

-- Indexes for user_ratingz
CREATE INDEX idx_user_ratingz_user_id ON user_ratingz(user_id);
CREATE INDEX idx_user_ratingz_target ON user_ratingz(target_type, target_id);
CREATE INDEX idx_user_ratingz_rating ON user_ratingz(rating);
CREATE INDEX idx_user_ratingz_updated ON user_ratingz(updated_at DESC);
CREATE INDEX idx_user_ratingz_user_type ON user_ratingz(user_id, target_type);

-- ============================================================================
-- Soft-delete support for metadata tables (genrez, sub_genrez, tagz)
-- ============================================================================

-- Add deleted_at and deleted_by to genrez
ALTER TABLE genrez ADD COLUMN deleted_at INTEGER;
ALTER TABLE genrez ADD COLUMN deleted_by TEXT;

-- Add deleted_at and deleted_by to sub_genrez
ALTER TABLE sub_genrez ADD COLUMN deleted_at INTEGER;
ALTER TABLE sub_genrez ADD COLUMN deleted_by TEXT;

-- Add deleted_at and deleted_by to tagz
ALTER TABLE tagz ADD COLUMN deleted_at INTEGER;
ALTER TABLE tagz ADD COLUMN deleted_by TEXT;

-- Create indexes for efficient querying of non-deleted items
CREATE INDEX idx_genrez_deleted_at ON genrez(deleted_at);
CREATE INDEX idx_sub_genrez_deleted_at ON sub_genrez(deleted_at);
CREATE INDEX idx_tagz_deleted_at ON tagz(deleted_at);
