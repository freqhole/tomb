-- add triggers to maintain album.song_count when songs are added/removed
-- this field was defined as "computed from songz count" but never had triggers

-- first, update all existing albums with correct song counts (COMMENTED OUT, DELETE THIS LATER)
-- UPDATE albumz
-- SET song_count = (
--     SELECT COUNT(*)
--     FROM album_songz
--     WHERE album_songz.album_id = albumz.id
-- );

-- trigger to increment song_count when a song is linked to an album
CREATE TRIGGER trg_album_songz_insert_count
AFTER INSERT ON album_songz
BEGIN
    UPDATE albumz
    SET song_count = (
        SELECT COUNT(*)
        FROM album_songz
        WHERE album_songz.album_id = NEW.album_id
    ),
    updated_at = unixepoch()
    WHERE id = NEW.album_id;
END;

-- trigger to decrement song_count when a song is unlinked from an album
CREATE TRIGGER trg_album_songz_delete_count
AFTER DELETE ON album_songz
BEGIN
    UPDATE albumz
    SET song_count = (
        SELECT COUNT(*)
        FROM album_songz
        WHERE album_songz.album_id = OLD.album_id
    ),
    updated_at = unixepoch()
    WHERE id = OLD.album_id;
END;
