// favorite (broadcasting peer) helpers extracted out of radioService.ts.
//
// the radio doesn't expose per-listener state, but if the broadcasting
// peer is a registered remote with an authenticated session we can call
// the remote's `music.setFavorite` / `music.querySongs` endpoints
// directly. when no remote is registered for the peer, both calls are
// no-ops and the heart stays disabled.
//
// owns the `currentFavorite` signal itself (rather than taking a setter
// callback) so radioService.ts can import both the signal and these
// functions from one place without a circular import back to it.

import { createSignal } from "solid-js";
import { getRemoteByPeerAddr } from "../remotes/remoteManager";
import { getClientForRemote } from "../../api/client";

export const [currentFavorite, setCurrentFavorite] = createSignal<boolean | null>(null);

/** best-effort: read `is_favorite` for the given song from the
 * broadcasting peer's API and update `currentFavorite`. silently leaves
 * the signal as `null` when no remote is registered or the call fails
 * (e.g. unauthenticated session). */
export async function fetchRadioFavorite(songId: string, peerAddr: string): Promise<void> {
  try {
    const remote = await getRemoteByPeerAddr(peerAddr);
    if (!remote) return;
    const client = await getClientForRemote(remote);
    const result = await client.music.querySongs({
      q: null,
      search_fields: null,
      filters: { song_ids: [songId] },
      sort_by: null,
      sort_direction: null,
      limit: 1,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });
    if (!result.success || result.data.items.length === 0) return;
    const fav = result.data.items[0].is_favorite;
    if (typeof fav === "boolean") setCurrentFavorite(fav);
  } catch (e) {
    console.warn("[radio] fetch favorite failed:", e);
  }
}

/** toggle the favorite for the currently-playing radio track on the
 * broadcasting peer (given explicitly, since only the caller knows which
 * peer is currently tuned in). optimistically updates `currentFavorite`
 * and rolls back on failure. throws if no peer/remote is available. */
export async function setRadioFavoriteForPeer(
  songId: string,
  isFavorite: boolean,
  peerAddr: string | null
): Promise<void> {
  if (!peerAddr) throw new Error("no active radio session");
  const remote = await getRemoteByPeerAddr(peerAddr);
  if (!remote) {
    throw new Error("broadcasting peer is not a registered remote — cannot favorite");
  }
  const previous = currentFavorite();
  setCurrentFavorite(isFavorite);
  try {
    const client = await getClientForRemote(remote);
    const result = await client.entities.setFavorite({
      user_id: null,
      target_type: "song",
      target_id: songId,
      is_favorite: isFavorite,
    });
    if (!result.success) {
      throw new Error("error" in result ? JSON.stringify(result.error) : "set favorite failed");
    }
    if (!result.data?.success) {
      throw new Error(result.data?.message || "set favorite failed");
    }
  } catch (e) {
    setCurrentFavorite(previous);
    throw e;
  }
}
