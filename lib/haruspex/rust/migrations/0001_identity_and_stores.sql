-- 0001: identity module + five of the six store traits (identity, peer
-- directory, friend, knock, credential). grant_store's real implementation
-- depends on the acl evaluator's resource-ancestry model and lands in a
-- later migration - no role_grantz table yet.

-- identities: a stable auth identity that can own zero or more device node
-- ids. username is optional - skein/playlistz peers may be anonymous.
CREATE TABLE identityz (
  id TEXT PRIMARY KEY,
  username TEXT,
  created_at INTEGER NOT NULL,
  metadata TEXT,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX idx_identityz_username ON identityz(username) WHERE username IS NOT NULL;

-- device nodes: maps iroh node ids onto identities. a node id belongs to
-- exactly one identity, globally and forever - the unique index below
-- covers soft-deleted rows too, so a deleted node id can never be silently
-- re-registered to a different identity (ported from tomb's
-- user_peer_nodez plus its 028 soft-delete migration, which deliberately
-- keeps this index non-partial for the same reason).
CREATE TABLE device_nodez (
  identity_id TEXT NOT NULL REFERENCES identityz(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  instance_name TEXT,
  last_seen_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (identity_id, node_id)
);

CREATE UNIQUE INDEX idx_device_nodez_node_id ON device_nodez(node_id);
CREATE INDEX idx_device_nodez_identity_id ON device_nodez(identity_id);
CREATE INDEX idx_device_nodez_active ON device_nodez(deleted_at) WHERE deleted_at IS NULL;

-- peer directory: what a peer shows you (display name, alias, bio, avatar),
-- kept separate from identityz - a profile is not an authenticated claim.
-- ported from skein's userz table, including its coalesce-based partial
-- upsert semantics (see sqlite::peer_directory).
CREATE TABLE peerz (
  node_id TEXT PRIMARY KEY,
  display_name TEXT,
  alias TEXT,
  bio TEXT,
  avatar_blake3 TEXT,
  accent_color TEXT,
  is_self INTEGER NOT NULL DEFAULT 0,
  is_hub INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- friend edges: node-id-scoped relationship state (pending/accepted/
-- allowed/blocked), directional (who initiated).
CREATE TABLE friendz (
  node_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  direction TEXT NOT NULL,
  alias TEXT,
  group_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_friendz_status ON friendz(status);

-- knocks: the unified access-request record. dedup enforces one active
-- (pending) knock per node id + scope; scope_key is a canonical json
-- rendering of the scope enum used only for that uniqueness check, while
-- scope_json carries the full typed value back out.
CREATE TABLE knockz (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  processed_by TEXT,
  decisions_json TEXT NOT NULL DEFAULT '[]'
);

CREATE UNIQUE INDEX idx_knockz_active_dedup ON knockz(node_id, scope_key) WHERE status = 'pending';
CREATE INDEX idx_knockz_status ON knockz(status);

-- webauthn credentials, grounded in tomb's user_credentialz schema:
-- credential_id (raw authenticator id, unique), credential_data (the
-- serialized passkey json blob), an optional friendly name, and the usual
-- lifecycle timestamps.
CREATE TABLE credentialz (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identityz(id) ON DELETE CASCADE,
  credential_id BLOB NOT NULL UNIQUE,
  credential_data TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  deleted_at INTEGER
);

CREATE INDEX idx_credentialz_identity_id ON credentialz(identity_id);
CREATE INDEX idx_credentialz_active ON credentialz(deleted_at) WHERE deleted_at IS NULL;
