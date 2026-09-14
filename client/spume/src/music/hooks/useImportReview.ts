// hook for the import review flow.
//
// fetches pending review albums for a given session, enriches each with
// its full song list via query_songs, and exposes the mutation fns
// (patch, merge, move, mark-reviewed) that wire back to the api.
//
// works against either backend a session can live in:
//   - grimoire (desktop/android charnel's embedded local instance) - the
//     original behavior below, driven by `remote()`.
//   - the browser's own IndexedDB (plain web, no charnel) - driven by
//     music/services/storage/db/importReview.ts. selected by passing
//     `remote() === null` while `sessionId()` is set (there's no `Remote`
//     to speak of for a purely local-idb session).
//
// usage:
//   const review = useImportReview(() => sessionId(), remote);
//   review.albums()      // ImportReviewAlbum[]
//   review.loading()     // boolean
//   review.targetRemoteName() // string | undefined - "send to X" label
//   review.patchAlbum(albumId, req)
//   review.mergeAlbums(sourceIds, targetId)
//   review.moveSong(songId, toAlbumId)
//   review.markReviewed(albumId)
//   review.refetch()

import { createSignal, createResource, createMemo, createEffect } from "solid-js";
import { toast } from "../../components/feedback/Toast";
import type { CurrentRemoteInfo } from "../data/currentState";
import type { ImportReviewAlbum } from "../../components/import/ImportGroupingView";
import type { PatchAlbumReviewRequest } from "@freqhole/api-client";
import { getReviewBackend } from "../services/review/reviewBackend";

// ----------------------------------------------------------------------------
// hook
// ----------------------------------------------------------------------------

export interface ImportReviewHandle {
  albums: () => ImportReviewAlbum[];
  loading: () => boolean;
  /** remote this session's reviewed output is destined for, if any -
   *  undefined for a purely local (nowhere-else-to-send) session. */
  targetRemoteId: () => string | undefined;
  targetRemoteName: () => string | undefined;
  patchAlbum: (
    albumId: string,
    req: Omit<PatchAlbumReviewRequest, "album_id" | "session_id">
  ) => Promise<void>;
  mergeAlbums: (sourceIds: string[], targetId: string) => Promise<void>;
  moveSong: (
    songId: string,
    toAlbumId: string | null,
    newAlbumTitle?: string | null,
    newAlbumArtistName?: string | null
  ) => Promise<void>;
  markReviewed: (albumId: string) => Promise<void>;
  refetch: () => void;
}

export function useImportReview(
  sessionId: () => string | null,
  /** `null`/`undefined` while resolving; `null` once resolved means "no
   *  grimoire remote for this session" - i.e. it lives in the browser's
   *  own IndexedDB library instead. */
  remote: () => CurrentRemoteInfo | null | undefined
): ImportReviewHandle {
  // reload key: increment to trigger refetch
  const [reloadKey, setReloadKey] = createSignal(0);
  const [targetRemoteId, setTargetRemoteId] = createSignal<string | undefined>(undefined);
  const [targetRemoteName, setTargetRemoteName] = createSignal<string | undefined>(undefined);

  const key = createMemo<[string, CurrentRemoteInfo | null | undefined, number] | null>(() => {
    const id = sessionId();
    if (!id) return null;
    return [id, remote(), reloadKey()];
  });

  const [data] = createResource(key, async (k): Promise<ImportReviewAlbum[]> => {
    if (!k) return [];
    const [sid, r] = k;

    const backend = getReviewBackend(r ?? null);
    try {
      const target = await backend.getSessionTarget(sid);
      setTargetRemoteId(target?.id ?? undefined);
      setTargetRemoteName(target?.name ?? undefined);
    } catch (err) {
      // target lookup failing shouldn't block showing the albums themselves.
      toast.error(`failed to look up send target: ${(err as Error).message}`);
    }

    try {
      return await backend.getSessionAlbums(sid);
    } catch (err) {
      toast.error(`failed to reach remote: ${(err as Error).message}`);
      return [];
    }
  });

  // data.latest keeps returning the PREVIOUS session's (already-empty) album
  // list while a new session's fetch is in flight, which used to make a
  // brand-new review session look instantly "complete" (0 albums, not
  // loading) before it ever loaded - see resolvedForSid below.
  const [resolvedForSid, setResolvedForSid] = createSignal<string | null>(null);
  createEffect(() => {
    const k = key();
    if (!k) return;
    if (data.state === "ready" || data.state === "errored") {
      setResolvedForSid(k[0]);
    }
  });

  function refetch() {
    setReloadKey((n) => n + 1);
  }

  async function patchAlbum(
    albumId: string,
    req: Omit<PatchAlbumReviewRequest, "album_id" | "session_id">
  ) {
    const sid = sessionId();
    if (!sid) return;
    try {
      await getReviewBackend(remote() ?? null).patchAlbum(sid, albumId, req);
    } catch (err) {
      toast.error(`patch failed: ${(err as Error).message}`);
      return;
    }
    refetch();
  }

  async function mergeAlbums(sourceIds: string[], targetId: string) {
    const sid = sessionId();
    if (!sid) return;
    try {
      await getReviewBackend(remote() ?? null).mergeAlbums(sid, sourceIds, targetId);
    } catch (err) {
      toast.error(`merge failed: ${(err as Error).message}`);
      return;
    }
    refetch();
  }

  async function moveSong(
    songId: string,
    toAlbumId: string | null,
    newAlbumTitle: string | null = null,
    newAlbumArtistName: string | null = null
  ) {
    const sid = sessionId();
    if (!sid) return;
    try {
      await getReviewBackend(remote() ?? null).moveSong(
        sid,
        songId,
        toAlbumId,
        newAlbumTitle,
        newAlbumArtistName
      );
    } catch (err) {
      toast.error(`move failed: ${(err as Error).message}`);
      return;
    }
    refetch();
  }

  async function markReviewed(albumId: string) {
    const sid = sessionId();
    if (!sid) return;
    try {
      await getReviewBackend(remote() ?? null).markAlbumReviewed(sid, albumId);
    } catch (err) {
      toast.error(`mark reviewed failed: ${(err as Error).message}`);
      return;
    }
    refetch();
  }

  return {
    // use data.latest so albums() keeps the previous value during a source-change
    // refetch - without this, data() briefly returns undefined, currentAlbum()
    // becomes falsy, and the editor unmounts, resetting the active tab.
    albums: () => data.latest ?? data() ?? [],
    // treat "unresolved" (key just became non-null, fetch hasn't started) as
    // loading is only true on the initial fetch (no previous data).
    // during a source-change refetch, data.latest keeps the previous value
    // so we can keep showing the editor without a loading spinner. but if
    // this exact session id hasn't resolved even once yet, always report
    // loading - otherwise a new session starting from a stale, already-empty
    // data.latest (from the PREVIOUS session) reads as "done, zero albums"
    // before its own fetch has even run.
    loading: () => {
      const sid = sessionId();
      if (sid !== resolvedForSid()) return true;
      return (data.loading && !data.latest) || data.state === "unresolved";
    },
    targetRemoteId,
    targetRemoteName,
    patchAlbum,
    mergeAlbums,
    moveSong,
    markReviewed,
    refetch,
  };
}
