// ---------------------------------------------------------------------------
// freqhole-handler.ts — browser-side handler for incoming freqhole/1 ALPN streams
//
// when a peer (tauri or browser) opens a freqhole/1 stream to us,
// this handler reads the request, dispatches to the appropriate
// local handler (blob data from OPFS, metadata from IndexedDB),
// and writes back a response.
//
// this enables browser peers to serve their uploaded/snatched files
// to other peers on the canvas.
//
// protocol framing: messages use length-delimited encoding via BiStreamLike
// (4-byte BE u32 length prefix + JSON payload). this matches the framing
// used by write_message() / read_message() on the WASM BiStream.
// ---------------------------------------------------------------------------

import type { BiStreamLike } from "./iroh-network-adapter";

// ---- peer message types ---------------------------------------------------
// these match midden's PeerMessage enum (serde tag = "type", rename_all = "snake_case")

interface ProxyRequest {
  type: "proxy_request";
  id: number;
  method: string;
  path: string;
  body?: string | null;
}

interface ProxyResponse {
  type: "proxy_response";
  id: number;
  status: number;
  body: string;
}

interface BlobStreamRequest {
  type: "blob_stream_request";
  id: number;
  blob_id: string;
}

interface BlobStreamResponse {
  type: "blob_stream_response";
  id: number;
  size?: number | null;
  content_type?: string | null;
  error?: string | null;
}

type PeerMessage =
  | ProxyRequest
  | ProxyResponse
  | BlobStreamRequest
  | BlobStreamResponse
  | { type: string; [key: string]: unknown };

// ---- constants ------------------------------------------------------------

const TAG = "[freqhole-handler]";

// ---- helpers --------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function sendMessage(stream: BiStreamLike, msg: PeerMessage): Promise<void> {
  const json = JSON.stringify(msg);
  const bytes = encoder.encode(json);
  await stream.write_message(bytes);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// lazy import to avoid circular deps and keep the module light at load time
async function getBlobStore() {
  return import("../storage/skein-blob-store");
}

// ---- proxy request dispatch -----------------------------------------------

/**
 * extract a path parameter from a URL pattern.
 * e.g. extractPathParam("/api/blobs/abc123/data", /^\/api\/blobs\/([^/]+)\/data$/) => "abc123"
 */
function extractPathParam(path: string, pattern: RegExp): string | null {
  const match = path.match(pattern);
  return match ? match[1] : null;
}

async function handleProxyRequest(stream: BiStreamLike, msg: ProxyRequest): Promise<void> {
  const { id, method, path, body } = msg;
  const peerId = stream.peer_node_id().slice(0, 16);

  console.log(TAG, `proxy ${method} ${path} from ${peerId}...`);

  let parsedBody: Record<string, unknown> = {};
  if (body) {
    try {
      parsedBody = JSON.parse(body);
    } catch {
      // body is not JSON — that's fine for some endpoints
    }
  }

  try {
    // POST /api/blobs/thumbnail_data
    if (path === "/api/blobs/thumbnail_data" && method === "POST") {
      await handleThumbnailData(stream, id, parsedBody);
      return;
    }

    // GET /api/blobs/{id}/data
    const blobDataId = extractPathParam(path, /^\/api\/blobs\/([^/]+)\/data$/);
    if (blobDataId && method === "GET") {
      await handleBlobData(stream, id, blobDataId);
      return;
    }

    // POST or GET /api/blob_metadata
    if (
      (path === "/api/blob_metadata" || path === "/api/blobs/metadata") &&
      (method === "POST" || method === "GET")
    ) {
      await handleBlobMetadata(stream, id, parsedBody);
      return;
    }

    // fallback — not implemented
    console.log(TAG, `unhandled proxy route: ${method} ${path}`);
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 404,
      body: JSON.stringify({ success: false, message: "not implemented" }),
    });
  } catch (err) {
    console.error(TAG, `error handling proxy ${method} ${path}:`, err);
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 500,
      body: JSON.stringify({
        success: false,
        message: err instanceof Error ? err.message : "internal error",
      }),
    });
  }
}

async function handleThumbnailData(
  stream: BiStreamLike,
  id: number,
  body: Record<string, unknown>,
): Promise<void> {
  const blobId = (body.blob_id ?? body.id) as string | undefined;
  if (!blobId) {
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 400,
      body: JSON.stringify({ success: false, message: "missing blob_id" }),
    });
    return;
  }

  const store = await getBlobStore();
  const record = await store.getBlobRecord(blobId);
  if (!record) {
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 404,
      body: JSON.stringify({ success: false, message: "blob not found" }),
    });
    return;
  }

  const data = await store.getBlobData(blobId);
  if (!data) {
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 404,
      body: JSON.stringify({ success: false, message: "blob data not found in OPFS" }),
    });
    return;
  }

  // browser doesn't generate thumbnails — serve the original image data.
  // this is fine for photos; the peer will display the original.
  const base64 = arrayBufferToBase64(data);
  await sendMessage(stream, {
    type: "proxy_response",
    id,
    status: 200,
    body: JSON.stringify({
      success: true,
      data: {
        data: base64,
        mime: record.mime || "application/octet-stream",
      },
    }),
  });
}

