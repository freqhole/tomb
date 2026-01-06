-- simplified playlist triggers approach
-- auto-append new songs, reorder existing songs via update

-- drop all existing triggers
DROP TRIGGER IF EXISTS trg_playlist_songz_shift_positions;
DROP TRIGGER IF EXISTS trg_playlist_songz_shift_positions_v2;
DROP TRIGGER IF EXISTS trg_playlist_songz_auto_position;
DROP TRIGGER IF EXISTS trg_playlist_songz_auto_position_v2;
DROP TRIGGER IF EXISTS trg_playlist_songz_reorder_on_delete;
DROP TRIGGER IF EXISTS trg_playlist_songz_reorder_on_delete_v2;

-- simple auto-positioning trigger (AFTER INSERT)
-- always appends to end when position = -1, no complex shifting
CREATE TRIGGER trg_playlist_songz_auto_append
AFTER INSERT ON playlist_songz
FOR EACH ROW
WHEN NEW.position = -1
BEGIN
  UPDATE playlist_songz
  SET position = (
    SELECT COALESCE(MAX(position), 0) + 1
    FROM playlist_songz
    WHERE playlist_rowid = NEW.playlist_rowid
      AND position > 0
      AND rowid != NEW.rowid
  )
  WHERE rowid = NEW.rowid;
END;

-- gap closure trigger (AFTER DELETE)
-- closes gaps when songs are removed from playlist
CREATE TRIGGER trg_playlist_songz_close_gaps
AFTER DELETE ON playlist_songz
FOR EACH ROW
WHEN OLD.position > 0
BEGIN
  UPDATE playlist_songz
  SET position = position - 1
  WHERE playlist_rowid = OLD.playlist_rowid
    AND position > OLD.position
    AND position > 0;
END;
