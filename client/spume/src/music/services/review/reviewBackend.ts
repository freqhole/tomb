// unifies the two independent "which backend (grimoire vs local-idb) am I
// talking to" implementations that grew up separately in
// music/hooks/useImportReview.ts (per-session album review: patch/merge/
// move/mark-reviewed) and components/modals/AddMediaModal.tsx (listing
// pending sessions + bulk "mark reviewed"). both already branched on the
// exact same condition (`isCharnelMode()` / whether a grimoire remote is
// resolved) independently - this file is the one place that resolves and
// constructs the right backend, and the one shape both consumers use.
//
// `resolveActiveReviewRemote()` is the single place that checks
// `isCharnelMode()` - previously duplicated as `resolveReviewRemote()` in
// AddMediaModal.tsx and inlined again in App.tsx's `openReviewSession`.
import { isCharnelMode } from "../../../app/services/charnel";
import { getTauriManagedRemote } from "../../../app/services/remotes/remoteManager";
import type { CurrentRemoteInfo } from "../../data/currentState";
import type { PatchAlbumReviewRequest, PendingReviewSession } from "@freqhole/api-client";
import type { ImportReviewAlbum } from "../../../components/import/ImportGroupingView";
import { createGrimoireReviewBackend } from "./grimoireReviewBackend";
import { createLocalIdbReviewBackend } from "./localIdbReviewBackend";

/** the remote a reviewed session's albums should ultimately be sent to,
 * once review completes - `null` for a purely local import. */
export interface ReviewSendTarget {
  id: string;
  name: string;
}

export interface ReviewBackend {
  kind: "grimoire" | "local-idb";
  /** the resolved remote backing this instance - `null` for "local-idb"
   *  (there's no `Remote` to speak of for a purely local session). */
  remote: CurrentRemoteInfo | null;
  listPendingSessions(): Promise<PendingReviewSession[]>;
  getSessionAlbums(sessionId: string): Promise<ImportReviewAlbum[]>;
  getSessionTarget(sessionId: string): Promise<ReviewSendTarget | null>;
  patchAlbum(
    sessionId: string,
    albumId: string,
    req: Omit<PatchAlbumReviewRequest, "album_id" | "session_id">
  ): Promise<void>;
  mergeAlbums(sessionId: string, sourceIds: string[], targetId: string): Promise<void>;
  moveSong(
    sessionId: string,
    songId: string,
    toAlbumId: string | null,
    newAlbumTitle?: string | null,
    newAlbumArtistName?: string | null
  ): Promise<void>;
  markAlbumReviewed(sessionId: string, albumId: string): Promise<void>;
  /** mark every album in `session` reviewed in one shot - used by
   *  AddMediaModal's review-tab "mark reviewed" bulk action. */
  markSessionReviewed(session: PendingReviewSession): Promise<void>;
}

/**
 * the one place that decides "which remote (if any) is this review session
 * against" - in charnel mode, path-based imports always redirect through
 * the local grimoire instance (see App.tsx's handlePathsSelected), so
 * "review" always means the tauri-managed remote regardless of whichever
 * remote is currently being browsed. outside charnel, review sessions live
 * entirely in the browser's own IndexedDB library - there's no `Remote` at
 * all, signalled with `null`.
 */
export async function resolveActiveReviewRemote(): Promise<CurrentRemoteInfo | null> {
  if (!isCharnelMode()) return null;
  const remote = await getTauriManagedRemote();
  return (remote as unknown as CurrentRemoteInfo) ?? null;
}

/**
 * synchronous factory - `remote` must already be resolved (via
 * `resolveActiveReviewRemote()`, or whatever remote a session was opened
 * against). `null` selects the local-idb backend.
 */
export function getReviewBackend(remote: CurrentRemoteInfo | null): ReviewBackend {
  if (!remote) return createLocalIdbReviewBackend();
  return createGrimoireReviewBackend(remote);
}

// re-exported so callers that already have a concrete instance in hand
// (e.g. tests) don't need to go through the `remote === null` convention.
export { createGrimoireReviewBackend, createLocalIdbReviewBackend };
