// per-destination probe for "does this remote already have these blobs?"
//
// fires `/api/blobz/has` against the destination with a list of blake3s
// and reports back which ones it already has. used by the share modal to
// badge each destination with how many songs it would actually pull.
//
// the probe is best-effort: any error (network, schema mismatch, etc.)
// resolves with `error` set and counts at zero so the ui can fall back
// to "unknown" rather than blocking the send.

import { createResource, type Accessor } from "solid-js";
import { schema } from "freqhole-api-client";
import { getTransportForRemote } from "../../../app/api/client";
import { getSongBySha256 } from "../../services/storage/db/songs";
import { debug } from "../../../utils/logger";
import type { Remote } from "../../../app/services/storage/schemas/remote";

const { HasBlobsResponseSchema } = schema;

/**
 * a single song's hashes. blake3 is the canonical key the probe reports
 * back; sha256 is needed for the indexedDB-backed local probe (the local
 * `songs` store has a unique `by_sha256` index but no blake3 index).
 */
export interface ProbeSongHashes {
  blake3: string;
  sha256: string;
}

export interface BlobPresence {
  /** still waiting on the request. */
  checking: boolean;
  /** total blake3s queried. */
  totalChecked: number;
  /** number already present on the destination. */
  presentCount: number;
  /** the blake3s that are already there (subset of the input). */
  presentSet: Set<string>;
  /** populated when the probe failed. counts will be zero. */
  error?: string;
}

const EMPTY: BlobPresence = {
  checking: false,
  totalChecked: 0,
  presentCount: 0,
  presentSet: new Set<string>(),
};

/**
 * reactive `BlobPresence` for `(remote, blake3s)`. re-runs whenever the
 * accessor inputs change. callers that don't have a destination yet can
 * pass `() => null` for `remote` and the probe stays idle.
 */
export function createBlobPresenceProbe(
  remote: Accessor<Remote | null | undefined>,
  blake3s: Accessor<string[] | null | undefined>,
): Accessor<BlobPresence> {
  const [resource] = createResource(
    () => {
      const r = remote();
      const b = blake3s();
      if (!r || !b || b.length === 0) return null;
      return { remote: r, blake3s: b };
    },
    async ({ remote, blake3s }): Promise<BlobPresence> => {
      try {
        const transport = await getTransportForRemote(remote);
        const resp = await transport.request(
          "POST",
          "/api/blobz/has",
          JSON.stringify({ blake3s }),
        );
        if (resp.status >= 200 && resp.status < 300) {
          let json: unknown;
          try {
            json = JSON.parse(resp.body);
          } catch (e) {
            return {
              ...EMPTY,
              totalChecked: blake3s.length,
              error: `parse: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
          // unwrap GrimoireResponse envelope: { success, message, data, errors }
          const envelope = json as { success?: boolean; data?: unknown; errors?: unknown[] };
          if (envelope?.success === false) {
            return {
              ...EMPTY,
              totalChecked: blake3s.length,
              error: `server: ${(envelope.errors as Array<{ detail?: string }> | undefined)?.[0]?.detail ?? "failure"}`,
            };
          }
          const inner = envelope?.data ?? json;
          const parsed = HasBlobsResponseSchema.safeParse(inner);
          if (parsed.success) {
            const set = new Set(parsed.data.blake3s_present);
            return {
              checking: false,
              totalChecked: blake3s.length,
              presentCount: set.size,
              presentSet: set,
            };
          }
          debug(
            "destinationProbe",
            `schema mismatch on has_blobs response: ${parsed.error.message}`,
          );
          return {
            ...EMPTY,
            totalChecked: blake3s.length,
            error: "invalid response shape",
          };
        }
        return {
          ...EMPTY,
          totalChecked: blake3s.length,
          error: `http ${resp.status}`,
        };
      } catch (e) {
        debug(
          "destinationProbe",
          `has_blobs threw for ${remote.remote_id}:`,
          e,
        );
        return {
          ...EMPTY,
          totalChecked: blake3s.length,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  return () => {
    const r = resource();
    if (r) return r;
    const b = blake3s();
    if (!b || b.length === 0) return EMPTY;
    return { ...EMPTY, checking: true, totalChecked: b.length };
  };
}

/**
 * reactive `BlobPresence` for the browser-local library (idb + opfs).
 * looks each input up by sha256 (the only indexed lookup we have on the
 * songs store) and reports the matching blake3 set. matches the same
 * shape as `createBlobPresenceProbe` so the ui can reuse a single badge.
 */
export function createLocalBlobPresenceProbe(
  songs: Accessor<ProbeSongHashes[] | null | undefined>,
): Accessor<BlobPresence> {
  const [resource] = createResource(
    () => {
      const s = songs();
      if (!s || s.length === 0) return null;
      return s;
    },
    async (input): Promise<BlobPresence> => {
      try {
        const present = new Set<string>();
        // small libraries — sequential lookups are fine. each hits a
        // single indexed get on `by_sha256`.
        await Promise.all(
          input.map(async (h) => {
            const row = await getSongBySha256(h.sha256);
            if (row) present.add(h.blake3);
          }),
        );
        return {
          checking: false,
          totalChecked: input.length,
          presentCount: present.size,
          presentSet: present,
        };
      } catch (e) {
        debug("destinationProbe", `local idb probe threw:`, e);
        return {
          ...EMPTY,
          totalChecked: input.length,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  return () => {
    const r = resource();
    if (r) return r;
    const s = songs();
    if (!s || s.length === 0) return EMPTY;
    return { ...EMPTY, checking: true, totalChecked: s.length };
  };
}
