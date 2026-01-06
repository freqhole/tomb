-- fix playlist positioning triggers
-- this migration fixes issues with the BEFORE INSERT trigger

-- first, drop the problematic triggers
DROP TRIGGER IF EXISTS trg_playlist_songz_shift_positions;
DROP TRIGGER IF EXISTS trg_playlist_songz_auto_position;
DROP TRIGGER IF EXISTS trg_playlist_songz_reorder_on_delete;

-- recreate the shift positions trigger (BEFORE INSERT)
-- this runs before insertion to make room at the specified position
CREATE TRIGGER trg_playlist_songz_shift_positions_v2
BEFORE INSERT ON playlist_songz
FOR EACH ROW
WHEN NEW.position > 0  -- only shift for valid positions, not sentinel -1
BEGIN
  -- Shift existing positions to make room
  UPDATE playlist_songz
  SET position = position + 1
  WHERE playlist_rowid = NEW.playlist_rowid
    AND position >= NEW.position;
END;

-- recreate auto-positioning trigger (AFTER INSERT)
-- this handles the -1 sentinel value for auto-append
CREATE TRIGGER trg_playlist_songz_auto_position_v2
AFTER INSERT ON playlist_songz
FOR EACH ROW
WHEN NEW.position = -1
BEGIN
  UPDATE playlist_songz
  SET position = (
    SELECT COALESCE(MAX(position), 0) + 1
    FROM playlist_songz
    WHERE playlist_rowid = NEW.playlist_rowid
      AND position > 0  -- ignore the -1 we just inserted
      AND rowid != NEW.rowid  -- don't include the row we're updating
  )
  WHERE rowid = NEW.rowid;
END;

-- recreate delete reordering trigger
-- this closes gaps when songs are removed
CREATE TRIGGER trg_playlist_songz_reorder_on_delete_v2
AFTER DELETE ON playlist_songz
FOR EACH ROW
WHEN OLD.position > 0  -- only reorder if it was a valid position
BEGIN
  UPDATE playlist_songz
  SET position = position - 1
  WHERE playlist_rowid = OLD.playlist_rowid
    AND position > OLD.position
    AND position > 0;  -- don't reorder sentinel values
END;
