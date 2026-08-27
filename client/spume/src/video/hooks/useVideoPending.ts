// hook to check if a video has a pending (unreviewed) import blob.
// mirrors music/hooks/useAlbumPending.ts.
//
// usage:
//   const pending = useVideoPending(() => videoId, () => remote);
//   pending.hasPending()   // boolean
//   pending.sessionId()    // string | null
//   pending.createdAt()    // number | null  (unix epoch seconds)

import { createResource, createMemo } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { CurrentRemoteInfo } from "../../music/data/currentState";

export interface VideoPendingHandle {
  hasPending: () => boolean;
  loading: () => boolean;
  sessionId: () => string | null;
  createdAt: () => number | null;
  refetch: () => void;
}

export function useVideoPending(
  videoId: () => string | undefined,
  remote: () => CurrentRemoteInfo | null | undefined
): VideoPendingHandle {
  const key = createMemo<[string, CurrentRemoteInfo] | null>(() => {
    const id = videoId();
    const r = remote();
    if (!id || !r) return null;
    return [id, r];
  });

  const [data, { refetch }] = createResource(key, async ([id, r]) => {
    const client = await getClientForRemote(r);
    const resp = await client.video.videoPending({ video_id: id });
    if (!resp.success) return null;
    return resp.data;
  });

  const hasPending = () => (data()?.pending_count ?? 0) > 0;
  const loading = () => data.loading;
  const sessionId = () => data()?.session_id ?? null;
  const createdAt = () => data()?.created_at ?? null;

  return { hasPending, loading, sessionId, createdAt, refetch };
}
