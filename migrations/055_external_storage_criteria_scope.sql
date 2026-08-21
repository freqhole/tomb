-- migration 055: per-clause scope for the removable-storage sync
-- filter-set's user-scoped criteria clause types - "favorite",
-- "rating_gte", "rating_lte" - choosing "my <thing>" vs "everyone's
-- <thing>". radio stations intentionally keep these any-user-only (no
-- per-listener concept exists there - see `resolve_playlist`), so this
-- column is only added to `external_storage_filter_set_filterz`, not
-- `radio_station_filterz`.
--
-- NULL/0 (default) = scoped to the local device's own user - matches
-- the behavior already shipped for every pre-existing `favorite` row,
-- and is a deliberate change from the previous any-user `rating_gte`/
-- `rating_lte` behavior (ratings had no scoping concept at all before
-- this). 1 = any user's favorites/ratings (opt-in per clause).

ALTER TABLE external_storage_filter_set_filterz
    ADD COLUMN criteria_scope INTEGER;
