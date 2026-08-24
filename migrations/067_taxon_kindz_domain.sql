-- 067: scope taxon kinds by domain so video doesn't inherit every music kind.
--
-- taxon_kindz has been a single flat table (genre, mood, instrument, era,
-- key, location, label, bpm, ...) shared by whatever entity links into it.
-- now that video links into the same table via entity_taxonz, every
-- music-only kind (including ad-hoc user-created ones like "tag",
-- "release_date", "died_year") was leaking into the video edit modal, with
-- no way for a client to reliably filter them out (an excludeKinds
-- blocklist can't keep up with arbitrary user-created kinds).
--
-- `domain` scopes a kind to one owning entity domain ('music' | 'video'),
-- or 'universal' for a kind meant to apply everywhere. every kind that
-- exists as of this migration predates the video domain, so all of them
-- are backfilled to 'music'. new kinds default to 'universal' unless a
-- caller explicitly tags them (e.g. the video taxon editor's "new kind"
-- form passes domain='video').
ALTER TABLE taxon_kindz ADD COLUMN domain TEXT NOT NULL DEFAULT 'universal';

UPDATE taxon_kindz SET domain = 'music';
