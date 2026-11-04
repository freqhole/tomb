import type {
  PendingVideoReviewSession,
  PatchVideoGroupReviewRequest,
  MoveVideoReviewRequest,
} from "@freqhole/api-client";
import { getClientForRemote } from "../../app/api/client";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import {
  listLocalPendingVideoReviews,
  getLocalVideoImportSession,
  patchLocalVideoReviewGroup,
  moveLocalReviewVideo,
  markLocalVideoGroupReviewed,
} from "./storage/db/importReview";

export interface VideoReviewBackend {
  listPendingSessions: (sessionId?: string) => Promise<PendingVideoReviewSession[]>;
  getSessionTarget: (sessionId: string) => Promise<{ id: string; name: string } | null>;
  patchGroup: (request: PatchVideoGroupReviewRequest) => Promise<void>;
  moveVideo: (request: MoveVideoReviewRequest) => Promise<void>;
  markReviewed: (sessionId: string, groupKey: string) => Promise<void>;
}

export function getVideoReviewBackend(
  remote: CurrentRemoteInfo | null | undefined
): VideoReviewBackend {
  if (remote === undefined) throw new Error("review library is still loading");
  if (remote === null)
    return {
      listPendingSessions: listLocalPendingVideoReviews,
      async getSessionTarget(id) {
        const session = await getLocalVideoImportSession(id);
        return session.target_remote_id && session.target_remote_name
          ? { id: session.target_remote_id, name: session.target_remote_name }
          : null;
      },
      patchGroup: patchLocalVideoReviewGroup,
      moveVideo: moveLocalReviewVideo,
      markReviewed: markLocalVideoGroupReviewed,
    };
  return {
    async listPendingSessions(sessionId) {
      const client = await getClientForRemote(remote);
      const response = await client.video.listPendingVideoImportReview({
        session_id: sessionId ?? null,
      });
      if (!response.success)
        throw new Error(response.error?.issues?.[0]?.message ?? "video review lookup failed");
      return response.data ?? [];
    },
    async getSessionTarget(sessionId) {
      const client = await getClientForRemote(remote);
      const response = await client.music.getImportSessionTarget({ session_id: sessionId });
      if (!response.success)
        throw new Error(response.error?.issues?.[0]?.message ?? "review target lookup failed");
      return response.data.target_remote_id && response.data.target_remote_name
        ? { id: response.data.target_remote_id, name: response.data.target_remote_name }
        : null;
    },
    async patchGroup(request) {
      const response = await (
        await getClientForRemote(remote)
      ).video.patchVideoGroupReview(request);
      if (!response.success)
        throw new Error(response.error?.issues?.[0]?.message ?? "video review patch failed");
    },
    async moveVideo(request) {
      const response = await (await getClientForRemote(remote)).video.moveVideoReview(request);
      if (!response.success)
        throw new Error(response.error?.issues?.[0]?.message ?? "video review move failed");
    },
    async markReviewed(sessionId, groupKey) {
      const response = await (
        await getClientForRemote(remote)
      ).video.markVideoGroupReviewed({
        session_id: sessionId,
        group_key: groupKey,
      });
      if (!response.success)
        throw new Error(response.error?.issues?.[0]?.message ?? "video review completion failed");
    },
  };
}
