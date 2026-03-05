-- 013: federation identity - haruspex integration for P2P peer authentication

-- add haruspex_user_id to user accounts for federation identity
ALTER TABLE user_accountz ADD COLUMN haruspex_user_id TEXT;

-- add metadata column for extensible user properties
-- NOTE: when updating, use json_patch(COALESCE(metadata, '{}'), ?) to merge
ALTER TABLE user_accountz ADD COLUMN metadata TEXT;

-- index for looking up users by their haruspex identity
CREATE UNIQUE INDEX idx_user_accountz_haruspex_user_id 
  ON user_accountz(haruspex_user_id) 
  WHERE haruspex_user_id IS NOT NULL;

-- junction table for user -> peer node_id mappings
-- a user can have multiple node_ids (desktop app, mobile, browser sessions)
-- a node_id belongs to exactly one user
CREATE TABLE user_peer_nodez (
  user_id TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  instance_name TEXT,             -- optional friendly name (e.g. "macbook", "phone")
  metadata TEXT,                  -- extensible properties as JSON (use json_patch to merge)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER,
  PRIMARY KEY (user_id, node_id)
);

-- fast lookup by node_id for incoming P2P connections
CREATE UNIQUE INDEX idx_user_peer_nodez_node_id ON user_peer_nodez(node_id);
CREATE INDEX idx_user_peer_nodez_user_id ON user_peer_nodez(user_id);
CREATE INDEX idx_user_peer_nodez_last_seen ON user_peer_nodez(last_seen_at DESC) 
  WHERE last_seen_at IS NOT NULL;
