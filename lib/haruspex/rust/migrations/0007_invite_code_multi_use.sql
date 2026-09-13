-- 0007: multi-use invite codes - a code can optionally be redeemed more
-- than once (e.g. a player-pairing code meant for several household
-- devices during its live window), tracked via a redemption log rather
-- than relying solely on the old singular used_at/used_by columns (kept
-- as-is going forward, only as a "first redemption" convenience/back-compat
-- read - no longer the sole record of usage).

ALTER TABLE invite_codez ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invite_codez ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;

-- backfill: every already-issued code was single-use (max_uses defaults to
-- 1 above, correct as-is); any code already redeemed under the old
-- singular used_at/used_by columns needs use_count bumped to 1 too, or
-- is_valid_for_use's new use_count < max_uses check would treat it as
-- still redeemable.
UPDATE invite_codez SET use_count = 1 WHERE used_at IS NOT NULL;

CREATE TABLE invite_code_redemptionz (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES invite_codez(id) ON DELETE CASCADE,
  used_by TEXT NOT NULL REFERENCES identityz(id) ON DELETE CASCADE,
  used_at INTEGER NOT NULL
);

CREATE INDEX idx_invite_code_redemptionz_invite ON invite_code_redemptionz(invite_id);

-- backfill the log with each already-used code's one known redemption, so
-- history stays consistent for anything that later reads the log directly.
INSERT INTO invite_code_redemptionz (id, invite_id, used_by, used_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' ||
       hex(randomblob(2)) || '-' || hex(randomblob(6))),
       id, used_by, used_at
FROM invite_codez
WHERE used_at IS NOT NULL AND used_by IS NOT NULL;
