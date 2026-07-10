// client side of the ensure-blob protocol: dials a peer, sends a request,
// reads the response.

import { log } from "../utils/log.js";
import type { BiStreamLike } from "../automerge/types.js";
import { DEFAULT_ENSURE_ALPN, type EnsureBlobRequest, type EnsureBlobResponse, type PeerMessage } from "./types.js";

const TAG = "ensure.client";

/** minimal interface for a node capable of opening bidirectional streams. */
export interface EnsureCapableNode {
  open_bi(peerAddr: string, alpn: string): Promise<BiStreamLike>;
}

/**
 * sends an ensure-blob request to a peer and returns whether the peer
 * reports the blob as available. throws on connection/protocol errors.
 *
 * @param node - the transport node (midden, tauri, or any node exposing `open_bi`)
 * @param peerAddr - peer address (bare node id or full `EndpointAddr`)
 * @param blake3Hash - blake3 hash of the blob to check for
 * @param alpn - ALPN string to dial (defaults to `DEFAULT_ENSURE_ALPN`)
 * @returns true if the peer has the blob, false otherwise
 * @throws when the peer rejects the connection, the stream errors, or the
 *         response cannot be parsed
 */
export async function ensureBlobOverAlpn(
  node: EnsureCapableNode,
  peerAddr: string,
  blake3Hash: string,
  alpn?: string
): Promise<boolean> {
  const actualAlpn = alpn ?? DEFAULT_ENSURE_ALPN;
  const peerShort = peerAddr.slice(0, 16);

  log.debug(TAG, `dialing peer ${peerShort} on ALPN ${actualAlpn} for blake3=${blake3Hash.slice(0, 16)}`);

  let stream: BiStreamLike;
  try {
    stream = await node.open_bi(peerAddr, actualAlpn);
  } catch (err) {
    throw new Error(
      `failed to connect to peer ${peerShort}: ${err instanceof Error ? err.message : err}`
    );
  }

  const request: EnsureBlobRequest = {
    type: "ensure_blob_request",
    id: 1,
    blake3_hash: blake3Hash,
  };

  const requestBytes = new TextEncoder().encode(JSON.stringify(request));

  try {
    if (stream.write_raw_and_finish) {
      await stream.write_raw_and_finish(requestBytes);
    } else {
      log.warn(TAG, "stream does not support write_raw_and_finish, falling back to write_message");
      await stream.write_message(requestBytes);
      stream.close();
    }
  } catch (err) {
    throw new Error(
      `failed to write request to peer ${peerShort}: ${err instanceof Error ? err.message : err}`
    );
  }

  if (!stream.read_to_end) {
    throw new Error("stream does not support read_to_end");
  }

  let responseBytes: Uint8Array;
  try {
    responseBytes = await stream.read_to_end(64 * 1024);
  } catch (err) {
    throw new Error(
      `failed to read response from peer ${peerShort}: ${err instanceof Error ? err.message : err}`
    );
  }

  let msg: PeerMessage;
  try {
    msg = JSON.parse(new TextDecoder().decode(responseBytes)) as PeerMessage;
  } catch (err) {
    throw new Error(
      `failed to parse response from peer ${peerShort}: ${err instanceof Error ? err.message : err}`
    );
  }

  if (msg.type !== "ensure_blob_response") {
    throw new Error(`unexpected response type from peer ${peerShort}: ${msg.type}`);
  }

  const response = msg as EnsureBlobResponse;

  if (response.error) {
    log.debug(TAG, `peer ${peerShort} reported error: ${response.error}`);
    return false;
  }

  return response.available;
}
