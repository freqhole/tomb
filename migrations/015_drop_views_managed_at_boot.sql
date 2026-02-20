-- 015: drop views - these are now managed at boot time via database::setup_views()
-- this simplifies iteration on views without needing new migrations

DROP VIEW IF EXISTS playlist_song_query_view;
DROP VIEW IF EXISTS song_query_view;
DROP VIEW IF EXISTS playlist_query_view;
DROP VIEW IF EXISTS genre_query_view;
DROP VIEW IF EXISTS album_query_view;
DROP VIEW IF EXISTS artist_query_view;
DROP VIEW IF EXISTS feed_query_view;
