// resolves the "source" remote for a share/send-to-remote action, with a
// fallback to this device's own local library when there's no active
// remote (browsing "local") - so sharing a local song/album/video/playlist
// never requires "currently connected to some remote" to be true.
//
// without this fallback, every share action on local content hit either
// contextMenu.ts's "share is only available on a remote" toast or
// ShareModal's "source remote unavailable" message, even though
// sendToRemote()/sendVideosToRemote() have supported a local browser
// source since getLocalBrowserSourceRemote() was added for the local-
// review send flow (sendReviewedLocalSessionToRemote.ts) - it just wasn't
// wired into the regular share modal/context-menu paths.

import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { getCurrentRemote } from "../../../music/data/currentState";
import { getLocalBrowserSourceRemote } from "../../../music/services/send/localBrowserSource";
import { isCharnelMode } from "../charnel";
import { getRemoteById, getTauriManagedRemote } from "./remoteManager";
import type { Remote } from "../storage/schemas/remote";

/** the local library as a share source: the charnel-managed remote row in
 *  tauri builds, or a synthetic browser-node `Remote` (see
 *  localBrowserSource.ts) in plain-web builds. null only when genuinely
 *  unresolvable (e.g. this browser's p2p identity isn't up yet). */
async function resolveLocalLibrarySource(): Promise<Remote | null> {
  if (isCharnelMode()) return getTauriManagedRemote();
  try {
    return await getLocalBrowserSourceRemote();
  } catch {
    return null;
  }
}

/** one-shot resolution for context-menu-style click handlers: an explicit
 *  `remoteId` wins, then the globally-active remote, then the local
 *  library fallback above. */
export async function resolveShareSourceRemote(remoteId?: string): Promise<Remote | null> {
  if (remoteId && remoteId !== "local") {
    const remote = await getRemoteById(remoteId);
    if (remote) return remote;
  }
  const info = getCurrentRemote();
  if (info) {
    const remote = await getRemoteById(info.remote_id);
    if (remote) return remote;
  }
  return resolveLocalLibrarySource();
}

/** reactive counterpart for toolbar `<ShareButton source={...}>` props -
 *  re-resolves whenever the globally-active remote changes. mirrors
 *  `createCurrentRemoteFull()`'s shape exactly, but never settles on
 *  `null` just because there's no active remote - falls back to the
 *  local library instead. (`createCurrentRemoteFull()` itself is left
 *  alone: other callers rely on it returning null for "no active remote"
 *  to gate remote-only UI.) */
export function createShareSourceRemote(): Accessor<Remote | null> {
  const [source, setSource] = createSignal<Remote | null>(null);

  createEffect(() => {
    const info = getCurrentRemote();
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void (async () => {
      if (info) {
        const remote = await getRemoteById(info.remote_id);
        if (!cancelled) setSource(remote ?? null);
        return;
      }
      const local = await resolveLocalLibrarySource();
      if (!cancelled) setSource(local);
    })();
  });

  return source;
}
