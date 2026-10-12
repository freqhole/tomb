-- 097: fold "pending remote" state into remotez, instead of a parallel table
--
-- a "pending remote" (an in-progress knock or device-link, not yet an
-- established remote) was briefly a wholly separate `pending_remotez`
-- table mirroring remotez's shape almost column-for-column - that's
-- exactly the kind of duplicative schema variation this codebase has
-- repeatedly had to clean up elsewhere. the overlap is real (peer_addr,
-- transport, created_at, updated_at, and name/description/version are
-- the same concept as a pending remote's server_name/server_description/
-- server_version), so this table grows six new nullable columns instead:
--
--   pending_stage IS NULL  -> an established remote (today's existing rows)
--   pending_stage IS NOT NULL -> still pending; the value is the stage
--     (mirrors client/spume/src/app/services/storage/types.ts's
--     `PendingRemoteStage` union: testing | connected | failed |
--     knock_pending | knock_accepted | knock_rejected)
--
-- a pending row's `name`/`description`/`version` carry the same
-- cached-server-info meaning spume's `PendingRemote.server_name`/
-- `server_description`/`server_version` do today - no new columns needed
-- for those. `server_image_data`/`server_image_type` are genuinely new:
-- a pending remote's preview image is raw base64 bytes fetched before
-- this peer is a registered remote at all, so there's no existing
-- `image_url`/`image_blob_id` relationship to reuse for it. likewise
-- `knock_username`/`knock_message`/`error_message` have no established-
-- remote equivalent. so `pending_stage` plus these five are the only
-- genuinely new columns.
--
-- `remote_id` is used as the single identifier for both: a pending row
-- gets a server-generated uuid the moment it's created, same as a
-- `PendingRemote.id` always has been - promotion to an established remote
-- does NOT reuse that row (a fresh, name-derived remote_id is minted for
-- the established remote, same as today), so the old pending row is left
-- to be cleaned up the same way it already is today (see
-- deletePendingRemoteByPeerAddr in App.tsx's knock-accepted/device-linked
-- handlers) - which is why the peer_addr uniqueness constraint below is
-- relaxed to ignore pending rows entirely: a pending row and its
-- eventual established-remote replacement legitimately coexist for a
-- moment, same as they already do under separate storage today.

ALTER TABLE remotez ADD COLUMN pending_stage TEXT;
ALTER TABLE remotez ADD COLUMN server_image_data TEXT;
ALTER TABLE remotez ADD COLUMN server_image_type TEXT;
ALTER TABLE remotez ADD COLUMN knock_username TEXT;
ALTER TABLE remotez ADD COLUMN knock_message TEXT;
ALTER TABLE remotez ADD COLUMN error_message TEXT;

-- replaces 022's unique index: uniqueness only applies among established
-- remotes (pending_stage IS NULL) - a pending row never competes with an
-- established remote (or another pending row) for the same peer_addr,
-- same as the old separate-table design's non-unique `by_peer_addr`
-- index never did.
DROP INDEX IF EXISTS idx_remotez_peer_addr;

CREATE UNIQUE INDEX idx_remotez_peer_addr
  ON remotez(peer_addr)
  WHERE peer_addr IS NOT NULL AND pending_stage IS NULL;

CREATE INDEX idx_remotez_pending_stage ON remotez(pending_stage) WHERE pending_stage IS NOT NULL;
