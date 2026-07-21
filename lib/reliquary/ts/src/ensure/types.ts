// message types for the ensure-blob protocol. matches the rust `reliquary::ensure::PeerMessage`
// enum's wire format exactly: `#[serde(tag = "type", rename_all = "snake_case")]`.

/** default ALPN for ensure-blob protocol requests, shared across all apps. */
export const DEFAULT_ENSURE_ALPN = "freqhole/1";

/** discriminated union of all ensure-protocol messages. */
export type PeerMessage = EnsureBlobRequest | EnsureBlobResponse;

/** request that a peer stage a blob (by blake3 hash) in its iroh-blobs
 *  store for verified transfer. */
export interface EnsureBlobRequest {
  type: "ensure_blob_request";
  id: number;
  blake3_hash: string;
}

/** response to an `EnsureBlobRequest`. */
export interface EnsureBlobResponse {
  type: "ensure_blob_response";
  id: number;
  available: boolean;
  error?: string;
}
