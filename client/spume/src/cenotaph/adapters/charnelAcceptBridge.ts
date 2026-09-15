// charnel's native accept-side bridge for the `freqhole-player/1`
// protocol. the rust side (`grimoire::cenotaph`, registered on charnel's
// own p2p router - see
// client/charnel/src-tauri/src/player_pairing_accept.rs) already handles
// the pairing handshake, trust, and session gating natively via
// `grimoire::users::UserService` - this bridge only needs to forward
// each already-authorized command to spume's real playback backend
// (`charnelPlaybackAdapter.ts`, the same one already used for the
// dial-out/controller side) and send the resulting ack back.
//
// scope: charnel's "experimental player config" (native mpv/rodio via
// charnelPlaybackAdapter.ts) only - see docs/cenotaph-migration-plan.md's
// front 3 for why the plain webview `mediaPlaybackBackend` DOM-engine
// path (which would need its own charnel-native blob-fetch/radio-tune
// `MediaPlaybackNode`) isn't wired up here.

import { dispatchCommand } from "../control/dispatcher";
import { charnelPlaybackAdapter } from "./charnelPlaybackAdapter";
import { isCharnelMode } from "../../app/services/charnel/mode";

interface CenotaphCommandEventPayload {
  request_id: string;
  command_json: string;
}

let started = false;

/** starts listening for the rust side's `cenotaph-command` events and
 * replies with the resulting ack once `charnelPlaybackAdapter` handles
 * each one. no-op outside charnel mode; safe to call more than once. */
export async function initCharnelPlaybackAcceptMode(): Promise<void> {
  if (!isCharnelMode() || started) return;
  started = true;

  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { listen } = await import("@tauri-apps/api/event");
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");

  await listen<CenotaphCommandEventPayload>("cenotaph-command", (event) => {
    void (async () => {
      const { request_id, command_json } = event.payload;
      // `charnelPlaybackAdapter`'s `PlaybackBackend<unknown>` never reads
      // its `node` argument (see the adapter's own file) - this accept
      // path has no midden/wasm node to hand it, unlike the browser path.
      const ack = await dispatchCommand(charnelPlaybackAdapter, undefined, command_json);
      try {
        await invoke("player_pairing_command_reply", {
          requestId: request_id,
          ackJson: JSON.stringify(ack),
        });
      } catch (err) {
        console.warn("[cenotaph-charnel] failed to send command reply:", err);
      }
    })();
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

/** whether `[player_pairing].enabled` actually resulted in the rust-side
 * accept loop being wired up on this launch. outside charnel mode this
 * always resolves `false`. */
export async function isCharnelAcceptModeStarted(): Promise<boolean> {
  if (!isCharnelMode()) return false;
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("player_pairing_is_started");
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
  // TEMP DEBUG - remove once the charnel player_device bug is found
  console.log(
    `\u{1F7E0}\u{1F7E0}\u{1F7E0} [player_session_debug] invoking set_player_session_active(${active})`
  );
  try {
    await invoke("set_player_session_active", { active });
    console.log(
      `\u{1F7E0}\u{1F7E0}\u{1F7E0} [player_session_debug] set_player_session_active(${active}) succeeded`
    );
  } catch (err) {
    console.error(
      `\u{1F7E0}\u{1F7E0}\u{1F7E0} [player_session_debug] set_player_session_active(${active}) FAILED:`,
      err
    );
  }
}
