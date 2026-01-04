-- Core Authentication Schema
-- Consolidated migration for users, invite codes, and WebAuthn credentials

-- Users table (created first to avoid circular dependency)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invite_code_used VARCHAR(128),

    -- Constraints
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'member'))
);

-- Invite codes table (with full feature set including account linking)
CREATE TABLE IF NOT EXISTS invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at TIMESTAMPTZ,
    used_by_user_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    code_type VARCHAR(20) NOT NULL DEFAULT 'invite',
    link_for_user_id UUID,
    link_expires_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT invite_codes_type_check CHECK (code_type IN ('invite', 'account-link')),
    CONSTRAINT invite_codes_code_min_length_check CHECK (char_length(code) >= 8),
    CONSTRAINT fk_invite_codes_link_user FOREIGN KEY (link_for_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT link_code_has_user CHECK (
        (code_type = 'invite' AND link_for_user_id IS NULL) OR
        (code_type = 'account-link' AND link_for_user_id IS NOT NULL)
    ),
    CONSTRAINT link_code_has_expiry CHECK (
        (code_type = 'invite') OR
        (code_type = 'account-link' AND link_expires_at IS NOT NULL)
    )
);

-- Add foreign key from users to invite_codes (after both tables exist)
ALTER TABLE users ADD CONSTRAINT fk_users_invite_code
    FOREIGN KEY (invite_code_used) REFERENCES invite_codes(code);

-- WebAuthn credentials table
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    credential_id BYTEA NOT NULL UNIQUE,
    credential_data TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT fk_webauthn_credentials_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for invite_codes
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_active ON invite_codes(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_invite_codes_link_user ON invite_codes(link_for_user_id) WHERE link_for_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invite_codes_link_active ON invite_codes(code_type, is_active) WHERE code_type = 'account-link' AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_invite_codes_link_expires ON invite_codes(link_expires_at) WHERE link_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invite_codes_code_hash ON invite_codes USING hash(code);

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Indexes for webauthn_credentials
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_credential_id ON webauthn_credentials(credential_id);

-- Comments for documentation
COMMENT ON TABLE invite_codes IS 'Invite and account link codes for user registration and credential linking';
COMMENT ON COLUMN invite_codes.code IS 'Invite or account link code (8-128 characters, alphanumeric, hyphens, underscores)';
COMMENT ON COLUMN invite_codes.code_type IS 'Type of code: invite (new users) or account-link (existing users)';
COMMENT ON COLUMN invite_codes.link_for_user_id IS 'User ID this account link code is for (NULL for regular invite codes)';
COMMENT ON COLUMN invite_codes.link_expires_at IS 'Expiration time for account link codes (shorter than regular invites)';

COMMENT ON TABLE users IS 'User accounts with roles and authentication tracking';
COMMENT ON COLUMN users.role IS 'User role: admin or member';
COMMENT ON COLUMN users.invite_code_used IS 'The invite code used during registration';

COMMENT ON TABLE webauthn_credentials IS 'WebAuthn passkey credentials for passwordless authentication';
COMMENT ON COLUMN webauthn_credentials.credential_id IS 'Unique WebAuthn credential identifier';
COMMENT ON COLUMN webauthn_credentials.credential_data IS 'Serialized WebAuthn credential data';

-- Comments on constraints
COMMENT ON CONSTRAINT invite_codes_code_min_length_check ON invite_codes IS 'Ensures invite codes are at least 8 characters long for security';
