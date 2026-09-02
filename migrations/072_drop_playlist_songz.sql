-- 072: drop playlist_songz
--
-- superseded by playlist_itemz (entity_type = 'song') as of migration 071's
-- backfill; no rust code reads or writes this table anymore. dropping the
-- table also drops its own indexes/triggers (sqlite does this
-- automatically for objects scoped to the dropped table). no other table
-- has a foreign key pointing at playlist_songz, so this is a plain drop.
DROP TABLE playlist_songz;
