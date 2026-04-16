// uuid v4 generator using crypto api
//
// polyfills crypto.randomUUID() for old WebView (Chrome < 92)
// using crypto.getRandomValues() which has been available since Chrome 11.

if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  crypto.randomUUID = function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // set version 4 (0100 in bits 48-51)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // set variant 1 (10xx in bits 64-67)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

export function generateUUID(): string {
  return crypto.randomUUID();
}
