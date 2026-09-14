// permalink (deep-link) encoder / decoder for share urls.
//
// url shape (see docs/SEND_TO_REMOTE_PLAN.md):
//   freqhole://o/<base64url(payload)>
//   https://<webHost>/#?share=<base64url(payload)>
//
// the web form lives in the url hash because spume uses `HashRouter` —
// putting it on the path would 404 on static hosting, and it would also
// collide with the `/:remoteId` dynamic route (a bare `#share/<token>`
// fragment, the shape other freqhole apps use, matches that route and
// triggers a real "remote not found" navigation before this file's own
// hashchange listener gets a chance to look at it). it sits as a query
// inside the hash instead so it can overlay any existing route.
//
// the token itself is just spume's own field names (`v`/`s`/`k`/`i`/...)
// over haruspex's shared `@freqhole/haruspex/share` codec (its legacy v1
// "entity" wire shape) rather than a second, hand-rolled codec — so a
// share link decodes the same way here as it does in skein or any other
// haruspex-based app, even though spume still embeds the token in its own
// router-safe url shape. `decodeShareToken` rejects (throws) any token
// that decodes to a non-`entity` haruspex payload (a bare node reference,
// or another app's own doc/canvas share) — those aren't resolvable here.
//
// at least one of `s.n` (source iroh node id, 64 hex) or `s.h` (source http
// origin) must be present so a recipient can resolve the entity.

import type { ShareTargetKind } from "../components/share/types";
import { isCharnelMode } from "../app/services/charnel/mode";
import {
  decodeShareToken as haruspexDecodeShareToken,
  encodeShareToken as haruspexEncodeShareToken,
  extractShareToken as haruspexExtractShareToken,
  type EntitySharePayload,
} from "@freqhole/haruspex/share";

const VALID_KINDS: ShareTargetKind[] = [
  "album",
  "playlist",
  "song",
  "artist",
  "radio_station",
  "video",
  "video_series",
];

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
 *
 * tauri's internal webview origin isn't always non-http(s): macOS/iOS/Linux
 * use the custom `tauri://localhost` scheme (caught by the scheme check
 * below), but android's webview reports an *http(s)-scheme* origin —
 * `https://tauri.localhost` — which the old scheme-only check let straight
 * through as if it were a real, shareable host. filter both forms out
 * explicitly (by hostname, not just scheme), plus fall back whenever
 * `isCharnelMode()` says we're in tauri at all, regardless of what the
 * origin string happens to look like on a given platform.
 */
export function getShareWebHost(): string {
  try {
    const origin = window.location.origin;
    if (isCharnelMode()) return DEFAULT_SHARE_WEB_HOST;

    let hostname = "";
    try {
      hostname = new URL(origin).hostname.toLowerCase();
    } catch {
      hostname = "";
    }
    const isTauriOrigin =
      origin.startsWith("tauri://") ||
      hostname === "tauri.localhost" ||
      hostname.endsWith(".tauri.localhost");

    if (!isTauriOrigin && (origin.startsWith("https://") || origin.startsWith("http://"))) {
      return origin;
    }
  } catch {
    // window not available (ssr / test context)
  }
  return DEFAULT_SHARE_WEB_HOST;
}

// ---- encoder / decoder -----------------------------------------------------

/** spume's own `SharePayloadV1` <-> haruspex's shared `EntitySharePayload`
 * wire shape - same information, different field names/nesting. keeping
 * this adapter (rather than renaming every field through spume) lets
 * every existing call site stay untouched while the actual encode/decode
 * work runs through the one shared codec every freqhole app (skein
 * included) uses, instead of a second, hand-rolled implementation. */
function toEntityPayload(p: SharePayloadV1): EntitySharePayload {
  return {
    kind: "entity",
    source: { nodeId: p.s.n, httpOrigin: p.s.h },
    entityKind: p.k,
    entityId: p.i,
    parentId: p.p,
    title: p.t,
    artist: p.a,
    album: p.al,
  };
}

function fromEntityPayload(e: EntitySharePayload): SharePayloadV1 {
  return {
    v: 1,
    s: { n: e.source.nodeId, h: e.source.httpOrigin },
    k: e.entityKind as ShareTargetKind,
    i: e.entityId,
    p: e.parentId,
    t: e.title,
    a: e.artist,
    al: e.album,
  };
}

/**
 * validate + encode a share payload. throws on invalid input so callers
 * fail loudly at construction time rather than producing a junk url.
 */
export function encodeShareToken(p: SharePayloadV1): string {
  validatePayload(p);
  return haruspexEncodeShareToken(toEntityPayload(p));
}

/**
 * decode a share token back to a `SharePayloadV1`. accepts a bare token, a
 * `#share/<token>`/`share/<token>` fragment, or a full url ending in one
 * (see haruspex's `extractShareToken`) - the caller doesn't need to strip
 * anything itself. throws on invalid base64/json, on a token that decodes
 * to a non-`entity` share (e.g. a bare node reference or another app's doc
 * share - not resolvable here), or on any structural/semantic check that
 * fails.
 */
export function decodeShareToken(token: string): SharePayloadV1 {
  const payload = haruspexDecodeShareToken(token);
  if (!payload) {
    throw new Error("invalid share token");
  }
  if (payload.kind !== "entity") {
    throw new Error(`unsupported share token kind: "${payload.kind}"`);
  }
  const out = fromEntityPayload(payload);
  validatePayload(out);
  return out;
}

/** build share urls from a payload. */
export function buildShareUrls(p: SharePayloadV1, webHost: string = getShareWebHost()): ShareUrls {
  const token = encodeShareToken(p);
  const host = webHost.replace(/\/+$/, "");
  return {
    webUrl: `${host}/#?${SHARE_HASH_PARAM}=${token}`,
  };
}

/**
 * extract a share token from a hash string (e.g. `window.location.hash`).
 * accepts spume's own `#?share=...` / `#/whatever?share=...` shapes (still
 * how spume embeds its own links in a url — see `buildShareUrls`, which
 * deliberately avoids the bare `#share/<token>` fragment other freqhole
 * apps use, since that would collide with spume's `/:remoteId` hash
 * route), and falls back to haruspex's `#share/<token>`/`share/<token>`
 * fragment shape for a link generated by one of those other apps.
 */
export function extractShareTokenFromHash(hash: string): string | null {
  if (!hash) return null;
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIdx = stripped.indexOf("?");
  if (qIdx >= 0) {
    const token = new URLSearchParams(stripped.slice(qIdx + 1)).get(SHARE_HASH_PARAM);
    if (token) return token;
  }
  const fallback = haruspexExtractShareToken(stripped);
  return fallback && fallback !== stripped ? fallback : null;
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
      "invalid share payload: at least one of s.n (node_id) or s.h (http origin) must be set"
    );
  }
  if (p.s.n !== undefined && !NODE_ID_RE.test(p.s.n)) {
    throw new Error(`invalid share payload: s.n must be 64 hex chars, got "${p.s.n}"`);
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
