// shared byte <-> base64 helpers for chunked tauri IPC uploads.
// extracted from CharnelTransport.ts so CharnelLocalTransport.ts's chunked
// upload path can reuse the exact same, already-proven-safe encoding.

/**
 * encode a Uint8Array to a base64 string.
 * only ever called with bounded chunk sizes (a few MB at most) by callers
 * in this package - never the whole file at once.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
