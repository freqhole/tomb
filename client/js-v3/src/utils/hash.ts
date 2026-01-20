// hash utilities for computing file hashes

/**
 * compute SHA256 hash of a file or blob
 * returns hex string of the hash
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
