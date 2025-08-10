/**
 * Utility functions for calculating SHA-256 hashes
 */

/**
 * Calculate SHA-256 hash of ArrayBuffer data
 * @param data ArrayBuffer containing the data to hash
 * @returns Promise<string> Hex string representation of the hash
 */
export async function calculateSHA256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Calculate SHA-256 hash of a File
 * @param file File to hash
 * @returns Promise<string> Hex string representation of the hash
 */
export async function calculateFileSHA256(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  return calculateSHA256(arrayBuffer);
}

/**
 * Verify if a given hash matches the SHA-256 of the provided data
 * @param data ArrayBuffer containing the data to verify
 * @param expectedHash Expected SHA-256 hash as hex string
 * @returns Promise<boolean> True if hash matches, false otherwise
 */
export async function verifySHA256(data: ArrayBuffer, expectedHash: string): Promise<boolean> {
  const actualHash = await calculateSHA256(data);
  return actualHash === expectedHash;
}
