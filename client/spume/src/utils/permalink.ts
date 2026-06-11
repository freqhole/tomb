// permalink (deep-link) encoder / decoder for share urls.
//
// url shape (see docs/SEND_TO_REMOTE_PLAN.md):
//   freqhole://o/<base64url(payload)>
//   https://<webHost>/#?share=<base64url(payload)>
//
// the web form lives in the url hash because spume uses `HashRouter` —
// putting it on the path would 404 on static hosting. it sits as a query
// inside the hash so it can overlay any existing route.
//
// payload is a SharePayloadV1 — canonical-json (sorted keys, no whitespace),
// then base64url-encoded (no padding). v1 is unsigned; share links describe
// an entity, they don't grant access. signing arrives in v2 if needed.
//
// at least one of `s.n` (source iroh node id, 64 hex) or `s.h` (source http
// origin) must be present so a recipient can resolve the entity.

import type { ShareTargetKind } from "../components/share/types";

const VALID_KINDS: ShareTargetKind[] = ["album", "playlist", "song", "artist", "radio_station"];

const NODE_ID_RE = /^[0-9a-f]{64}$/i;

/** v1 share payload. keep field names short — they end up in url bars. */
export interface SharePayloadV1 {
  /** schema version. always 1. */
  v: 1;
  /** source identity. at least one of `n` / `h` must be set. */
  s: {
    /** source iroh node id (64 hex). preferred for p2p clients. */
    n?: string;
    /** source http origin, e.g. "https://music.example.com". */
    h?: string;
  };
  /** entity kind. */
  k: ShareTargetKind;
  /** entity id on the source remote. */
  i: string;
  /**
   * optional parent entity id — used today only for `k: "song"` to carry
   * the album id so the resolver can navigate to the album view and
   * highlight the song row. ignored for other kinds.
   */
  p?: string;
  /** optional human display title — for nicer toasts; not trusted. */
  t?: string;
  /** optional artist name — not trusted, display only. */
  a?: string;
  /** optional album name — not trusted, display only. for song shares. */
  al?: string;
}

export interface ShareUrls {
  /** `https://<webHost>/#?share=<token>` web mirror. */
  webUrl: string;
}

/** query param name used inside the hash for web share urls. */
export const SHARE_HASH_PARAM = "share";

/** default web mirror host for share urls. overridable via `buildShareUrls(p, host)`. */
export const DEFAULT_SHARE_WEB_HOST = "https://spume.freqhole.net";

/**
 * returns the best available web host for share urls.
 * uses the current page origin when it's http(s) (i.e. the app is being
 * served from a real web server or a self-hosted instance). falls back to
 * the canonical spume.freqhole.net host when running inside tauri
 * (origin is `tauri://localhost` or similar) or any other non-http(s) context.
 */
export function getShareWebHost(): string {
  try {
    const origin = window.location.origin;
    if (origin && (origin.startsWith("https://") || origin.startsWith("http://"))) {
      return origin;
    }
  } catch {
    // window not available (ssr / test context)
  }
  return DEFAULT_SHARE_WEB_HOST;
}

// ---- encoder / decoder -----------------------------------------------------

/**
 * canonical-json: keys sorted, no whitespace. ensures the same payload always
 * produces the same token regardless of object construction order.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
      .join(",") +
    "}"
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  // btoa expects a binary string. build it without going through TextDecoder
  // so we can handle the ascii-only json output deterministically.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  // url-safe + strip padding
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(token: string): Uint8Array {
  // restore padding + standard b64 alphabet
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * validate + encode a share payload. throws on invalid input so callers
 * fail loudly at construction time rather than producing a junk url.
 */
export function encodeShareToken(p: SharePayloadV1): string {
  validatePayload(p);
  const json = canonicalJson(p);
  const bytes = new TextEncoder().encode(json);
  return base64UrlEncode(bytes);
}

/**
 * decode a share token back to a `SharePayloadV1`. throws on invalid base64,
 * malformed json, or any structural / semantic check that fails. unknown
 * fields outside the schema are dropped silently (forward-compat).
 */
