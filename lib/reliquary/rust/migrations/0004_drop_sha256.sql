-- drop the legacy sha256 secondary index: blake3 is reliquary's sole
-- content identity. nothing in the `BlobStore` trait or its sqlite impl
-- reads or writes this column anymore (see blobz.rs) - it was a
-- migration-era resolver for rows pre-dating blake3 adoption, not a
-- feature with ongoing callers.

DROP INDEX IF EXISTS blobz_sha256_idx;
ALTER TABLE blobz DROP COLUMN sha256;
