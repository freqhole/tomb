// bulk-enrichment review session manager (phase 14.9).
//
// owns:
//   * starting a session (POST /api/music/albums/enrichment/bulk)
//   * tracking the active job_session_id so the user can cancel
//   * navigating the album cursor while the review modal is open
//   * cancelling all pending/running jobs in the session
//
// the actual modal is rendered by App.tsx via showAlbumEditor; this hook
// just feeds it a `review` prop with onNext / onPrev / onExit callbacks.

import { createSignal } from "solid-js";
import { showAlbumEditor, hideAlbumEditor } from "./modals";
import { getCurrentRemote } from "../data";
import { getClientForRemote } from "../../app/api/client";
import { toast } from "../../components/feedback/Toast";
import type { Remote } from "../../app/services/storage/schemas/remote";

interface ReviewSession {
  remote: Remote;
  remoteId: string;
  jobSessionId: string;
  ids: string[];
}

const [activeSession, setActiveSession] = createSignal<ReviewSession | null>(
  null,
);

export function useActiveReviewSession() {
  return activeSession;
}

/** kick off a bulk enrichment + open the editor at index 0 in review mode. */
export async function startBulkEnrichmentReview(
  remote: Remote,
  albumIds: string[],
): Promise<void> {
  if (albumIds.length === 0) return;
  let client;
  try {
    client = await getClientForRemote(remote);
  } catch (err) {
    toast.error(`failed to reach remote: ${(err as Error).message}`);
    return;
  }

  const resp = await client.music.enqueueBulkEnrichment({
    album_ids: albumIds,
    sources: ["Mb", "Lastfm", "Audiodb"],
    force: false,
    priority: 10,
  });
  if (!resp.success) {
    toast.error(resp.error.message || "bulk enrichment failed to enqueue");
    return;
  }
  if (!resp.data) {
    toast.error("bulk enrichment returned no session id");
    return;
  }

  const session: ReviewSession = {
    remote,
    remoteId: remote.remote_id,
    jobSessionId: resp.data.job_session_id,
    ids: [...albumIds],
  };
  setActiveSession(session);

  openAt(session, 0);
}

function openAt(session: ReviewSession, index: number): void {
  const id = session.ids[index];
  // TEMP DEBUG
  console.log("[bulkEnrichmentReview] openAt", {
    index,
    id,
    totalIds: session.ids.length,
    sessionId: session.jobSessionId,
  });
  if (!id) {
    exitReview();
    return;
  }
  showAlbumEditor({
    albumId: id,
    remote: session.remote,
    review: {
      ids: session.ids,
      currentIndex: index,
      onNext: () => openAt(session, index + 1),
      onPrev: () => openAt(session, Math.max(0, index - 1)),
      onExit: () => exitReview(),
    },
  });
}

/** close the review modal but leave the bulk session running in the
 *  background. user can re-open via the "resume review" affordance (TBD)
 *  or just wait for the strip to drain. */
export function exitReview(): void {
  hideAlbumEditor();
}

/** cancel every pending / running job in the active review session. */
export async function cancelActiveReview(): Promise<void> {
  const session = activeSession();
  if (!session) return;
  const remote = getCurrentRemote();
  if (!remote || remote.remote_id !== session.remoteId) {
    toast.error("not connected to the remote that owns this session");
    return;
  }
  try {
    const client = await getClientForRemote(remote);
    const resp = await client.music.cancelBulkEnrichment({
      job_session_id: session.jobSessionId,
    });
    if (!resp.success) {
      toast.error(resp.error.message || "cancel failed");
      return;
    }
    const cancelled = resp.data?.cancelled_job_ids?.length ?? 0;
    toast.success(
      cancelled === 0
        ? "session already drained"
        : `cancelled ${cancelled} pending job${cancelled === 1 ? "" : "s"}`,
    );
    setActiveSession(null);
  } catch (err) {
    toast.error(`cancel failed: ${(err as Error).message}`);
  }
}

/** clear the active session marker without sending a cancel (used when
 *  the strip naturally drains). */
export function clearActiveReviewSession(): void {
  setActiveSession(null);
}
