import { createResource } from "solid-js";
import type { PendingReviewSession, PendingVideoReviewSession } from "@freqhole/api-client";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import { getVideoReviewBackend } from "../../video/services/reviewBackend";
import {
  getReviewBackend,
  resolveReviewSourceRemotes,
} from "../../music/services/review/reviewBackend";
import { toast } from "../feedback/Toast";

type SessionOrigin = { originRemote: CurrentRemoteInfo | null };
export type MusicReviewSession = PendingReviewSession & SessionOrigin;
export type VideoReviewSession = PendingVideoReviewSession & SessionOrigin;

export function usePendingImportReviews(props: {
  isOpen: boolean;
  refetchReviewKey?: number;
  targetRemote?: CurrentRemoteInfo | null;
}) {
  // capture the destination in the resource key, including while a request is in flight.
  const key = () =>
    props.isOpen
      ? { target: props.targetRemote ?? null, reload: props.refetchReviewKey ?? 0 }
      : null;

  const [pendingSessions, { refetch: refetchPendingSessions }] = createResource(
    key,
    async ({ target }): Promise<MusicReviewSession[]> => {
      const remotes = await resolveReviewSourceRemotes(target);
      const results = await Promise.all(
        remotes.map(async (originRemote) => {
          try {
            const sessions = await getReviewBackend(originRemote).listPendingSessions();
            return sessions.map((session) => ({ ...session, originRemote }));
          } catch (error) {
            toast.error(
              `failed to load music reviews from ${originRemote?.name ?? "local library"}: ${String(error)}`
            );
            return [];
          }
        })
      );
      return results.flat();
    },
    { initialValue: [] }
  );

  const [videoPendingSessions, { refetch: refetchVideoPendingSessions }] = createResource(
    key,
    async ({ target }): Promise<VideoReviewSession[]> => {
      const remotes = await resolveReviewSourceRemotes(target);
      const results = await Promise.all(
        remotes.map(async (originRemote) => {
          try {
            const sessions = await getVideoReviewBackend(originRemote).listPendingSessions();
            return sessions.map((session) => ({ ...session, originRemote }));
          } catch (error) {
            toast.error(
              `failed to load video reviews from ${originRemote?.name ?? "local library"}: ${String(error)}`
            );
            return [];
          }
        })
      );
      return results.flat();
    },
    { initialValue: [] }
  );

  return {
    pendingSessions,
    refetchPendingSessions,
    videoPendingSessions,
    refetchVideoPendingSessions,
  };
}
