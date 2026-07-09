// shared shapes for the blake3-canonical blob record store.
//
// core schema: blake3 primary key, sha256 legacy index, blob_type, parent
// linkage. this browser version omits native-only fields (on-disk path,
// external flag, soft-delete bookkeeping) and app-specific classification
// fields (e.g. domain tags) - callers that want classification can use
// the `metadata` field.

/** original | thumbnail | waveform | preview - matches the rust schema's enum. */
export type BlobType = "original" | "thumbnail" | "waveform" | "preview";

/** which bytes backend a record's payload was written through. absent on
 *  records written before this field existed - callers should treat a
 *  missing value as "opfs" (the only backend that existed at the time). */
export type BytesBackendName = "opfs" | "cache";

export interface BlobRecord {
  /** canonical id - the blake3 hex digest. */
  blob_id: string;
  /** blake3 hex digest (same value as blob_id for every record created by
   *  this store; kept as its own field, and its own index, so a record
   *  legacy-keyed by sha256 can still be found by blake3 once known). */
  blake3: string;
  /** legacy sha256 hex digest, kept for records/references that predate
   *  blake3 becoming canonical. never computed for new streamed uploads. */
  sha256?: string;
  filename: string;
  mime: string;
  size: number;
  blob_type: BlobType;
  /** blake3 of a "parent" blob this one was derived from (e.g. a
   *  thumbnail's parent is the original image). */
  parent_blob_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: number;
  storage_backend?: BytesBackendName;
}

/** everything needed to store a new blob, other than the bytes and the
 *  fields this store computes/fills in itself (blob_id, blake3, sha256,
 *  size, created_at, storage_backend). */
export interface NewBlobMeta {
  filename: string;
  mime: string;
  blob_type?: BlobType;
  parent_blob_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BlobLocalityMetadata {
  id: string;
  mime?: string;
  filename?: string;
  size?: number;
  blake3?: string;
}

export interface BlobLocalityInfo {
  /**
   * "remote" covers both "no record at all" and "a record exists but its
   * bytes are missing" - a stranded record (e.g. a write whose bytes
   * backend silently failed) must not read as permanently local with no
   * way to repair it.
   */
  locality: "local" | "remote" | "unknown";
  metadata?: BlobLocalityMetadata;
}
