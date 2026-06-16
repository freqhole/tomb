// hook to check if an album has pending (unreviewed) import blobs.
//
// used by AlbumEditorModal to show a "pending review" badge on the info tab.
//
// usage:
//   const pending = useAlbumPending(() => albumId, () => remote);
//   pending.hasPending()   // boolean
//   pending.sessionId()    // string | null
//   pending.createdAt()    // number | null  (unix epoch seconds)
//   pending.markReviewed() // marks the album reviewed in the pending session

import { createResource, createMemo } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import { toast } from "../../components/feedback/Toast";
import type { CurrentRemoteInfo } from "../data/currentState";

export interface AlbumPendingHandle {
  hasPending: () => boolean;
  loading: () => boolean;
  sessionId: () => string | null;
  createdAt: () => number | null;
  markReviewed: () => Promise<void>;
  refetch: () => void;
}

export function useAlbumPending(
  albumId: () => string | undefined,
  remote: () => CurrentRemoteInfo | null | undefined,
): AlbumPendingHandle {
  const key = createMemo<[string, CurrentRemoteInfo] | null>(() => {
    const id = albumId();
    const r = remote();
    if (!id || !r) return null;
    return [id, r];
  });

  const [data, { refetch }] = createResource(key, async ([id, r]) => {
    const client = await getClientForRemote(r);
    const resp = await client.music.albumPending({ album_id: id });
    if (!resp.success) return null;
    return resp.data;
  });

  const hasPending = () => (data()?.pending_count ?? 0) > 0;
  const loading = () => data.loading;
  const sessionId = () => data()?.session_id ?? null;
  const createdAt = () => data()?.created_at ?? null;

  const markReviewed = async () => {
    const sid = sessionId();
    const id = albumId();
    const r = remote();
    if (!sid || !id || !r) return;
    try {
      const client = await getClientForRemote(r);
      const resp = await client.music.markAlbumReviewed({ album_id: id, session_id: sid });
      if (!resp.success) {
        toast.error("failed to mark as reviewed");
        return;
      }
      refetch();
    } catch (err) {
      toast.error(`failed to mark as reviewed: ${(err as Error).message}`);
    }
  };

  return { hasPending, loading, sessionId, createdAt, markReviewed, refetch };
}
