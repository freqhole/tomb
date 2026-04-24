-- 022: enforce uniqueness on remotez.peer_addr
--
-- the clients (`get_by_peer_addr`, the IDB drain on first tauri boot, the
-- admin remote picker) treat `peer_addr` as a dedup key. the original
-- index in 021 was non-unique, so two rows could collide and
-- `remotez_get_by_peer_addr` was nondeterministic. swap it for a partial
-- unique index — uniqueness applies only when peer_addr is set, since
-- pure-http remotes legitimately leave it null.

DROP INDEX IF EXISTS idx_remotez_peer_addr;

CREATE UNIQUE INDEX idx_remotez_peer_addr
  ON remotez(peer_addr)
  WHERE peer_addr IS NOT NULL;
