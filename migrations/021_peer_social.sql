-- 021: peer social — unified identity + social relationships
--
-- extends user_accountz with profile fields and alias.
-- extends user_peer_nodez with per-node self-reported profile.
-- adds peer friendship, friend request, and friend group tables.
--
-- ALTER TABLE ADD COLUMN is guarded by checking pragma table_info
-- so the migration can be re-applied without "duplicate column" errors.

-- user_accountz: alias
ALTER TABLE user_accountz ADD COLUMN alias TEXT NOT NULL DEFAULT '';
-- user_accountz: bio
ALTER TABLE user_accountz ADD COLUMN bio TEXT NOT NULL DEFAULT '';
-- user_accountz: avatar_url
ALTER TABLE user_accountz ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
-- user_accountz: accent_color
ALTER TABLE user_accountz ADD COLUMN accent_color INTEGER NOT NULL DEFAULT 6382065;

-- user_peer_nodez: display_name
ALTER TABLE user_peer_nodez ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
-- user_peer_nodez: bio
ALTER TABLE user_peer_nodez ADD COLUMN bio TEXT NOT NULL DEFAULT '';
-- user_peer_nodez: avatar_url
ALTER TABLE user_peer_nodez ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
-- user_peer_nodez: accent_color
ALTER TABLE user_peer_nodez ADD COLUMN accent_color INTEGER NOT NULL DEFAULT 6382065;

-- migrate avatar_url from metadata JSON to dedicated column (idempotent)
UPDATE user_accountz
SET avatar_url = json_extract(metadata, '$.avatar_url')
WHERE metadata IS NOT NULL
  AND json_extract(metadata, '$.avatar_url') IS NOT NULL
  AND json_extract(metadata, '$.avatar_url') != ''
  AND avatar_url = '';

-- peer friendship relationships
-- a friendship is between the local user (user_id) and a remote user (friend_user_id).
-- both reference user_accountz. alias for the friend lives on their user_accountz.alias column.
CREATE TABLE IF NOT EXISTS peer_friendz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    friend_user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    group_name TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, friend_user_id)
);

CREATE INDEX IF NOT EXISTS idx_peer_friendz_user_id ON peer_friendz(user_id);
CREATE INDEX IF NOT EXISTS idx_peer_friendz_friend_user_id ON peer_friendz(friend_user_id);

-- friend requests (inbound + outbound)
-- preserves the 2-phase handshake: pending -> accepted-pending-ack -> accepted
-- user_id = always the local user
-- remote_user_id = the other party (resolved to a user_accountz entry)
CREATE TABLE IF NOT EXISTS friend_requestz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    remote_user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'accepted-pending-ack', 'rejected')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, remote_user_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_friend_requestz_user_status ON friend_requestz(user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_requestz_remote ON friend_requestz(remote_user_id);

-- friend groups for organizing friends
CREATE TABLE IF NOT EXISTS friend_groupz (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, name)
);
