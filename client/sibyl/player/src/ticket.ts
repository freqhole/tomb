// sibyl ticket codec — pure ts mirror of `sibyl-core::ticket`.
// callers that build tickets locally (rare; usually the host gives us
// a string) use `encodeTicket`. peers always `decodeTicket` first to
// learn `params` before instantiating the player backend.

import type { CodecParams } from "./types.js";

export interface SibylTicket {
  song_id: string;
  iroh_ticket: string;
  params: CodecParams;
  title?: string | null;
}

export function encodeTicket(t: SibylTicket): string {
  const json = JSON.stringify(t);
  return base64UrlEncode(new TextEncoder().encode(json));
}

export function decodeTicket(s: string): SibylTicket {
  const bytes = base64UrlDecode(s.trim());
  return JSON.parse(new TextDecoder().decode(bytes)) as SibylTicket;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
