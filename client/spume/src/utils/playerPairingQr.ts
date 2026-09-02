// detects freqhole-player pairing QR payloads (the `?p=<base64url json>`
// scheme - see app/player/renderPairingQr.ts's encodePlayerQrPayload).
// shared by PairPlayerModal.tsx (its own dedicated pairing flow) and
// AddRemoteModal.tsx (which needs to recognize a scanned/pasted player qr
// and hand off the embedded node_id to its existing player_device pairing
// step, instead of trying to test the wrapper url as a remote server -
// see docs/player-remote-site-plan.md phase 5's "separate modal" design
// decision for why these two flows stay independent otherwise).

export interface ScannedPlayerQr {
  node_id: string;
  name: string;
  role: "player_remote";
}

function base64UrlDecode(token: string): string {
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** player.freqhole.net's qr encodes `https://spume.freqhole.net/?p=<base64url
 * json>` so any camera app can open spume directly - strip the url wrapper
 * and decode the `p` param back to json. falls back to parsing `text`
 * as-is for back-compat with older bare-json qr codes. */
export function parsePlayerPairingQr(text: string): ScannedPlayerQr | null {
  const trimmed = text.trim();
  let jsonText = trimmed;

  try {
    const url = new URL(trimmed);
    const pParam = url.searchParams.get("p");
    if (pParam) jsonText = base64UrlDecode(pParam);
  } catch {
    const match = trimmed.match(/[?&]p=([A-Za-z0-9_-]+)/);
    if (match) jsonText = base64UrlDecode(match[1]);
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (parsed?.role === "player_remote" && typeof parsed.node_id === "string") {
      return parsed as ScannedPlayerQr;
    }
  } catch {
    // not JSON - fall through
  }
  return null;
}
