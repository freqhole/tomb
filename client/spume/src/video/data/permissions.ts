// video-domain permission helpers — mirrors music/data/permissions.ts's
// admin/local-mode gating shape, kept as its own small file since video
// has no generated per-action permission functions yet (update_videos is
// gated `role: admin` server-side, see client-codegen routes.ts).
import { getCurrentRemote } from "../../music/data/currentState";
import { isAdmin } from "../../music/data/permissions";

/** can the user edit video metadata? local mode and charnel-managed
 * (tauri-local) servers permit all local operations; otherwise requires
 * admin, matching the `update_videos` route's `role: admin` auth. */
export function canUpdateVideo(): boolean {
  const remote = getCurrentRemote();
  if (!remote) return true;
  if (remote.is_charnel_managed) return true;
  return isAdmin();
}

/** can the user delete a video/series? same gate as `canUpdateVideo` -
 * `delete_video`/`delete_video_series` are also `role: admin` server-side. */
export function canDeleteVideo(): boolean {
  return canUpdateVideo();
}

/** alias of `canDeleteVideo` - kept separate (mirrors
 * music/data/permissions.ts's canDeleteAlbum/canDeleteArtist split) in
 * case series delete ever needs its own gate. */
export function canDeleteVideoSeries(): boolean {
  return canUpdateVideo();
}
