// unified share-link token codec.
//
// three token shapes exist in the wild for sharing a p2p entity via a
// pasted string or url fragment:
//   - a node id + an automerge doc id, with optional title/mode hints
//   - a node id alone (a plain peer reference, no doc)
//   - a source (p2p node id and/or http origin) plus an app-defined entity
//     kind + id, with optional parent/title/artist/album display hints
//
// this codec's own wire format is versioned explicitly (`v`) so a future
// payload addition never breaks a link already sitting in someone's
// clipboard or browser history. decoding also recognizes the legacy token
// shapes below, none of which carry a wire version of their own that lines
// up with this codec's, so they are told apart by their field shape.

import { z } from "zod";

/** a bare node reference: "come dial this peer", nothing else. */
export interface NodeSharePayload {
  kind: "node";
  nodeId: string;
  title?: string;
}

/** a node id + automerge doc id, with an optional sharing-mode hint. */
export interface DocSharePayload {
  kind: "doc";
  nodeId: string;
  docId: string;
  title?: string;
  mode?: "public" | "knock";
}

/**
 * an entity hosted on a source (a p2p node id and/or an http origin - at
 * least one should be set so a recipient can resolve it). `entityKind` is
 * app-defined (e.g. "album", "song", "canvas") - this package does not own
 * a fixed vocabulary for it.
 */
export interface EntitySharePayload {
  kind: "entity";
  source: { nodeId?: string; httpOrigin?: string };
  entityKind: string;
  entityId: string;
  parentId?: string;
  title?: string;
  artist?: string;
  album?: string;
}

export type ShareTokenPayload = NodeSharePayload | DocSharePayload | EntitySharePayload;

const CURRENT_WIRE_VERSION = 2;

// wire schema (short keys - these end up in url bars).
const NodeWireSchema = z.object({
  v: z.literal(CURRENT_WIRE_VERSION),
  k: z.literal("node"),
  n: z.string().min(1),
  t: z.string().optional(),
});

const DocWireSchema = z.object({
  v: z.literal(CURRENT_WIRE_VERSION),
  k: z.literal("doc"),
  n: z.string().min(1),
  d: z.string().min(1),
  t: z.string().optional(),
  m: z.enum(["public", "knock"]).optional(),
});

const EntityWireSchema = z.object({
  v: z.literal(CURRENT_WIRE_VERSION),
  k: z.literal("entity"),
  sn: z.string().optional(),
  sh: z.string().optional(),
  ek: z.string().min(1),
  i: z.string().min(1),
  p: z.string().optional(),
  t: z.string().optional(),
  a: z.string().optional(),
  al: z.string().optional(),
});

const WireSchema = z.discriminatedUnion("k", [NodeWireSchema, DocWireSchema, EntityWireSchema]);
type Wire = z.infer<typeof WireSchema>;

// legacy shapes this codec still decodes, so links handed out before the
// unified codec existed keep working.
const DocLegacyV1Schema = z.object({
  v: z.literal(1),
  n: z.string().min(1),
  d: z.string().min(1),
  t: z.string().optional(),
  m: z.enum(["public", "knock"]).optional(),
});

const EntityLegacyV1Schema = z.object({
  v: z.literal(1),
  s: z.object({ n: z.string().optional(), h: z.string().optional() }),
  k: z.string().min(1),
  i: z.string().min(1),
  p: z.string().optional(),
  t: z.string().optional(),
  a: z.string().optional(),
  al: z.string().optional(),
});

// bare node id + doc id, no version marker at all.
const DocBareLegacySchema = z.object({
  n: z.string().min(1),
  d: z.string().min(1),
});

