-- taxonomy refactor: phase 1, schema only.
--
-- introduces a hierarchical, multi-kind taxonomy. genre becomes one
-- of many kinds (mood, instrument, era, key, bpm, location, label,
-- ...) and is just a row in `taxon_kindz`. taxons form a DAG (a
-- taxon may have multiple parents) via `taxon_parentz`. links from
-- albums to taxons carry an `origin` so we can later filter by
-- source / let users override ml/api results.
--
-- numeric per-album values (bpm, loudness in db, energy 0..1) live
-- in `scalar_attributez` keyed by `taxon_kind_id` so range queries
-- stay clean and the categorical table doesn't grow nullable cols.
--
-- this migration creates the tables only. seed kind rows land in
-- `033_taxonomy_seed_kinds.sql` and existing-data migration in
-- `034_taxonomy_migrate_data.sql`.

-- kinds: genre / mood / instrument / era / bpm / location / label / ...
CREATE TABLE taxon_kindz (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  slug            TEXT NOT NULL,                  -- 'genre', 'mood', 'bpm', 'location', 'label'
  label           TEXT NOT NULL,                  -- display form
  description     TEXT,
  color           TEXT,                           -- hex, e.g. '#6366f1'
  value_type      TEXT NOT NULL DEFAULT 'categorical',
                                                  -- 'categorical' | 'scalar_f64' | 'scalar_int'
  unit            TEXT,                           -- only for scalar kinds, e.g. 'bpm', 'db'
  display_order   INTEGER NOT NULL DEFAULT 0,
  is_user_defined INTEGER NOT NULL DEFAULT 0,     -- 1 if created by a user, 0 if seeded
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at      INTEGER,
  deleted_by      TEXT,
  CHECK (value_type IN ('categorical', 'scalar_f64', 'scalar_int'))
);

CREATE UNIQUE INDEX idx_taxon_kindz_slug ON taxon_kindz(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_taxon_kindz_value_type ON taxon_kindz(value_type);
CREATE INDEX idx_taxon_kindz_display_order ON taxon_kindz(display_order);

-- categorical taxon nodes (genre=rock, mood=mellow, location=detroit-mi, ...)
CREATE TABLE taxonz (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  kind_id         TEXT NOT NULL REFERENCES taxon_kindz(id),
  slug            TEXT NOT NULL,                  -- normalized lowercase, dashes
  label           TEXT NOT NULL,                  -- display form
  description     TEXT,
  is_user_defined INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by      TEXT,
  deleted_at      INTEGER,
  deleted_by      TEXT
);

CREATE UNIQUE INDEX idx_taxonz_kind_slug ON taxonz(kind_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_taxonz_kind ON taxonz(kind_id);
CREATE INDEX idx_taxonz_label ON taxonz(label);
CREATE INDEX idx_taxonz_deleted_at ON taxonz(deleted_at);

-- DAG edges: a taxon may have multiple parents. cycle prevention is
-- enforced at the repository layer via a recursive cte before insert.
CREATE TABLE taxon_parentz (
  child_id   TEXT NOT NULL REFERENCES taxonz(id) ON DELETE CASCADE,
  parent_id  TEXT NOT NULL REFERENCES taxonz(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (child_id, parent_id),
  CHECK (child_id != parent_id)
);

CREATE INDEX idx_taxon_parentz_parent ON taxon_parentz(parent_id);

-- album <-> taxon links with origin / confidence. (album_id, taxon_id,
-- origin) is the natural key so the same album+taxon can be sourced
-- by multiple providers (user + mb + lastfm) without conflict.
CREATE TABLE album_taxonz (
  album_id   TEXT NOT NULL REFERENCES albumz(id) ON DELETE CASCADE,
  taxon_id   TEXT NOT NULL REFERENCES taxonz(id) ON DELETE CASCADE,
  origin     TEXT NOT NULL,                       -- 'user' | 'musicbrainz' | 'lastfm' | 'audiodb' | ...
  confidence REAL,                                -- 0..1; null if origin='user'
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by TEXT,
  PRIMARY KEY (album_id, taxon_id, origin)
);

CREATE INDEX idx_album_taxonz_album ON album_taxonz(album_id);
CREATE INDEX idx_album_taxonz_taxon ON album_taxonz(taxon_id);
CREATE INDEX idx_album_taxonz_origin ON album_taxonz(origin);

-- numeric per-album attributes (bpm=128, loudness_db=-9.4, energy=0.72).
-- one row per (album, kind, origin) so multiple sources can disagree.
CREATE TABLE scalar_attributez (
  album_id      TEXT NOT NULL REFERENCES albumz(id) ON DELETE CASCADE,
  taxon_kind_id TEXT NOT NULL REFERENCES taxon_kindz(id),
  value_f64     REAL NOT NULL,
  origin        TEXT NOT NULL,
  confidence    REAL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by    TEXT,
  PRIMARY KEY (album_id, taxon_kind_id, origin)
);

CREATE INDEX idx_scalar_attributez_album ON scalar_attributez(album_id);
CREATE INDEX idx_scalar_attributez_kind ON scalar_attributez(taxon_kind_id);
CREATE INDEX idx_scalar_attributez_origin ON scalar_attributez(origin);
