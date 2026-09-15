// wires up cenotaph's inbound accept-loop + local library hooks once the
// midden node is ready.
//
// pulled out of client.ts's getMiddenNode() (which used to call these two
// inline) because both acceptModeBootstrap.ts and localLibraryHooks.ts
// need to call back into client.ts (getClientForRemote et al) - having
// client.ts import them directly closed a static import cycle. this
// module sits on the other side of that edge: it imports client.ts (for
// getMiddenNode/onMiddenReady) and the two remotePlayback modules, but
// nothing imports THIS module except App.tsx, so no cycle.
//
// call once from App.tsx's boot sequence (mirrors initRodioPreference()).

import { getMiddenNode, onMiddenReady } from "../../api/client";
import { initRemotePlaybackAcceptMode } from "./acceptModeBootstrap";
import { initLocalLibraryHooks } from "./localLibraryHooks";

let registered = false;

export function initRemotePlaybackBootstrap(): void {
  if (registered) return;
  registered = true;

  onMiddenReady(() => {
    void getMiddenNode().then((node) => {
      initRemotePlaybackAcceptMode(node);
      initLocalLibraryHooks();
    });
  });
}
