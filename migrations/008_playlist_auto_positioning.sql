-- auto-positioning trigger for playlist songs
-- automatically assigns position when adding songs to playlists
-- since position is NOT NULL, we use -1 as a sentinel value for "auto-assign"

-- trigger to handle position conflicts when inserting at specific position
-- shifts existing songs down to make room (MUST come before auto-positioning)
CREATE TRIGGER trg_playlist_songz_shift_positions
BEFORE INSERT ON playlist_songz
FOR EACH ROW
WHEN NEW.position > 0  -- only shift for valid positions, not sentinel -1
BEGIN
  -- Shift existing positions to make room
  UPDATE playlist_songz
  SET position = position + 1
  WHERE playlist_rowid = NEW.playlist_rowid
    AND position >= NEW.position
    AND rowid != NEW.rowid;  -- don't update the row being inserted
END;

-- trigger to handle auto-positioning when position = -1
CREATE TRIGGER trg_playlist_songz_auto_position
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

-- trigger to reorder positions when a song is deleted from a playlist
-- this keeps positions sequential (1, 2, 3, 4...) without gaps
CREATE TRIGGER trg_playlist_songz_reorder_on_delete
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
