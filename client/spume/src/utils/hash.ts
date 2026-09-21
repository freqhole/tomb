// hash utilities for computing file hashes

/**
 * compute SHA256 hash of a file or blob (whole-file `crypto.subtle.digest`
 * read - Web Crypto has no incremental/streaming digest API).
 *
 * NOT called from local music import anymore (as of
 * docs/blob-transfer-opfs-and-sha256-refactor-plan.md phase 7 - see
 * fileProcessor.ts's `processMusicFile` doc comment) - kept around for
 * any future one-off/manual re-hash tooling, not because anything still
 * depends on it. don't reintroduce a call to this from a hot import path
 * without re-reading that doc comment first.
 */
export async function computeSHA256(data: Blob | File): Promise<string> {
  // read file as array buffer
  const buffer = await data.arrayBuffer();

  // compute hash using web crypto api
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

  // convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  return hashHex;
}
