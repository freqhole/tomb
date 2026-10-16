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
// only applies to blob-backed share kinds whose content-hash(es) resolve to
// a usable entity id *on the destination remote* (song, album, video,
// video_series) - artist and radio_station have no blake3 list to probe at
// all, so they keep the simpler single-source behavior (just the
// eligibility check on `source` itself, no multi-remote candidate list).
// playlist DOES have a blake3 list (its member songs'/videos') but is
// deliberately excluded too: a playlist isn't content-addressed itself,
// so matching some of its member hashes on another remote says nothing
// about whether that remote has "the same playlist" - there's no id to
// resolve to, just a coincidence of overlapping content. playlist keeps
// single-source behavior for that reason, not because `buildPayload` is
// missing (it still has one, for `SendToRemoteSection`'s sake).
//
// album/video_series resolve via any one matched member song/video's
// `album_id`/`video_series_id` (see `BlobEntityMatch` on the server) - not
// perfectly precise if a song/video genuinely belongs to more than one
// container, but that's rare enough to treat "first match" as good enough,
// same tradeoff the server side already makes.

import { createMemo, createResource, mapArray, type Accessor } from "solid-js";
import { createCandidateDestinations } from "../../music/services/send/destinationCandidates";
import { createBlobPresenceProbe } from "../../music/services/send/destinationProbe";
import type { SendToRemotePayload } from "./SendToRemoteSection";
import type { ShareTargetKind } from "./types";
import { isAndroidTauri, isIosTauri, isCharnelMode } from "../../app/services/charnel";
import { isLocalBrowserSourceRemote } from "../../music/services/send/localBrowserSource";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { BlobEntityMatch } from "@freqhole/api-client";

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

/** picks this remote's own id for the shared entity out of its resolved
 *  blake3 matches, for whichever field `kind` cares about. returns
 *  undefined when unresolvable (no match found, or `kind` isn't one of
 *  the four content-addressed kinds - see module doc comment for why
 *  playlist is deliberately excluded here). */
function resolveEntityIdForKind(
  kind: ShareTargetKind,
  entities: BlobEntityMatch[]
): { id: string; parentId?: string } | undefined {
  switch (kind) {
    case "song": {
      const match = entities.find((e) => e.song_id);
      return match?.song_id
        ? { id: match.song_id, parentId: match.album_id ?? undefined }
        : undefined;
    }
    case "album": {
      const match = entities.find((e) => e.album_id);
      return match?.album_id ? { id: match.album_id } : undefined;
    }
    case "video": {
      const match = entities.find((e) => e.video_id);
      return match?.video_id ? { id: match.video_id } : undefined;
    }
    case "video_series": {
      const match = entities.find((e) => e.video_series_id);
      return match?.video_series_id ? { id: match.video_series_id } : undefined;
    }
    default:
      return undefined;
  }
}

export interface PermalinkCandidate {
  remote: Remote;
  label: string;
  isSource: boolean;
  /** undefined for the source entry (trivially has everything - see
   *  module doc comment) and for legacy (no buildPayload, or playlist)
   *  mode. */
  presence?: { present: number; total: number };
  /** this remote's own id (and, for songs, parent album id) for the
   *  shared entity - undefined for the source entry (`target.id` is
   *  already valid there). always present for non-source entries; see
   *  `buildSharePayload.ts` for how it overrides `target` before encoding. */
  resolvedTarget?: { id: string; parentId?: string };
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
  /** drives two things: (1) whether legacy single-source mode applies
   *  (artist/radio_station always; playlist too, regardless of
   *  `buildPayload` - see module doc comment), and (2) which field of a
   *  non-source candidate's resolved blake3 matches becomes its entity id. */
  targetKind: ShareTargetKind;
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
  // legacy mode: no payload to probe with (artist/radio_station), or a
  // playlist (has a payload, but see module doc comment for why its
  // content hashes still can't resolve to "this remote's playlist id") -
  // either way, no "other remotes", just whether the source itself is
  // eligible, matching the pre-existing (pre-multi-remote) behavior.
  if (!opts.buildPayload || opts.targetKind === "playlist") {
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
      const resolvedTarget = resolveEntityIdForKind(opts.targetKind, p.entities);
      // no resolvable id on this remote (e.g. the matched blobs turned out
      // to belong to a since-deleted song/video row) - nothing valid to
      // link to there, so don't offer it.
      if (!resolvedTarget) continue;
      out.push({
        remote: candidate.remote,
        label: candidate.remote.name ?? candidate.remote.remote_id,
        isSource: false,
        presence: { present: p.presentCount, total },
        resolvedTarget,
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
