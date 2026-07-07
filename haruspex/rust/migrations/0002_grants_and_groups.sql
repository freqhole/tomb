-- 0002: groups + live membership + role grants for the acl evaluator
-- (PHASE_4_HARUSPEX_RUST.md, "grants + acl: the unified model").

-- groups: real access-control objects (not the ui-label-only groups the
-- apps have today) - color/name are display metadata, membership below is
-- what actually matters to the evaluator.
CREATE TABLE groupz (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL
);

-- live, revocable membership. deleting a row is the entire revocation
-- mechanism for group-derived access - the evaluator re-reads this table on
-- every effective_role call, so there is nothing else to invalidate.
CREATE TABLE membershipz (
  group_id TEXT NOT NULL REFERENCES groupz(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES identityz(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, identity_id)
);

CREATE INDEX idx_membershipz_identity ON membershipz(identity_id);

-- role grants: subject (identity | group | everyone) x resource (kind + id)
-- -> role, with optional expiry. one grant per (subject, resource) pair -
-- granting again upserts rather than creating a second row.
--
-- subject_id is '' (not NULL) for the everyone subject, deliberately: a
-- unique index treats NULL as distinct-from-itself in sqlite, which would
-- let duplicate everyone-subject grants slip past the uniqueness check.
CREATE TABLE role_grantz (
  id TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL DEFAULT '',
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  role TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE UNIQUE INDEX idx_role_grantz_subject_resource
  ON role_grantz(subject_kind, subject_id, resource_kind, resource_id);
CREATE INDEX idx_role_grantz_resource ON role_grantz(resource_kind, resource_id);
CREATE INDEX idx_role_grantz_subject ON role_grantz(subject_kind, subject_id);
