-- 058: generalized polymorphic playlist items
--
-- additive/supplemental to the existing song-only `playlist_songz` 
-- (migrations/003_junction_tables.sql).
-- playlists of songs keep using `playlist_songz` for now, video (and any
-- future domain) uses this generalized table instead. `entity_type` is
-- validated in rust, no `CHECK` constraint. position auto-numbering/gap
-- closing triggers are ported from `playlist_songz`.
CREATE TABLE playlist_itemz (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  playlist_id TEXT NOT NULL REFERENCES playlistz(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  added_by    TEXT,
  UNIQUE (playlist_id, entity_type, entity_id)
);

CREATE INDEX idx_playlist_itemz_playlist ON playlist_itemz(playlist_id, position);

-- auto-append new items to end of playlist (ported from
-- trg_playlist_songz_auto_append)
CREATE TRIGGER trg_playlist_itemz_auto_append
AFTER INSERT ON playlist_itemz
WHEN NEW.position IS NULL OR NEW.position = 0
BEGIN
  UPDATE playlist_itemz
  SET position = (
    SELECT COALESCE(MAX(position), 0) + 1
    FROM playlist_itemz
    WHERE playlist_id = NEW.playlist_id
  )
  WHERE rowid = NEW.rowid;
END;

-- close gaps when items are removed from playlist (ported from
-- trg_playlist_songz_close_gaps_on_delete)
CREATE TRIGGER trg_playlist_itemz_close_gaps_on_delete
AFTER DELETE ON playlist_itemz
BEGIN
  UPDATE playlist_itemz
  SET position = position - 1
  WHERE playlist_id = OLD.playlist_id
    AND position > OLD.position;
END;
