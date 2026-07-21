// sha256 hashing helpers built on the web crypto subtle api. used wherever a
// content hash is needed but the full blake3-canonical blob pipeline (./blobs,
// ./worker) is overkill - legacy sha256 references, quick integrity checks, etc.

/**
 * hash of an ArrayBuffer (or a view over one) as a lowercase hex string.
 */
export async function sha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string> {
  const buffer = ArrayBuffer.isView(data)
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data;
  const digest = await crypto.subtle.digest("SHA-256", buffer as ArrayBuffer);
  return bufferToHex(digest);
}

/**
 * hash of a File/Blob's contents as a lowercase hex string.
 */
export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  return sha256Hex(await blob.arrayBuffer());
}

/**
 * true if `data` hashes to `expectedHex` (case-insensitive).
 */
export async function verifySha256Hex(
  data: ArrayBuffer | ArrayBufferView,
  expectedHex: string
): Promise<boolean> {
  const actual = await sha256Hex(data);
  return actual === expectedHex.toLowerCase();
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
