-- 059: playback / resume progress - multi-device resume feature
-- 
-- music's `listen_sessionz.current_song_position_ms` exists in the schema
-- but is never actually persisted for resume today. `position_fraction` is
-- the one universal progress value every domain populates;
-- `position_seconds`/`duration_seconds` are additionally populated for
-- time-based media (video); `position_locator` is a free-form,
-- shared-infra-opaque string a domain can use however it needs (e.g. an
-- epub cfi or page number) - nothing outside that domain's own client code
-- ever reads it.
CREATE TABLE playback_progressz (
  user_id           TEXT NOT NULL REFERENCES user_accountz(id) ON DELETE CASCADE,
  entity_type       TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  position_fraction REAL NOT NULL DEFAULT 0,   -- 0..1, the one universal progress value
  position_seconds  REAL,                       -- populated only for time-based media
  duration_seconds  REAL,                       -- populated only for time-based media
  position_locator  TEXT,                       -- domain-specific, e.g. an epub CFI or page number; opaque to shared infra
  completed_at      INTEGER,
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, entity_type, entity_id)
);

CREATE INDEX idx_playback_progressz_user ON playback_progressz(user_id, updated_at DESC);
