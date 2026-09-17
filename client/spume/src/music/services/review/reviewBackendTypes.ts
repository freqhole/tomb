// ReviewBackend/ReviewSendTarget interfaces - split out of reviewBackend.ts
// so its two implementations (grimoireReviewBackend.ts/
// localIdbReviewBackend.ts) can import the interface they implement
// without importing back from reviewBackend.ts itself (which imports
// them, to re-export + use in getReviewBackend()'s factory). that back-
// edge used to be `import type` (erased at runtime either way), but this
// removes even the appearance of a cycle for tooling like madge.
import type { CurrentRemoteInfo } from "../../data/currentState";
import type { PatchAlbumReviewRequest, PendingReviewSession } from "@freqhole/api-client";
import type { ImportReviewAlbum } from "./importReviewTypes";

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
