// bridges charnel's `nearby_peers_subscribe`/`nearby_peers_unsubscribe`
// tauri commands (see `client/charnel/src-tauri/src/augur_commands.rs`)
// into a plain callback-based api for the add-remote modal's "nearby
// devices" section.
//
// tauri-only (same as `charnelRadioAdapter.ts`'s channel pattern this
// mirrors) - lan discovery over mdns/dns-sd has no web-browser
// equivalent at all, so `isCharnelMode()` gates every call here.
//
// mdns itself only ever carries a node id (plus whatever free-form
// `user_data` string the peer chose to publish - nothing does yet, see
// `haruspex::augur`'s own doc comment) - it has no concept of "server
// name" or "server image". getting those for display here means asking
// the peer directly, over the same p2p transport used everywhere else:
// `client.app.serverInfo()` (name) and `client.transport.fetchHelloImage()`
// (image, same public/no-auth call `LinkDeviceView.tsx` already uses for
// this exact purpose) - both already p2p-capable with just a node id, no
// persisted remote/pending-remote row needed first.

import { getClientForRemote } from "../../api/client";
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
    // TEMP DIAGNOSTIC (2026-10-17): tracking down ios finding zero nearby
    // peerz - logging every frame reaching the webview, since the rust
    // side's own log file lives inside ios' sandboxed container and isn't
    // reachable without developer mode. remove once resolved.
    console.log("[nearby-peers] TEMP DIAG: frame received", msg);
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
    console.log("[nearby-peers] TEMP DIAG: subscribed, session =", sessionId);
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
    console.log("[nearby-peers] TEMP DIAG: unsubscribing, session =", sessionId);
    invoke("nearby_peers_unsubscribe", { sessionId }).catch((e) =>
      console.warn("[nearby-peers] unsubscribe failed:", e),
    );
    retainedEvents = null;
  };
}

export interface NearbyPeerDetails {
  name: string | null;
  /** an object URL for the peer's hello image, if it has one. caller
   *  owns revoking it (via `releaseNearbyPeerDetails`/`clearNearbyPeerDetails`
   *  below) - this module doesn't do so on its own. */
  imageUrl: string | null;
}

const detailsCache = new Map<string, Promise<NearbyPeerDetails>>();
const objectUrls = new Map<string, string>();

/**
 * asks a nearby peer (by node id alone - no saved/pending remote row
 * needed) for its display name + hello image, for the "nearby peerz"
 * list to show something more useful than a bare node id. cached per
 * node id for the lifetime of the browse session (callers re-render
 * the same list repeatedly; this avoids re-probing on every render) -
 * call `clearNearbyPeerDetails()` when the add-remote modal closes to
 * release both the cache and any object URLs it created.
 *
 * best-effort: a peer that's offline, slow, or doesn't implement the
 * public hello route resolves to `{ name: null, imageUrl: null }`
 * rather than throwing - the caller already has the raw node id as a
 * fallback display value.
 */
export async function peekNearbyPeerDetails(nodeId: string): Promise<NearbyPeerDetails> {
  const cached = detailsCache.get(nodeId);
  if (cached) return cached;

  const promise = (async (): Promise<NearbyPeerDetails> => {
    let client: Awaited<ReturnType<typeof getClientForRemote>>;
    try {
      client = await getClientForRemote({
        transport: isCharnelMode() ? "app" : "wasm",
        peer_addr: nodeId,
      });
    } catch (e) {
      console.warn("[nearby-peers] failed to build client for", nodeId.slice(0, 8), e);
      return { name: null, imageUrl: null };
    }

    let name: string | null = null;
    try {
      const info = await client.app.serverInfo();
      if (info.success && info.data) name = info.data.name;
    } catch (e) {
      console.warn("[nearby-peers] serverInfo failed for", nodeId.slice(0, 8), e);
    }

    let imageUrl: string | null = null;
    try {
      const blobData = client.transport.fetchHelloImage
        ? await client.transport.fetchHelloImage()
        : null;
      if (blobData && blobData.data.length > 0) {
        const blob = new Blob([new Uint8Array(blobData.data)], { type: blobData.contentType });
        imageUrl = URL.createObjectURL(blob);
        objectUrls.set(nodeId, imageUrl);
      }
    } catch (e) {
      console.warn("[nearby-peers] fetchHelloImage failed for", nodeId.slice(0, 8), e);
    }

    return { name, imageUrl };
  })();

  detailsCache.set(nodeId, promise);
  return promise;
}

/** releases one peer's cached details (and object URL, if any) - call
 *  when a peer is reported lost, so a long browse session doesn't
 *  accumulate stale blob URLs for devices that are no longer around. */
export function releaseNearbyPeerDetails(nodeId: string): void {
  const url = objectUrls.get(nodeId);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(nodeId);
  }
  detailsCache.delete(nodeId);
}

/** releases every cached peer detail + object URL - call when the
 *  add-remote modal closes. */
export function clearNearbyPeerDetails(): void {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  detailsCache.clear();
}
