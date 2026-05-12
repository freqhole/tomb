-- phase 14.0 — taxonomy population + bulk step-through review foundation.
--
-- adds:
--   1. new taxon kinds for the enrichment pipeline (subgenre, theme,
--      style, speed, country, decade, lastfm_tag).
--   2. `metadata`, `lastfm_lookup_status`, `audiodb_lookup_status`
--      columns on `artistz` to mirror the album side.
--   3. `priority` column on `jobz` so user-initiated lookups can
--      pre-empt long-running bulk enrichment queues.
--
-- value_type follows the convention from migration 033:
--   'categorical' = has rows in `taxonz` (everything we add here).
--
-- `lastfm_tag` is NOT user-defined; it's a catch-all for raw lastfm
-- tags that don't already match a known `genre` taxon. the lastfm
-- enrichment processor handles the genre-promotion check before
-- routing a tag here.

INSERT INTO taxon_kindz (slug, label, description, color, value_type, unit, display_order, is_user_defined) VALUES
  ('subgenre',   'subgenre',   'narrower style under a parent genre (post-rock, deep house, ...)', '#7c3aed', 'categorical', NULL, 15, 0),
  ('theme',      'theme',      'lyrical or conceptual theme (love, protest, sci-fi, ...)',         '#0ea5e9', 'categorical', NULL, 25, 0),
  ('style',      'style',      'production / arrangement style (lo-fi, orchestral, minimal, ...)', '#14b8a6', 'categorical', NULL, 35, 0),
  ('speed',      'speed',      'tempo bucket (slow, medium, fast)',                                '#f43f5e', 'categorical', NULL, 85, 0),
  ('country',    'country',    'country of origin (us, jp, de, ...)',                              '#22c55e', 'categorical', NULL, 65, 0),
  ('decade',     'decade',     'release decade (1970s, 1980s, ...)',                               '#eab308', 'categorical', NULL, 45, 0),
  ('lastfm_tag', 'lastfm tag', 'last.fm folksonomy tag not already known as a genre',              '#94a3b8', 'categorical', NULL, 200, 0);

ALTER TABLE artistz ADD COLUMN metadata TEXT;
ALTER TABLE artistz ADD COLUMN lastfm_lookup_status TEXT;
ALTER TABLE artistz ADD COLUMN audiodb_lookup_status TEXT;

ALTER TABLE jobz ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;

-- partial index helps the runner pick the next-highest-priority pending job cheaply.
-- ordering: highest priority first, then oldest schedule first (FIFO within same priority).
CREATE INDEX IF NOT EXISTS idx_jobz_priority_queue ON jobz(priority DESC, scheduled_at) WHERE status = 'Pending';
