-- an opaque, app-populated json metadata bag for each knock record, for
-- data the wire message carries that this store has no dedicated column
-- for (e.g. a sender's display name alongside their knock message). the
-- store never reads or interprets its contents.
ALTER TABLE knockz ADD COLUMN metadata_json TEXT;
