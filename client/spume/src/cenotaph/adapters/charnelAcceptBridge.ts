// charnel's accept-side bridge for the `freqhole-player/1`
// protocol. the rust side (`grimoire::cenotaph`, registered on charnel's
// own p2p router - see
// client/charnel/src-tauri/src/player_pairing_accept.rs) already handles
// the pairing handshake, trust, and session gating via
// `grimoire::users::UserService` - this bridge only needs to forward
// each already-authorized command to spume's real playback backend
// (`charnelPlaybackAdapter.ts`, the same one already used for the
// dial-out/controller side) and send the resulting ack back.
//
// scope: charnel's "experimental player config" (mpv/rodio via
// charnelPlaybackAdapter.ts) - the only playback backend this protocol
// ever dispatches to.

import { dispatchCommand } from "../control/dispatcher";
import { charnelPlaybackAdapter } from "./charnelPlaybackAdapter";
import { isCharnelMode } from "../../app/services/charnel/mode";
import {
  connectedControllers,
  markControllerConnected,
  markControllerDisconnected,
} from "../control/connectedControllers";
import { spumeTrustStore } from "./trustStoreAdapter";
import { setSessionSignal } from "../pairing/pinStore";
import type { PlayerSession, SessionMode } from "../pairing/playerSession";
import { debug, error } from "../../utils/logger";
import { CENOTAPH_QUEUE_TRACE } from "../queueTrace";
import { toast } from "../../components/feedback/Toast";

interface CenotaphCommandEventPayload {
  request_id: string;
  command_json: string;
  peer_id: string;
}

let started = false;
let unlisten: (() => void) | null = null;
let connectedPollTimer: ReturnType<typeof setInterval> | null = null;
// rust's dispatch_tx consumer loop (player_pairing_accept.rs's
// spawn_dispatch_bridge) emits a `cenotaph-command` event per queued
// command and moves straight on to the next one in its channel - it does
// NOT wait for this side's reply before emitting the next event. without
// serializing here, two commands arriving close together (a flaky
// controller's append_queue retry, a queue-push landing right as a
// get_status poll fires, etc.) run their handlers concurrently, racing on
// the same appState()/queue reads+writes - e.g. two overlapping
// appendQueue calls both compute currentQueueHashes() from the same
// pre-mutation snapshot and both decide an item isn't a duplicate yet,
// or a stop()/clearQueue() lands in the middle of an in-flight
// playMediaItem() that then finishes and resumes audio right after.
// chaining onto this promise forces one full dispatchCommand+reply cycle
// to finish before the next command's handler starts.
let commandChain: Promise<void> = Promise.resolve();

interface PairingCodeDto {
  code: string;
  grants_role: "admin" | "member" | "viewer";
}

interface PlayerSessionDto {
  mode: SessionMode;
  allowed_node_ids: string[];
  last_active_at: number;
}

interface PairingSnapshotDto {
  node_id: string | null;
  current_code: PairingCodeDto | null;
  session: PlayerSessionDto | null;
  connected: { node_id: string; display_name: string }[];
}

// grimoire's rust endpoint (grimoire/src/cenotaph/endpoint.rs) tracks
// connected controllers via state::mark_connected/mark_disconnected
// for BOTH command-dispatching streams and read-only `subscribe` status-
// watcher streams - the latter never dispatch a command at all, so they're
// invisible to the per-command markControllerConnected call below. polling
// `player_pairing_get_snapshot` (already exposed for exactly this purpose,
// see its own doc comment) is the only way to see those too.
const CONNECTED_POLL_INTERVAL_MS = 5000;

