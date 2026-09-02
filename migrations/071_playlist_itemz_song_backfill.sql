-- 071: backfill playlist_itemz with existing playlist_songz rows
--
-- additive only - does NOT drop or alter playlist_songz. as of this
-- migration, song membership writes move to playlist_itemz
-- (entity_type = 'song') so mixed audio+video playlists share one global
-- ordering space. playlist_songz is left in place, read-only/legacy,
-- until a later migration drops it once nothing reads it anymore.
--
-- positions can't just be copied as-is: playlist_itemz may already hold
-- video items for a playlist with their own position numbering, and the
-- two tables were never ordered together before. policy: keep any
-- existing playlist_itemz rows' positions unchanged, then append each
-- playlist's songs after them (in their existing song-relative order).
INSERT INTO playlist_itemz (playlist_id, entity_type, entity_id, position, added_at, added_by)
SELECT
    ps.playlist_id,
    'song',
    ps.song_id,
    (SELECT COALESCE(MAX(pi.position), 0)
       FROM playlist_itemz pi
      WHERE pi.playlist_id = ps.playlist_id)
      + ROW_NUMBER() OVER (PARTITION BY ps.playlist_id ORDER BY ps.position),
    ps.added_at,
    ps.added_by
FROM playlist_songz ps
WHERE NOT EXISTS (
    SELECT 1 FROM playlist_itemz pi2
     WHERE pi2.playlist_id = ps.playlist_id
       AND pi2.entity_type = 'song'
       AND pi2.entity_id = ps.song_id
);
