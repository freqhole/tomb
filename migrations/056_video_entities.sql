-- 056: video domain - unified video entity + optional series/season grouping
--
-- unified `videoz` table covers everything watchable (standalone movie/clip,
-- season-less docuseries episode, full tv episode, etc.) - `video_seriez`/
-- `video_seasonz` grouping is optional, not a fork.

CREATE TABLE video_seriez (          -- ~ artistz
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title         TEXT NOT NULL,
  description   TEXT,
  poster_blob_id TEXT REFERENCES media_blobz(id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_by    TEXT
);

CREATE INDEX idx_video_seriez_deleted_at ON video_seriez(deleted_at);

CREATE TABLE video_seasonz (         -- ~ albumz, always belongs to a series
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  series_id     TEXT NOT NULL REFERENCES video_seriez(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  title         TEXT,                -- optional custom title, else "Season N" in UI
  description   TEXT,
  poster_blob_id TEXT REFERENCES media_blobz(id),
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at    INTEGER,
  UNIQUE (series_id, season_number)
);

CREATE INDEX idx_video_seasonz_series ON video_seasonz(series_id);
CREATE INDEX idx_video_seasonz_deleted_at ON video_seasonz(deleted_at);

CREATE TABLE videoz (                 -- ~ songz, the one unified video entity
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  series_id         TEXT REFERENCES video_seriez(id) ON DELETE SET NULL,
  season_id         TEXT REFERENCES video_seasonz(id) ON DELETE SET NULL,
  episode_number    INTEGER,          -- only meaningful when series_id is set
  title             TEXT NOT NULL,
  description       TEXT,
  media_blob_id     TEXT NOT NULL UNIQUE REFERENCES media_blobz(id),
  poster_blob_id    TEXT REFERENCES media_blobz(id),
  duration_seconds  REAL,
  release_date      TEXT,             -- ISO date, nullable
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at        INTEGER,
  created_by        TEXT,
  updated_by        TEXT,
  deleted_by        TEXT,
  CHECK (season_id IS NULL OR series_id IS NOT NULL)  -- season implies series
);

CREATE INDEX idx_videoz_series ON videoz(series_id);
CREATE INDEX idx_videoz_season ON videoz(season_id);
CREATE INDEX idx_videoz_deleted_at ON videoz(deleted_at);
