// responder side of the ensure-blob protocol: receives requests, gates
// access, checks if blobs exist, and sends responses.

import { log } from "../utils/log.js";
import type { BiStreamLike } from "../automerge/types.js";
import type { PeerMessage, EnsureBlobRequest, EnsureBlobResponse } from "./types.js";

const TAG = "ensure.responder";

/** dependencies for the ensure-blob handler, provided by the app. */
export interface EnsureBlobHandlerDeps {
  /** check if a blob with the given blake3 hash is available. */
  hasBlob: (blake3Hash: string) => Promise<boolean>;
  /** optional per-blob access control. when provided, called before
   *  `hasBlob` to decide if this peer may ask for this specific blob.
   *  defaults to always allowing. */
  allow?: (peerId: string, blake3Hash: string) => Promise<boolean>;
}

/**
 * creates an ALPN handler for the ensure-blob protocol. the returned
 * function accepts a bidirectional stream, reads an ensure-blob request,
 * optionally gates it via `deps.allow`, checks `deps.hasBlob`, and writes
 * back a response.
 *
 * suitable for passing directly to `IrohNetworkAdapter.registerAlpnHandler(alpn, handler)`.
 */
export function createEnsureBlobHandler(
  deps: EnsureBlobHandlerDeps
): (stream: BiStreamLike) => void {
  return (stream: BiStreamLike) => {
    handleStream(stream, deps).catch((err) => {
      const peerId = stream.peer_node_id();
      const peerShort = peerId.slice(0, 16);
      log.warn(
        TAG,
        `stream error from peer ${peerShort}:`,
        err instanceof Error ? err.message : err
      );
    });
  };
}

async function handleStream(stream: BiStreamLike, deps: EnsureBlobHandlerDeps): Promise<void> {
  const peerId = stream.peer_node_id();
  const peerShort = peerId.slice(0, 16);

  if (!stream.read_to_end) {
    log.warn(TAG, `stream from peer ${peerShort} does not support read_to_end`);
    stream.close();
    return;
  }

  const msgBytes = await stream.read_to_end(64 * 1024);
  let msg: PeerMessage;
  try {
    msg = JSON.parse(new TextDecoder().decode(msgBytes)) as PeerMessage;
  } catch (err) {
    log.warn(
      TAG,
      `failed to parse request from peer ${peerShort}:`,
      err instanceof Error ? err.message : err
    );
    stream.close();
    return;
  }

  if (msg.type !== "ensure_blob_request") {
    log.debug(TAG, `ignoring non-request message from peer ${peerShort}: ${msg.type}`);
    stream.close();
    return;
  }

  const request = msg as EnsureBlobRequest;
  const response = await handleEnsureBlobRequest(request, peerId, deps);
  await sendResponse(stream, response);
}

async function handleEnsureBlobRequest(
  request: EnsureBlobRequest,
  peerId: string,
  deps: EnsureBlobHandlerDeps
): Promise<EnsureBlobResponse> {
  const { id, blake3_hash } = request;

  if (blake3_hash.length !== 64) {
    return {
      type: "ensure_blob_response",
      id,
      available: false,
      error: `expected 64-char blake3 hex, got ${blake3_hash.length}`,
    };
  }

  if (deps.allow) {
    const allowed = await deps.allow(peerId, blake3_hash);
    if (!allowed) {
      log.info(TAG, `denied peer ${peerId.slice(0, 16)} access to blob ${blake3_hash.slice(0, 16)}`);
      return {
        type: "ensure_blob_response",
        id,
        available: false,
        error: "not authorized",
      };
    }
  }

  let available: boolean;
  try {
    available = await deps.hasBlob(blake3_hash);
  } catch (err) {
    log.warn(
      TAG,
      `hasBlob check failed for blake3=${blake3_hash.slice(0, 16)}:`,
      err instanceof Error ? err.message : err
    );
    return {
      type: "ensure_blob_response",
      id,
      available: false,
      error: "hasBlob check failed",
    };
  }

  return {
    type: "ensure_blob_response",
    id,
    available,
  };
}

async function sendResponse(stream: BiStreamLike, response: EnsureBlobResponse): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(response));
  if (stream.write_raw_and_finish) {
    await stream.write_raw_and_finish(bytes);
  } else {
    log.warn(TAG, "stream does not support write_raw_and_finish, falling back to write_message");
    await stream.write_message(bytes);
    stream.close();
  }
}
