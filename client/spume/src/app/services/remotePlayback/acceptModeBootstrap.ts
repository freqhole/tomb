// wires cenotaph's generalized accept loop into spume's single existing
// midden node: `freqhole/1` gets spume's own hello route (server-info
// probes advertising `supports_remote_playback`), `freqhole-player/1` gets
// cenotaph's pairing + playback-command handler using cenotaph's own
// default `mediaPlaybackBackend` (see lib/cenotaph/ts/src/playback/
// playbackEngine.ts) - spume's `/player/` route reuses this SAME backend
// directly (imports it from `@freqhole/cenotaph` too), so there's exactly
// one playback implementation shared by both the accept-loop side (this
// file) and the render side (CenotaphPlayerApp.tsx).
//
// called once from client.ts's getMiddenNode(), right after the node is
// created - see docs/cenotaph-migration-plan.md phase 1.

import type { MiddenNodeLike } from "@freqhole/api-client";
import {
  FREQHOLE_ALPN,
  PLAYER_ALPN,
  createApiRouter,
  createHelloRouteHandler,
  createPlayerConnectionHandler,
  initSessionSignal,
  mediaPlaybackBackend,
  startAcceptLoop,
  type CenotaphAcceptableNode,
  type CenotaphBiStream,
  type MediaPlaybackNode,
} from "@freqhole/cenotaph";
import { spumeTrustStore } from "./trustStoreAdapter";
import { spumeSessionStore } from "./playerSessionAdapter";
import { getSpumeHelloInfo } from "./spumeHelloRoute";
import { isRemotePlaybackEnabled } from "./remoteModeSettings";
import { registerBrowserApiRoutes } from "../../../lib/api/router";

/** the node shape this module's two accept-loop handlers actually need.
 * `getMiddenNode()`'s declared return type (`MiddenNodeLike`, from
 * `@freqhole/api-client`) marks these members optional because it also
 * models Tauri's much smaller `CharnelTransport` surface - but this
 * function is only ever called from `client.ts`'s non-charnel branch, on
 * the real wasm-backed node `getMiddenNode()` returns in that case, so
 * every member below is genuinely always present at runtime. */
type AcceptModeNode = CenotaphAcceptableNode & MediaPlaybackNode;

let started = false;

/** starts spume's inbound freqhole/1 + freqhole-player/1 handling on
 * `node`. safe to call once per node; no-ops on repeat calls (mirrors
 * `startAcceptLoop`'s own per-node idempotency, one level up so the
 * router/handler objects below aren't rebuilt on a hot-reload re-init). */
export function initRemotePlaybackAcceptMode(node: MiddenNodeLike): void {
  if (started) return;
  started = true;

  const acceptNode = node as unknown as AcceptModeNode;

  const apiRouter = createApiRouter({
    // a peer may call any non-"public" freqhole/1 route (e.g. the browser
    // song/blob-metadata routes below) only once it's a recognized,
    // role-carrying peer - i.e. it went through the same add-remote/pairing
    // flow this same instance uses for the player-pairing accept mode
    // below. this is spume's single, unified incoming-peer-trust list
    // (docs/player-peer-trust-bridge-plan.md) - NOT the `remotes` store,
    // which is the mirror-image, outbound "who does spume dial out to"
    // relationship.
    resolvePeerRole: async (nodeId) => {
      const controller = await spumeTrustStore.getTrustedController(nodeId).catch(() => undefined);
      return controller?.role ?? null;
    },
  });
  apiRouter.registerRoute(
    "GET",
    "/api/hello",
    createHelloRouteHandler(getSpumeHelloInfo),
    "public"
  );
  // browser-side implementation of a small slice of grimoire's own api
  // contract (docs/cenotaph-migration-plan.md phase 3, tier 2) - lets a
  // browser peer answer song/blob metadata lookups the same way a real
  // grimoire remote does, so a controlling peer's cenotaph sync-to-local
  // flow doesn't need to know which kind of remote it's talking to.
  registerBrowserApiRoutes(apiRouter);

  // load (or create) the ephemeral player session once at startup, so its
  // pin/mode/allowlist are ready before the first connection attempt - see
  // playerSession.ts for what this session gates vs. base peer trust
  // above.
  void initSessionSignal(spumeSessionStore);

  const playerHandler = createPlayerConnectionHandler<AcceptModeNode>({
    backend: mediaPlaybackBackend,
    trustStore: spumeTrustStore,
    sessionStore: spumeSessionStore,
    // only actually accept playback commands while this tab is showing
    // /player/ - otherwise mediaPlaybackBackend (and its own <video>
    // element) would get driven silently, with no UI observing it at all
    // (only CenotaphPlayerApp renders this backend's state).
    isEnabled: () => isRemotePlaybackEnabled() && window.location.pathname.startsWith("/player"),
  });

  startAcceptLoop<AcceptModeNode>(acceptNode, {
    [FREQHOLE_ALPN]: (_n: AcceptModeNode, stream: CenotaphBiStream) => apiRouter.dispatch(stream),
    [PLAYER_ALPN]: playerHandler,
  });
}