// grimoire's `current_code`/`session` (real, redeemable grimoire invite
// codes, validated by `grimoire::cenotaph::endpoint.rs`) is the
// ONLY pairing pin that will ever actually be accepted in charnel mode -
// `pinStore.ts`'s `PlayerSession.pin` is a purely local, independently-
// generated value with no relationship to it whatsoever. previously
// nothing ever pushed grimoire's real code into that signal in charnel
// mode (only the browser/wasm accept path's `acceptModeBootstrap.ts` did,
// via `initSessionSignal` - never called under charnel, see
// `initRemotePlaybackBootstrap`'s charnel branch), so charnel's settings
// panel/qr overlay displayed a pin that could never match what grimoire
// actually validated - every real pairing attempt failed with
// `invalid_code`, and no pin showed at all until "rotate pin" was
// clicked (which lazily created a - still wrong - local session on
// first use). mapping grimoire's snapshot into the SAME `PlayerSession`-
// shaped signal `pinStore.ts` already exposes means `CenotaphPlayerApp`/
// `PlayerSettingsPanel`'s existing `currentPin()`/`currentSession()`
// reads need no changes at all - only what feeds the signal changes.
function mapSnapshotToSession(snap: PairingSnapshotDto): PlayerSession | null {
  if (!snap.current_code || !snap.session) return null;
  return {
    pin: snap.current_code.code,
    mode: snap.session.mode,
    allowed_node_ids: snap.session.allowed_node_ids,
    admin_grant_pending: snap.current_code.grants_role === "admin",
    last_active_at: snap.session.last_active_at,
  };
}

/** re-fetches grimoire's real pairing snapshot and pushes the mapped pin/
 * session into the same reactive signal `pinStore.ts` exposes, plus
 * updates the connected-controllers list. called on an interval (see
 * `startCharnelConnectedControllersSync`) and immediately after any
 * mutating action below, so the ui never has to wait a full poll tick to
 * see its own rotate/regenerate/toggle take effect. no-op outside charnel
 * mode. */
export async function refreshCharnelPairingSnapshot(): Promise<void> {
  if (!isCharnelMode()) return;
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    const snap = await invoke<PairingSnapshotDto>("player_pairing_get_snapshot");
    const seen = new Set<string>();
    for (const c of snap.connected) {
      seen.add(c.node_id);
      markControllerConnected({ node_id: c.node_id, display_name: c.display_name });
    }
    for (const c of connectedControllers()) {
      if (!seen.has(c.node_id)) markControllerDisconnected(c.node_id);
    }
    const session = mapSnapshotToSession(snap);
    if (session) {
      setSessionSignal(session);
    } else {
      // expected right after startup / while `[player_pairing].enabled`
      // is off - not logged above debug level to avoid spamming every
      // poll tick in that (common, non-actionable) state.
      debug(
        "charnelAcceptBridge",
        "player_pairing_get_snapshot returned no current_code/session yet - pairing may not have finished starting"
      );
    }
  } catch (err) {
    debug("charnelAcceptBridge", "pairing snapshot poll failed:", err);
  }
}

function startCharnelConnectedControllersSync(): void {
  if (connectedPollTimer) return;
  void refreshCharnelPairingSnapshot();
  connectedPollTimer = setInterval(
    () => void refreshCharnelPairingSnapshot(),
    CONNECTED_POLL_INTERVAL_MS
  );
}

/** rotate the plain (non-admin-granting) session pin - charnel's real
 * counterpart to `pairing/playerSession.ts`'s `regenerateSessionPin`,
 * calling grimoire's actual invite-code minting instead of generating an
 * unrelated local value. no-op outside charnel mode. */
