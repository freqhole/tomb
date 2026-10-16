// resolves which remote(s) a share-modal permalink is allowed to point
// at - a `Remote`'s own node id isn't always safe to embed:
//
//   - the local charnel-managed library's embedded iroh endpoint only
//     stays reliably reachable for an inbound connection on desktop
//     (mac/linux/windows). android (backgrounded often), ios (same), and
//     a plain browser tab (not long-lived - see `isLocalBrowserSourceRemote`)
//     can't honor a permalink pointing at their own local library at all.
//   - a genuinely separate remote (http or p2p) has no such platform
//     dependency - its reachability is about ITS OWN network status, not
//     whichever client happens to be generating the link.
//
// when the share's source is itself permalink-ineligible (e.g. you're on
// ios sharing something from your own local library), this falls back to
// checking every other remote you can currently reach (same "ready" set
// `SendToRemoteSection`'s candidate list uses - an unreachable remote
// can't be probed for content anyway) for whether it already has the
// content, via the existing blake3 presence probe
// (`createBlobPresenceProbe`). any remote with ANY of the blake3s present
// qualifies - a partial match is still a useful, resolvable share target
// (the recipient's own resolver handles missing tracks same as it
// already does for incomplete syncs elsewhere).
//
// only applies to blob-backed share kinds (song/album/playlist/video) -
// artist and radio_station shares have no blake3 list to probe, so they
// keep the simpler single-source behavior (just the eligibility check on
// `source` itself, no multi-remote candidate list) - this is driven
// entirely by whether `buildPayload` was provided (ShareModal already
// gates SendToRemoteSection the same way).

import { createMemo, createResource, mapArray, type Accessor } from "solid-js";
import { createCandidateDestinations } from "../../music/services/send/destinationCandidates";
import { createBlobPresenceProbe } from "../../music/services/send/destinationProbe";
import type { SendToRemotePayload } from "./SendToRemoteSection";
import { isAndroidTauri, isIosTauri, isCharnelMode } from "../../app/services/charnel";
import { isLocalBrowserSourceRemote } from "../../music/services/send/localBrowserSource";
import type { Remote } from "../../app/services/storage/schemas/remote";

/** true only for desktop charnel - the one platform whose local-library
 *  iroh endpoint stays reliably reachable for an inbound connection. kept
 *  in sync with `ShareModal.tsx`'s own copy (not shared - this is a tiny,
 *  self-contained check, not worth a third module just to dedupe it). */
function canPermalinkLocalLibrary(): boolean {
  return isCharnelMode() && !isAndroidTauri() && !isIosTauri();
}

/** true when `remote`'s own node id is safe to embed in a permalink. */
function isPermalinkEligibleRemote(remote: Remote): boolean {
  if (isLocalBrowserSourceRemote(remote)) return false;
  if (remote.is_charnel_managed) return canPermalinkLocalLibrary();
  return true;
}

export interface PermalinkCandidate {
  remote: Remote;
  label: string;
  isSource: boolean;
  /** undefined for the source entry (trivially has everything - see
   *  module doc comment) and for legacy (no buildPayload) mode. */
  presence?: { present: number; total: number };
}

/** flattens any `SendToRemotePayload` kind down to its blake3 list, for
 *  probing presence on a candidate remote. mirrors
 *  `SendToRemoteSection.tsx`'s own `probeBlake3s` memo - duplicated
 *  rather than shared, since reaching into that 800-line component's
 *  internals isn't worth it for five lines of pure derivation. */
function extractPayloadBlake3s(payload: SendToRemotePayload): string[] {
  if (payload.kind === "video") {
    return payload.videos.map((v) => v.blake3).filter((b): b is string => !!b);
  }
  const songs = payload.kind === "song" ? [payload.song] : payload.songs;
  return songs.map((s) => s.blake3).filter((b): b is string => !!b);
}

export interface CreatePermalinkCandidatesOptions {
  source: Accessor<Remote>;
  /** omit entirely for share targets with nothing to probe (artist,
   *  radio_station) - falls back to source-only eligibility. */
  buildPayload?: () => SendToRemotePayload | Promise<SendToRemotePayload>;
}

export interface PermalinkCandidatesResult {
  candidates: Accessor<PermalinkCandidate[]>;
  /** true while the payload and/or presence probes are still in flight -
   *  candidates() may still grow once this settles. */
  loading: Accessor<boolean>;
}

export function createPermalinkCandidates(
  opts: CreatePermalinkCandidatesOptions
): PermalinkCandidatesResult {
  // legacy mode: no payload to probe with, so no "other remotes" - just
  // whether the source itself is eligible, exactly matching the
  // pre-existing (pre-multi-remote) behavior for artist/radio_station.
  if (!opts.buildPayload) {
    const candidates = createMemo<PermalinkCandidate[]>(() => {
      const source = opts.source();
      if (!isPermalinkEligibleRemote(source)) return [];
      return [{ remote: source, label: source.name ?? source.remote_id, isSource: true }];
    });
    return { candidates, loading: () => false };
  }

  const buildPayload = opts.buildPayload;
  const [payload] = createResource(async () => buildPayload());

  const blake3s = createMemo<string[]>(() => {
    const p = payload();
    return p ? extractPayloadBlake3s(p) : [];
  });

  const otherCandidates = createCandidateDestinations({
    sourceRemoteId: () => opts.source().remote_id,
  });

  // one presence probe per "ready" other-remote candidate - a destination
  // that isn't reachable/authenticated can't be meaningfully probed
  // anyway (it would just time out), so there's no point offering it as
  // a permalink target either.
  //
  // mapArray (not a plain .map() inside a memo) matters here: it creates
  // one persistent nested reactive scope per candidate, the same way
  // <For> does for DOM output - each candidate's createBlobPresenceProbe
  // (itself a createResource) is set up exactly once and reused as the
  // list changes, instead of being torn down and recreated (losing all
  // probe state) on every recompute the way a bare .map() inside a memo
  // would.
  const readyOthers = createMemo(() => otherCandidates().filter((c) => c.status.kind === "ready"));

  const probesList = mapArray(readyOthers, (c) => ({
    candidate: c,
    presence: createBlobPresenceProbe(
      () => c.remote,
      () => blake3s()
    ),
  }));

  const candidates = createMemo<PermalinkCandidate[]>(() => {
    const out: PermalinkCandidate[] = [];
    const source = opts.source();
    const total = blake3s().length;

    if (isPermalinkEligibleRemote(source)) {
      out.push({ remote: source, label: source.name ?? source.remote_id, isSource: true });
    }

    for (const { candidate, presence } of probesList()) {
      if (!isPermalinkEligibleRemote(candidate.remote)) continue;
      const p = presence();
      if (p.checking || p.presentCount === 0) continue;
      out.push({
        remote: candidate.remote,
        label: candidate.remote.name ?? candidate.remote.remote_id,
        isSource: false,
        presence: { present: p.presentCount, total },
      });
    }

    // source first (it's the "default"/expected choice), then others by
    // how much of the content they actually have.
    out.sort((a, b) => {
      if (a.isSource !== b.isSource) return a.isSource ? -1 : 1;
      return (b.presence?.present ?? 0) - (a.presence?.present ?? 0);
    });
    return out;
  });

  const loading = createMemo(() => {
    if (payload.loading) return true;
    return probesList().some(({ presence }) => presence().checking);
  });

  return { candidates, loading };
}
