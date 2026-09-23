-- lets an admin mark a station as taking member-submitted play requests
-- instead of (or in addition to, per its own filters) picking purely from
-- resolve_playlist's filter-resolved candidates. see the in-memory
-- request queue in grimoire/src/radio/requests.rs - deliberately NOT
-- persisted here (queue contents live only in memory, dropped when a
-- station goes idle - see that module's doc comment for why).
--
-- accepts_requests and is_public are enforced as mutually exclusive in
-- application code (grimoire/src/radio/stations/repository.rs), matching
-- this table's existing convention-over-constraint style - not a SQL
-- CHECK, since is_public's own semantics are already only enforced there.

ALTER TABLE radio_stationz ADD COLUMN accepts_requests INTEGER NOT NULL DEFAULT 0;