export async function charnelRegeneratePin(): Promise<void> {
  if (!isCharnelMode()) return;
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("player_pairing_regenerate_session_pin");
    await refreshCharnelPairingSnapshot();
  } catch (err) {
    error("charnelAcceptBridge", "charnelRegeneratePin failed", err);
    toast.error(
      `failed to rotate pairing pin: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** mint a fresh one-time admin-bootstrap pin - charnel's real counterpart
 * to `playerSession.ts`'s `regenerateAdminPin`. no-op outside charnel
 * mode. */
export async function charnelRegenerateAdminPin(): Promise<void> {
  if (!isCharnelMode()) return;
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("player_pairing_regenerate_admin_pin");
    await refreshCharnelPairingSnapshot();
  } catch (err) {
    error("charnelAcceptBridge", "charnelRegenerateAdminPin failed", err);
    toast.error(
      `failed to generate admin pairing code: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** toggle "everyone"/"selected devices" mode - charnel's real counterpart
 * to `playerSession.ts`'s `setSessionMode`. no-op outside charnel mode. */
export async function charnelSetSessionMode(mode: SessionMode): Promise<void> {
  if (!isCharnelMode()) return;
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("player_pairing_set_session_mode", { mode });
    await refreshCharnelPairingSnapshot();
  } catch (err) {
    error("charnelAcceptBridge", `charnelSetSessionMode(${mode}) failed`, err);
    toast.error(
      `failed to change session mode: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** starts listening for the rust side's `cenotaph-command` events and
 * replies with the resulting ack once `charnelPlaybackAdapter` handles
 * each one. no-op outside charnel mode; safe to call more than once. */
export async function initCharnelPlaybackAcceptMode(): Promise<void> {
  if (!isCharnelMode() || started) return;
  started = true;
  startCharnelConnectedControllersSync();

  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { listen } = await import("@tauri-apps/api/event");
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");

  unlisten = await listen<CenotaphCommandEventPayload>("cenotaph-command", (event) => {
    // chain onto the running command queue instead of spawning a
    // parallel handler - see commandChain's own doc comment.
    commandChain = commandChain.then(() => handleCenotaphCommand(event.payload, invoke));
  });
}

async function handleCenotaphCommand(
  payload: CenotaphCommandEventPayload,
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
): Promise<void> {
  const { request_id, command_json, peer_id } = payload;
  const isQueueCommand =
    command_json.includes('"replace_queue"') || command_json.includes('"append_queue"');
  const receivedAt = Date.now();
  if (isQueueCommand) {
    debug(
      "charnelAcceptBridge",
      `${CENOTAPH_QUEUE_TRACE} handleCenotaphCommand: received queue command from peer_id=${peer_id} request_id=${request_id}`
    );
  }

  // dispatchCommand MUST start before anything else here - for a queue
  // command, this is what renders pending preview rows (see
  // charnelPlaybackAdapter.ts's addPendingPreview), and that's supposed
  // to be the very first thing that happens after a command arrives.
  // previously this was awaited AFTER the trust-store lookup below,
  // delaying every pending row by however long that lookup took - the
  // lookup is only for a cosmetic display name in the connected-
  // controllers list (peer trust/session gating already happened,
  // see this file's header comment), so it has no reason to
  // block dispatch at all. `charnelPlaybackAdapter`'s
  // `PlaybackBackend<unknown>` never reads its `node` argument (see the
  // adapter's own file) - this accept path has no midden/wasm node to
  // hand it, unlike the browser path.
  debug("charnelAcceptBridge", `dispatchCommand starting, request_id=${request_id}`);
  const dispatchPromise = dispatchCommand(charnelPlaybackAdapter, undefined, command_json);

  // rust dials a brand new stream per command rather than holding one
  // open (see player_pairing_accept.rs), so - same as the wasm/browser
  // accept path's per-stream markControllerConnected calls in
  // playerConnectionHandler.ts - every dispatched command doubles as a
  // liveness signal here; connectedControllers.ts's grace period turns
  // that into a stable "currently connected" indicator instead of a
  // flicker. no matching "disconnected" call is needed for this path -
  // the grace period timeout handles it once commands stop arriving.
  // runs CONCURRENTLY with dispatchPromise above, not before it.
  const controller = await spumeTrustStore.getTrustedController(peer_id);
  markControllerConnected({
    node_id: peer_id,
    display_name: controller?.display_name ?? peer_id.slice(0, 8),
  });
  if (isQueueCommand) {
    debug(
      "charnelAcceptBridge",
      `${CENOTAPH_QUEUE_TRACE} handleCenotaphCommand: getTrustedController+markControllerConnected done at +${Date.now() - receivedAt}ms (ran concurrently with dispatchCommand, not before it)`
    );
  }

  // dispatchCommand now catches its own backend errors and always
  // resolves to a real ack - this remains as defense in depth (e.g. a
  // malformed command_json JSON.parse throw) so a reply always goes
  // back no matter what, rather than leaving the controller waiting
  // forever with no ack and no error surfaced.
  let ack: unknown;
  try {
    ack = await dispatchPromise;
    debug("charnelAcceptBridge", `dispatchCommand resolved, request_id=${request_id}`, ack);
    if (isQueueCommand) {
      debug(
        "charnelAcceptBridge",
        `${CENOTAPH_QUEUE_TRACE} handleCenotaphCommand: queue command dispatched after ${Date.now() - receivedAt}ms, request_id=${request_id}, ack=${JSON.stringify(ack)}`
      );
    }
  } catch (err) {
    if (isQueueCommand) {
      error(
        "charnelAcceptBridge",
        `${CENOTAPH_QUEUE_TRACE} handleCenotaphCommand: queue command threw after ${Date.now() - receivedAt}ms, request_id=${request_id}:`,
        err
      );
    }
    error("charnelAcceptBridge", `dispatchCommand threw for request_id=${request_id}:`, err);
    ack = { type: "command_ack", ok: false, reason: "invalid_command" };
  }
  try {
    await invoke("player_pairing_command_reply", {
      requestId: request_id,
      ackJson: JSON.stringify(ack),
    });
  } catch (err) {
    console.warn("[cenotaph-charnel] failed to send command reply:", err);
  }
}

// vite HMR replaces this module's instance on every edit without ever
// re-running app boot, so the module-level `started` guard above can't
// prevent a NEW listener stacking on top of the OLD (still-registered,
// never-torn-down) one from the previous instance - every real event then
// fires once per surviving instance. tearing down the old listener here
// keeps dev-mode reloads at exactly one live listener; no-op in prod
// (`import.meta.hot` is undefined there, and the module is never replaced).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unlisten?.();
    if (connectedPollTimer) clearInterval(connectedPollTimer);
  });
}

/** this device's iroh node id - the same identity the accept-loop above
 * is registered on (reused from charnel's existing p2p endpoint, not a
 * second identity). used to render the pairing qr. */
export async function getCharnelNodeId(): Promise<string> {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("p2p_get_node_id");
}

/** the persisted `[player_pairing].enabled` config flag - whether other
 * peers can even attempt to pair with this device at all (distinct from
 * `remotePlaybackEnabled`/`setCharnelPlayerSessionActive`, which only
 * affect this device's own "am I currently active" advertising once
 * pairing is already possible). outside charnel mode this always
 * resolves `false` - the browser/wasm accept path has no equivalent
 * config gate. */
export async function getCharnelPlayerPairingEnabled(): Promise<boolean> {
  if (!isCharnelMode()) return false;
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("player_pairing_get_enabled");
}

/** persists `[player_pairing].enabled` - takes effect on the very next
 * incoming connection attempt, no app restart needed (see
 * `player_pairing_set_enabled`'s own doc comment in
 * `player_pairing_accept.rs`). no-op outside charnel mode. */
export async function setCharnelPlayerPairingEnabled(enabled: boolean): Promise<void> {
  if (!isCharnelMode()) return;
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("player_pairing_set_enabled", { enabled });
}

/** mirrors rathole's own `grimoire::player_session::set_active()` call -
 * charnel never made this call at all, so a controller probing this
 * device's `server_info`/`/api/hello` always saw `player_device: false`,
 * even with `/player` open and actively accepting commands (see
 * `set_player_session_active`'s own doc comment in
 * `player_pairing_accept.rs`). no-op outside charnel mode. */
export async function setCharnelPlayerSessionActive(active: boolean): Promise<void> {
  if (!isCharnelMode()) return;
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  debug("charnelAcceptBridge", `invoking set_player_session_active(${active})`);
  try {
    await invoke("set_player_session_active", { active });
    debug("charnelAcceptBridge", `set_player_session_active(${active}) succeeded`);
  } catch (err) {
    error("charnelAcceptBridge", `set_player_session_active(${active}) FAILED:`, err);
  }
}
