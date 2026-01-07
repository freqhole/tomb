-- essential playlist triggers
-- auto-append new songs to end of playlist
-- close gaps when songs are deleted

-- auto-append trigger for new songs (position = -1)
CREATE TRIGGER trg_playlist_songz_auto_append
AFTER INSERT ON playlist_songz
FOR EACH ROW
WHEN NEW.position = -1
BEGIN
  UPDATE playlist_songz
  SET position = (
    SELECT COALESCE(MAX(position), 0) + 1
    FROM playlist_songz
    WHERE playlist_id = NEW.playlist_id
      AND position > 0
  )
  WHERE playlist_id = NEW.playlist_id AND song_id = NEW.song_id;
END;

-- gap closure trigger for deletions
CREATE TRIGGER trg_playlist_songz_close_gaps_on_delete
AFTER DELETE ON playlist_songz
FOR EACH ROW
WHEN OLD.position > 0
BEGIN
  -- shift down all songs after the deleted position
  UPDATE playlist_songz
  SET position = position - 1
  WHERE playlist_id = OLD.playlist_id
    AND position > OLD.position
    AND position > 0;
END;
