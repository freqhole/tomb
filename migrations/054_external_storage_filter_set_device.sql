-- migration 054: scope removable-storage filter-sets to a device.
--
-- product direction simplified after building the multi-set model in
-- migration 053: for now there's exactly one filter-set per device (a
-- "default" set, get-or-created on first use) rather than a
-- user-managed list of named sets - see docs/removable-storage-sync-plan.md
-- phase 6. the underlying schema still allows many rows (no NOT NULL/
-- one-row-per-device enforcement beyond the partial unique index below),
-- so multiple named sets per device can come back later without another
-- migration.

ALTER TABLE external_storage_filter_setz ADD COLUMN device_id TEXT;

-- at most one filter-set per device_id (nullable rows - e.g. any
-- pre-054 global filter-set that never got a device assigned - are not
-- constrained by this, since a partial unique index ignores NULLs).
CREATE UNIQUE INDEX idx_external_storage_filter_setz_device
    ON external_storage_filter_setz(device_id)
    WHERE device_id IS NOT NULL;