async function handleBlobData(
  stream: BiStreamLike,
  id: number,
  blobId: string,
): Promise<void> {
  const store = await getBlobStore();
  const record = await store.getBlobRecord(blobId);
  if (!record) {
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 404,
      body: JSON.stringify({ success: false, message: "blob not found" }),
    });
    return;
  }

  const data = await store.getBlobData(blobId);
  if (!data) {
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 404,
      body: JSON.stringify({ success: false, message: "blob data not found in OPFS" }),
    });
    return;
  }

  const base64 = arrayBufferToBase64(data);
  await sendMessage(stream, {
    type: "proxy_response",
    id,
    status: 200,
    body: JSON.stringify({
      success: true,
      data: {
        data: base64,
        mime: record.mime || "application/octet-stream",
      },
    }),
  });
}

async function handleBlobMetadata(
  stream: BiStreamLike,
  id: number,
  body: Record<string, unknown>,
): Promise<void> {
  const blobId = (body.id ?? body.blob_id) as string | undefined;
  if (!blobId) {
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 400,
      body: JSON.stringify({ success: false, message: "missing id" }),
    });
    return;
  }

  const store = await getBlobStore();
  const record = await store.getBlobRecord(blobId);
  if (!record) {
    await sendMessage(stream, {
      type: "proxy_response",
      id,
      status: 404,
      body: JSON.stringify({ success: false, message: "blob not found" }),
    });
    return;
  }

  // return a simplified record matching what grimoire returns
  await sendMessage(stream, {
    type: "proxy_response",
    id,
    status: 200,
    body: JSON.stringify({
      success: true,
      data: {
        id: record.blob_id,
        mime: record.mime,
        filename: record.filename,
        size: record.size,
        blake3: record.blake3 || null,
        domain: record.domain,
        blob_type: record.blob_type,
      },
    }),
  });
}

// ---- blob stream request --------------------------------------------------

async function handleBlobStreamRequest(
  stream: BiStreamLike,
  msg: BlobStreamRequest,
): Promise<void> {
  const { id, blob_id } = msg;
  const peerId = stream.peer_node_id().slice(0, 16);

  console.log(TAG, `blob stream request for ${blob_id} from ${peerId}...`);

  const store = await getBlobStore();
  const record = await store.getBlobRecord(blob_id);

  if (!record) {
    await sendMessage(stream, {
      type: "blob_stream_response",
      id,
      size: null,
      content_type: null,
      error: "blob not found",
    });
    return;
  }

  const data = await store.getBlobData(blob_id);
  if (!data) {
    await sendMessage(stream, {
      type: "blob_stream_response",
      id,
      size: null,
      content_type: null,
      error: "blob data not found in OPFS",
    });
    return;
  }

  // send header with size and content type
  await sendMessage(stream, {
    type: "blob_stream_response",
    id,
    size: data.byteLength,
    content_type: record.mime || "application/octet-stream",
    error: null,
  });

  // send the raw blob bytes as a second length-delimited message
  await stream.write_message(new Uint8Array(data));
}

// ---- main entry point -----------------------------------------------------

async function handleStreamAsync(stream: BiStreamLike): Promise<void> {
  const peerId = stream.peer_node_id().slice(0, 16);

  // read one request message from the stream
  const raw = await stream.read_message();
  if (!raw) {
    // stream closed before any message — nothing to do
    console.log(TAG, `stream from ${peerId}... closed before message`);
    return;
  }

  const json = decoder.decode(raw);
  let msg: PeerMessage;
  try {
    msg = JSON.parse(json) as PeerMessage;
  } catch (err) {
    console.error(TAG, `failed to parse message from ${peerId}...:`, err);
    return;
  }

  switch (msg.type) {
    case "proxy_request":
      await handleProxyRequest(stream, msg as ProxyRequest);
      break;

    case "blob_stream_request":
      await handleBlobStreamRequest(stream, msg as BlobStreamRequest);
      break;

    default:
      console.log(TAG, `unhandled message type "${msg.type}" from ${peerId}...`);
      // try to send a generic error response if the message has an id
      if ("id" in msg && typeof msg.id === "number") {
        await sendMessage(stream, {
          type: "proxy_response",
          id: msg.id,
          status: 400,
          body: JSON.stringify({
            success: false,
            message: `unsupported message type: ${msg.type}`,
          }),
        });
      }
      break;
  }
}

/**
 * handle an incoming freqhole/1 ALPN stream.
 *
 * this is the entry point registered with `adapter.registerAlpnHandler("freqhole/1", ...)`.
 * it fires-and-forgets an async handler — errors are caught and logged internally.
 */
export function handleFreqholeStream(stream: BiStreamLike): void {
  handleStreamAsync(stream)
    .catch((err) => {
      console.error(TAG, "stream handler error:", err);
    })
    .finally(() => {
      try {
        stream.close();
      } catch {
        // ignore close errors — stream may already be closed
      }
    });
}
