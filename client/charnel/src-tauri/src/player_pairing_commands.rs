//! charnel-native transport for player.freqhole.net's `freqhole-player/1`
//! pairing/control protocol.
//!
//! player.freqhole.net devices speak a small ndjson protocol (one json
//! line in, one json line back, then close) — see
//! `player.freqhole.net/src/midden/acceptLoop.ts` +
//! `player.freqhole.net/src/pairing/pairingHandler.ts` +
//! `player.freqhole.net/src/control/dispatcher.ts`. spume's
//! `playerPairingClient.ts` already speaks this over midden/wasm in the
//! browser; this command gives it a native equivalent so pairing/control
//! also works from the tauri desktop app (`getMiddenNode()` throws under
//! charnel mode, which is the bug this exists to fix).
//!
//! this is intentionally a thin wrapper over grimoire's generic,
//! protocol-agnostic `line_request` primitive — the json shape of the
//! line itself is entirely spume/player.freqhole.net's concern, not
//! grimoire's.

/// player.freqhole.net's ALPN. matches
/// `player.freqhole.net/src/midden/node.ts`'s `PLAYER_ALPN` and spume's
/// `app/services/players/playerPairingClient.ts`'s `PLAYER_ALPN`.
const PLAYER_ALPN: &[u8] = b"freqhole-player/1";

/// send one json line to a player.freqhole.net device and read one json
/// line back (pairing request/response, or a single control command +
/// ack). used for both `pairWithPlayer()` and `sendPlayerCommand()` on
/// the TS side — both are already one-shot open/write/read/close calls.
#[tauri::command]
pub async fn player_pairing_dial(
    peer_addr: String,
    line: String,
) -> Result<Option<String>, String> {
    grimoire::federation::p2p_client::line_request(&peer_addr, PLAYER_ALPN, &line)
        .await
        .map_err(|e| e.to_string())
}
