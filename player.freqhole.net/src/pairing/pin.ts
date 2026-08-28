// generates a random 6-char hex pairing pin, and basic validation helpers.
//
// per user decision: the pin is never encoded in the QR - it's typed in by
// the pairing user and sent to the player over the p2p connection dialed
// via the QR's node id, as a trust-confirmation step (see docs/
// player-remote-site-plan.md phase 2).

const PIN_LENGTH = 6;
const HEX_CHARS = "0123456789abcdef";

export function generatePin(): string {
  const bytes = new Uint8Array(PIN_LENGTH);
  crypto.getRandomValues(bytes);
  let pin = "";
  for (const byte of bytes) {
    pin += HEX_CHARS[byte % HEX_CHARS.length];
  }
  return pin;
}

export function isValidPinFormat(candidate: string): boolean {
  return /^[0-9a-f]{6}$/i.test(candidate);
}
