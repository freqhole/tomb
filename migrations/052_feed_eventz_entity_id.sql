-- migration 052: add entity_id to feed_eventz
--
-- listen sessions store the id of the entity being played (album/artist/
-- playlist/genre/shuffle/radio) as listen_sessionz.entity_id, but
-- feed_eventz only ever surfaced it via the type-specific album_id/
-- artist_id/playlist_id columns. session types with no dedicated column
-- (genre, shuffle, radio) had no way to link back to their entity from a
-- feed row. add a generic entity_id column so any session type can be
-- linked, regardless of whether it has a type-specific FK column.
ALTER TABLE feed_eventz ADD COLUMN entity_id TEXT;
