// bridges charnel's `nearby_peers_subscribe`/`nearby_peers_unsubscribe`
// tauri commands (see `client/charnel/src-tauri/src/augur_commands.rs`)
// into a plain callback-based api for the add-remote modal's "nearby
// devices" section.
//
// tauri-only (same as `charnelRadioAdapter.ts`'s channel pattern this
// mirrors) - lan discovery over mdns/dns-sd has no web-browser
// equivalent at all, so `isCharnelMode()` gates every call here.

import { isCharnelMode } from "../charnel";

export interface NearbyPeer {
  nodeId: string;
  /** the peer's self-reported display name, if it set one. */
  userData?: string | null;
}

interface NearbyPeerFoundFrame {
  kind: "found";
  node_id: string;
  user_data: string | null;
}
interface NearbyPeerLostFrame {
  kind: "lost";
  node_id: string;
}
type NearbyPeerFrame = NearbyPeerFoundFrame | NearbyPeerLostFrame;

type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

let invokeCached: InvokeFn | null = null;
async function getInvoke(): Promise<InvokeFn> {
  if (invokeCached) return invokeCached;
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const tauri = await import("@tauri-apps/api/core");
  invokeCached = tauri.invoke as InvokeFn;
  return invokeCached;
}

/**
 * starts browsing for nearby, not-yet-known freqhole devices on the
 * same lan - for as long as the returned unsubscribe function hasn't
 * been called. calling it tears down the underlying mdns/dns-sd browse
 * session on the rust side (not just the event forwarding), so this is
 * meant to be opened when the add-remote ui opens and closed the moment
 * it closes - not left running in the background.
 *
 * resolves to a no-op unsubscribe function (rather than throwing) when
 * called outside tauri mode, or if the federation endpoint isn't up yet
 * (nothing to browse from) - callers don't need their own
 * `isCharnelMode()` guard before calling this.
 */
export async function subscribeNearbyPeers(
  onFound: (peer: NearbyPeer) => void,
  onLost: (nodeId: string) => void,
): Promise<() => void> {
  if (!isCharnelMode()) {
    return () => {};
  }

  const invoke = await getInvoke();
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { Channel } = await import("@tauri-apps/api/core");

  const events = new Channel<NearbyPeerFrame>();
  events.onmessage = (msg) => {
    try {
      switch (msg.kind) {
        case "found":
          onFound({ nodeId: msg.node_id, userData: msg.user_data });
          break;
        case "lost":
          onLost(msg.node_id);
          break;
      }
    } catch (e) {
      console.warn("[nearby-peers] callback threw:", e);
    }
  };

  let sessionId: string;
  try {
    sessionId = (await invoke("nearby_peers_subscribe", { events })) as string;
  } catch (e) {
    console.warn("[nearby-peers] subscribe failed:", e);
    return () => {};
  }

  // keep a strong reference to the channel for the whole session - same
  // gotcha `charnelRadioAdapter.ts` documents: without this, gc can
  // collect the callback while rust is still sending frames, which
  // triggers tauri's "Couldn't find callback id".
  let retainedEvents: unknown = events;

  return () => {
    void retainedEvents;
    invoke("nearby_peers_unsubscribe", { sessionId }).catch((e) =>
      console.warn("[nearby-peers] unsubscribe failed:", e),
    );
    retainedEvents = null;
  };
}
