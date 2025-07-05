-- SQLite Authentication Schema
-- Core tables for users, invite codes, and WebAuthn credentials

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    invite_code_used TEXT,

    CHECK (role IN ('admin', 'member'))
);

-- Invite codes table
CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    code TEXT NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    used_by_user_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code_type TEXT NOT NULL DEFAULT 'invite',
    link_for_user_id TEXT,
    link_expires_at DATETIME,

    CHECK (code_type IN ('invite', 'account-link')),
    CHECK (length(code) >= 8),
    CHECK (
        (code_type = 'invite' AND link_for_user_id IS NULL) OR
        (code_type = 'account-link' AND link_for_user_id IS NOT NULL)
    ),
    FOREIGN KEY (link_for_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- WebAuthn credentials table
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    credential_id BLOB NOT NULL UNIQUE,
    credential_data TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add foreign key from users to invite_codes
-- Note: SQLite doesn't support adding foreign keys after table creation easily
-- So we'll create a trigger to enforce this relationship

-- Indexes for invite_codes
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_active ON invite_codes(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_invite_codes_link_user ON invite_codes(link_for_user_id) WHERE link_for_user_id IS NOT NULL;

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Indexes for webauthn_credentials
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_credential_id ON webauthn_credentials(credential_id);

-- Session Storage for tower-sessions
CREATE TABLE IF NOT EXISTS tower_sessions (
    id TEXT PRIMARY KEY,
    data BLOB NOT NULL,
    expiry_date DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tower_sessions_expiry ON tower_sessions(expiry_date);
