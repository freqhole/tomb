// wires up cenotaph's inbound accept-loop once the midden node is ready.
//
// pulled out of client.ts's getMiddenNode() (which used to call this
// inline) because acceptModeBootstrap.ts needs to call back into
// client.ts (getClientForRemote et al) - having client.ts import it
// directly closed a static import cycle. this module sits on the other
// side of that edge: it imports client.ts (for getMiddenNode/onMiddenReady)
// and the remotePlayback module, but nothing imports THIS module except
// App.tsx, so no cycle.
//
// call once from App.tsx's boot sequence (mirrors initRodioPreference()).

import { getMiddenNode, onMiddenReady } from "../../app/api/client";
import { initRemotePlaybackAcceptMode } from "./acceptModeBootstrap";
import { initCharnelPlaybackAcceptMode } from "./charnelAcceptBridge";
import { isCharnelMode } from "../../app/services/charnel/mode";
import type { MiddenNodeLike } from "@freqhole/api-client";

let registered = false;

export function initRemotePlaybackBootstrap(): void {
  if (registered) return;
  registered = true;

  // charnel has no midden/wasm node at all - its accept loop is native
  // (grimoire::cenotaph, registered on charnel's own p2p endpoint) and
  // just needs its tauri-event bridge started, not onMiddenReady.
  if (isCharnelMode()) {
    void initCharnelPlaybackAcceptMode();
    return;
  }

  onMiddenReady(() => {
    void getMiddenNode().then((node: MiddenNodeLike) => {
      initRemotePlaybackAcceptMode(node);
    });
  });
}