function toWire(payload: ShareTokenPayload): Wire {
  switch (payload.kind) {
    case "node":
      return { v: CURRENT_WIRE_VERSION, k: "node", n: payload.nodeId, t: payload.title };
    case "doc":
      return {
        v: CURRENT_WIRE_VERSION,
        k: "doc",
        n: payload.nodeId,
        d: payload.docId,
        t: payload.title,
        m: payload.mode,
      };
    case "entity":
      return {
        v: CURRENT_WIRE_VERSION,
        k: "entity",
        sn: payload.source.nodeId,
        sh: payload.source.httpOrigin,
        ek: payload.entityKind,
        i: payload.entityId,
        p: payload.parentId,
        t: payload.title,
        a: payload.artist,
        al: payload.album,
      };
  }
}

function fromWire(wire: Wire): ShareTokenPayload {
  switch (wire.k) {
    case "node":
      return { kind: "node", nodeId: wire.n, title: wire.t };
    case "doc":
      return { kind: "doc", nodeId: wire.n, docId: wire.d, title: wire.t, mode: wire.m };
    case "entity":
      return {
        kind: "entity",
        source: { nodeId: wire.sn, httpOrigin: wire.sh },
        entityKind: wire.ek,
        entityId: wire.i,
        parentId: wire.p,
        title: wire.t,
        artist: wire.a,
        album: wire.al,
      };
  }
}

// base64url helpers built on TextEncoder/TextDecoder rather than raw
// btoa/atob, so a title containing non-latin1 characters round-trips
// instead of throwing.
function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(token: string): Uint8Array {
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** encode a share payload as a base64url token (no padding). */
export function encodeShareToken(payload: ShareTokenPayload): string {
  const wire = stripUndefined(toWire(payload) as unknown as Record<string, unknown>);
  const json = JSON.stringify(wire);
  return base64UrlEncode(new TextEncoder().encode(json));
}

/** build a url fragment for embedding in window.location.hash. */
export function shareFragment(payload: ShareTokenPayload): string {
  return `#share/${encodeShareToken(payload)}`;
}

/**
 * strip a share url/fragment down to the bare token: handles a full url
 * ending in a `#share/<token>` fragment, a bare `share/<token>` prefix, and
 * a trailing `&`-joined query fragment appended after the token. returns
 * the input unchanged (trimmed) when none of those prefixes are present,
 * so a bare token passes through untouched.
 */
export function extractShareToken(input: string): string {
  let raw = input.trim();

  const hashIdx = raw.indexOf("#share/");
  if (hashIdx !== -1) {
    raw = raw.slice(hashIdx + "#share/".length);
  } else if (raw.startsWith("share/")) {
    raw = raw.slice("share/".length);
  }

  const ampIdx = raw.indexOf("&");
  if (ampIdx !== -1) raw = raw.slice(0, ampIdx);

  return raw;
}

/**
 * decode a share token back to a payload. accepts a raw token, a
 * `#share/<token>` fragment, or a full url ending in one. also decodes the
 * legacy doc-share shapes (versioned `{v:1,n,d,t,m}` and the bare,
 * unversioned `{n,d}` form) and the legacy entity-share shape
 * (`{v:1,s:{n,h},k,i,...}`), mapping every one of them onto the current
 * payload types. returns null on anything invalid rather than throwing, so
 * callers can treat "not a share token" as just another input
 * classification.
 */
export function decodeShareToken(input: string): ShareTokenPayload | null {
  const raw = extractShareToken(input);
  if (!raw) return null;

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(base64UrlDecode(raw)));
  } catch {
    return null;
  }

  const wire = WireSchema.safeParse(json);
  if (wire.success) return fromWire(wire.data);

  const docLegacy = DocLegacyV1Schema.safeParse(json);
  if (docLegacy.success) {
    const p = docLegacy.data;
    return { kind: "doc", nodeId: p.n, docId: p.d, title: p.t, mode: p.m };
  }

  const entityLegacy = EntityLegacyV1Schema.safeParse(json);
  if (entityLegacy.success) {
    const p = entityLegacy.data;
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

  const docBareLegacy = DocBareLegacySchema.safeParse(json);
  if (docBareLegacy.success) {
    const p = docBareLegacy.data;
    return { kind: "doc", nodeId: p.n, docId: p.d };
  }

  return null;
}
