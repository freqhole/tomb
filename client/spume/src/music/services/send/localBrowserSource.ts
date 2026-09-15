// synthetic "source" Remote representing this browser's own midden node -
// used as sendToRemote()'s `source` param when sending a purely local
// (never-uploaded, imported straight into IndexedDB) song to an external
// remote after review. mirrors cenotaph/adapters/
// mediaRefResolve.ts's ephemeralPeerRemote() pattern for the same reason:
// a one-off identity reference shouldn't leave a permanent, user-visible
// row in the remotes table just because a send happened.
import { getLocalNodeIdAsync } from "../../../app/api/client";
import type { P2PRemote } from "../../../app/services/storage/schemas/remote";

const LOCAL_BROWSER_SOURCE_REMOTE_ID = "__local_browser_source__";

/** resolves to a `Remote` carrying this browser's own midden node id, so
 * `sendToRemote()` can tell the destination who to pull the audio from.
 * throws if this browser's p2p identity isn't up yet (extremely unlikely
 * in practice - the midden node is created at app startup for every
 * non-charnel build, and again on-demand the first time a file is
 * imported - see fileProcessor.ts's registerBlake3). */
export async function getLocalBrowserSourceRemote(): Promise<P2PRemote> {
  const nodeId = await getLocalNodeIdAsync();
  if (!nodeId) {
    throw new Error("this browser's p2p identity isn't ready yet");
  }
  const now = Date.now();
  return {
    remote_id: LOCAL_BROWSER_SOURCE_REMOTE_ID,
    name: "this browser",
    is_active: false,
    last_connected_at: null,
    created_at: now,
    updated_at: now,
    description: null,
    image_url: null,
    image_blob_id: null,
    version: null,
    last_info_check: null,
    transport: "wasm",
    peer_addr: nodeId,
  };
}
