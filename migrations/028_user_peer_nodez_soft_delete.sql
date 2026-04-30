-- 028: soft delete for user_peer_nodez
--
-- adds a `deleted_at` column to user_peer_nodez so peer nodes can be
-- soft-deleted (mirroring the soft-delete pattern on user_accountz). this
-- enables:
--  - cascading soft-delete: when a user is soft-deleted, their peer nodes
--    are also soft-deleted in the same transaction (and restored together)
--  - admin "show deleted" toggles in the spume + charnel federation views
--  - knock requests from a previously-known node_id can be detected as
--    "from a soft-deleted user" and surfaced in the admin ui (the global
--    unique on node_id is preserved so the same node_id cannot silently
--    reappear under a different user; admins must restore the deleted
--    user/peer first)
--
-- backfill: any peer node whose user is already soft-deleted gets stamped
-- with the user's deleted_at timestamp so the cascade invariant holds for
-- pre-existing data.

ALTER TABLE user_peer_nodez ADD COLUMN deleted_at INTEGER;

-- partial index of active rows for fast "give me all live peer nodes" scans.
-- the existing UNIQUE index on node_id is intentionally kept GLOBAL (not
-- partial on deleted_at IS NULL) so a soft-deleted node_id cannot be
-- silently re-registered without an admin explicitly restoring it. see
-- migration header for rationale.
CREATE INDEX idx_user_peer_nodez_active 
  ON user_peer_nodez(deleted_at) 
  WHERE deleted_at IS NULL;

-- backfill: cascade existing user soft-deletes onto their peer nodes.
UPDATE user_peer_nodez
SET deleted_at = (
  SELECT u.deleted_at
  FROM user_accountz u
  WHERE u.id = user_peer_nodez.user_id
)
WHERE EXISTS (
  SELECT 1 FROM user_accountz u
  WHERE u.id = user_peer_nodez.user_id AND u.deleted_at IS NOT NULL
);