export function decodeShareToken(token: string): SharePayloadV1 {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(token);
  } catch (e) {
    throw new Error(`invalid share token (base64): ${String(e)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new Error(`invalid share token (json): ${String(e)}`);
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("invalid share token: payload is not an object");
  }
  const obj = json as Record<string, unknown>;
  if (obj.v !== 1) {
    throw new Error(`unsupported share token version: ${String(obj.v)}`);
  }
  if (!obj.s || typeof obj.s !== "object" || Array.isArray(obj.s)) {
    throw new Error("invalid share token: missing source identity");
  }
  const s = obj.s as Record<string, unknown>;
  const out: SharePayloadV1 = {
    v: 1,
    s: {
      n: typeof s.n === "string" ? s.n : undefined,
      h: typeof s.h === "string" ? s.h : undefined,
    },
    k: obj.k as ShareTargetKind,
    i: typeof obj.i === "string" ? obj.i : "",
    p: typeof obj.p === "string" ? obj.p : undefined,
    t: typeof obj.t === "string" ? obj.t : undefined,
    a: typeof obj.a === "string" ? obj.a : undefined,
    al: typeof obj.al === "string" ? obj.al : undefined,
  };
  validatePayload(out);
  return out;
}

/** build share urls from a payload. */
export function buildShareUrls(
  p: SharePayloadV1,
  webHost: string = getShareWebHost(),
): ShareUrls {
  const token = encodeShareToken(p);
  const host = webHost.replace(/\/+$/, "");
  return {
    webUrl: `${host}/#?${SHARE_HASH_PARAM}=${token}`,
  };
}

/**
 * extract a share token from a hash string (e.g. `window.location.hash`).
 * accepts both `#?share=...` and `#/whatever?share=...` shapes — anything
 * after the first `?` is parsed as url-search-params.
 */
export function extractShareTokenFromHash(hash: string): string | null {
  if (!hash) return null;
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIdx = stripped.indexOf("?");
  if (qIdx < 0) return null;
  const params = new URLSearchParams(stripped.slice(qIdx + 1));
  const token = params.get(SHARE_HASH_PARAM);
  return token && token.length > 0 ? token : null;
}

/**
 * scan arbitrary text for a valid share token. ignores any surrounding
 * text — domain, protocol, query params, line noise — and returns the
 * first base64url-shaped substring that decodes as a SharePayloadV1.
 * returns null when no decodable token is found.
 */
export function extractShareTokenFromAnyText(input: string): string | null {
  if (!input) return null;
  const matches = input.match(/[A-Za-z0-9_-]{40,}/g);
  if (!matches) return null;
  for (const candidate of matches) {
    try {
      decodeShareToken(candidate);
      return candidate;
    } catch {
      // not a share token; keep scanning
    }
  }
  return null;
}

// ---- validation ------------------------------------------------------------

function validatePayload(p: SharePayloadV1): void {
  if (p.v !== 1) {
    throw new Error(`invalid share payload: v must be 1, got ${String(p.v)}`);
  }
  if (!VALID_KINDS.includes(p.k)) {
    throw new Error(`invalid share payload: unknown kind "${String(p.k)}"`);
  }
  if (!p.i || typeof p.i !== "string") {
    throw new Error("invalid share payload: missing entity id (i)");
  }
  if (!p.s || (p.s.n === undefined && p.s.h === undefined)) {
    throw new Error(
      "invalid share payload: at least one of s.n (node_id) or s.h (http origin) must be set",
    );
  }
  if (p.s.n !== undefined && !NODE_ID_RE.test(p.s.n)) {
    throw new Error(
      `invalid share payload: s.n must be 64 hex chars, got "${p.s.n}"`,
    );
  }
  if (p.s.h !== undefined) {
    try {
      const url = new URL(p.s.h);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error(`bad protocol: ${url.protocol}`);
      }
      // origin only — paths/queries leak through otherwise.
      if (p.s.h !== url.origin) {
        throw new Error(`s.h must be a bare origin, got "${p.s.h}"`);
      }
    } catch (e) {
      throw new Error(`invalid share payload: s.h: ${String(e)}`);
    }
  }
}
