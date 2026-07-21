-- add created_at to device_nodez. existing rows get last_seen_at as the
-- best available approximation (the two values are identical for freshly
-- added devices; only long-lived rows where last_seen_at has since been
-- bumped will show a later value instead of the real registration time).
ALTER TABLE device_nodez ADD COLUMN created_at INTEGER;

UPDATE device_nodez SET created_at = last_seen_at WHERE created_at IS NULL;
