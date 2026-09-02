// qr code generation for the pairing screen: encodes the player's node id
// + display metadata (name, role marker) - NEVER the pin (see pairing/pin.ts).
// rendered magenta-on-black with the freqhole triangle logo composited in
// the center; high error-correction level keeps the code scannable despite
// the logo overlay.

import QRCode from "qrcode";

export interface PlayerQrPayload {
  node_id: string;
  name: string;
  role: "player_remote";
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * encodes the payload as a base64url json blob wrapped in a spume url, so
 * scanning the qr with any camera app (not just spume's own scanner) opens
 * spume and offers to pair - spume's qr scanner and top-nav-search paste
 * handling both strip the url and decode the `p` param back to json (see
 * spume's PairPlayerModal.tsx).
 */
export function encodePlayerQrPayload(payload: PlayerQrPayload): string {
  const json = JSON.stringify(payload);
  const b64 = base64UrlEncode(new TextEncoder().encode(json));
  return `https://spume.freqhole.net/?p=${b64}`;
}

const QR_DARK = "#ff00c8"; // magenta
const QR_LIGHT = "#000000"; // black

/**
 * render the pairing QR onto a canvas, with the freqhole logo composited
 * in the center. returns a data URL suitable for an <img> src.
 */
export async function renderPlayerQr(
  payload: PlayerQrPayload,
  logoUrl = "/freqhole.svg",
): Promise<string> {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, encodePlayerQrPayload(payload), {
    // rendered large so it stays crisp when stretched to fill most of the
    // screen (see App.tsx's pairing-qr sizing).
    width: 960,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: QR_DARK, light: QR_LIGHT },
  });

  const logo = await loadImage(logoUrl);
  const ctx = canvas.getContext("2d");
  if (ctx && logo) {
    const logoSize = canvas.width * 0.22;
    const x = (canvas.width - logoSize) / 2;
    const y = (canvas.height - logoSize) / 2;
    // small black backing square so the logo reads cleanly over the qr modules
    const pad = logoSize * 0.15;
    ctx.fillStyle = QR_LIGHT;
    ctx.fillRect(x - pad, y - pad, logoSize + pad * 2, logoSize + pad * 2);
    ctx.drawImage(logo, x, y, logoSize, logoSize);
  }

  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
