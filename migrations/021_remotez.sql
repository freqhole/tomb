-- 021: shared remote registry
--
-- a single sqlite-backed list of remote freqhole instances the user can
-- connect to. used by both the spume player (in tauri) and the wizard admin
-- app, so they share one source of truth.
--
-- pure-web spume builds continue to use IndexedDB; this table is only
-- consulted in tauri context. on first boot in tauri, spume drains its IDB
-- `remotes` store into this table.
--
-- field shapes mirror the existing TypeScript Remote schema in
-- client/spume/src/app/services/storage/schemas/remote.ts so the shapes
-- round-trip cleanly.

CREATE TABLE remotez (
  remote_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,                   -- "http" | "wasm" | "app"
  base_url TEXT,
  peer_addr TEXT,                            -- node_id or json endpoint (for P2P)
  api_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  is_charnel_managed INTEGER NOT NULL DEFAULT 0,
  last_connected_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  -- cached server info (from /api/hello)
  description TEXT,
  image_url TEXT,
  image_blob_id TEXT,
  version TEXT,
  last_info_check INTEGER,
  -- offline tracking
  is_offline INTEGER,
  offline_since INTEGER,
  last_checked INTEGER,
  -- forward-compat extensible properties (use json_patch to merge)
  metadata TEXT
);

CREATE INDEX idx_remotez_peer_addr ON remotez(peer_addr) WHERE peer_addr IS NOT NULL;
CREATE INDEX idx_remotez_is_active ON remotez(is_active) WHERE is_active = 1;
CREATE INDEX idx_remotez_transport ON remotez(transport);
