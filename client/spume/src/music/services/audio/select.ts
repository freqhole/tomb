// runtime backend selector.
//
// returns the appropriate `PlayerBackend` for the current host:
//
// - **html_audio** in browsers and in tauri when the rodio opt-in
//   is off. wraps the existing imperative api in `../audio/player.ts`
//   so callers can talk to a single `PlayerBackend` interface.
// - **rodio** in tauri (charnel) when the user has opted in via the
//   wizard's settings view (persisted in `FreqholeAppConfig` on the
//   rust side; `get_rodio_playback` / `set_rodio_playback` tauri
//   commands).
// - **dummy** in node/test environments where no real audio surface
//   exists.
//
// **why the toggle is opt-in**: the html backend is the battle-
// tested default. surfacing rodio behind a settings flag lets us
// dogfood it in real usage without forcing every charnel user onto
// a v1 audio path on day one. linux flips the default on because
// webkitgtk's html `<audio>` is unreliable enough that the rodio
// path is strictly better there.
//
// **source of truth**: charnel's `FreqholeAppConfig.use_rodio_playback`.
// this module caches the value synchronously so `selectBackend()` can
// stay non-async; `initRodioPreference()` (called once at app boot)
// fetches the initial value, and `onConfigChanged` re-fetches it when
// the wizard flips the toggle. in non-charnel mode there's a tiny
// localStorage fallback so dev/test code can still exercise the path,
// but there is no ui to set it.

import { isCharnelMode } from "../../../app/services/charnel/mode";
import type { PlayerBackend } from "./backend";
import { DummyBackend } from "./backends/dummy";
import { RodioBackend } from "./backends/rodioBackend";
// preference state lives in its own leaf module (see rodioPreference.ts)
// so blobResolver.ts can read isRodioEnabled() without pulling in
// RodioBackend's own import chain, which closes a cycle back here.
export { initRodioPreference, isRodioEnabled, setRodioEnabled } from "./rodioPreference";
import { isRodioEnabled } from "./rodioPreference";

/// pick the appropriate backend for the current host.
///
/// **callers must pass `htmlBackend`** - the always-allocated
/// html instance owned by the player facade. when html is the
/// chosen backend, we return that same instance (not a fresh one)
/// so its dom event stream is the single source of truth feeding
/// `playerStateSync`. constructing a second `HtmlAudioBackend`
/// would create a "ghost" instance whose audio element plays but
/// whose events nobody is listening to - the UI would freeze
/// while audio kept going.
///
/// the parameter is typed as `PlayerBackend` rather than
/// `HtmlAudioBackend` to avoid a static import edge
/// `select.ts → htmlAudio.ts` (which would close cycles via
/// `htmlAudio → mediaSessionBridge → ...`). the player facade is
/// the only caller and always passes its own `htmlBackend` instance.
///
/// returns:
/// - `RodioBackend` in tauri/charnel when the user opted in
/// - the passed-in html instance in tauri (rodio off) and in browsers
/// - `DummyBackend` only when the dom isn't available (tests, ssr)
export function selectBackend(htmlBackend: PlayerBackend): PlayerBackend {
  if (isCharnelMode() && isRodioEnabled()) {
    return new RodioBackend();
  }
  if (typeof document === "undefined") {
    return new DummyBackend();
  }
  return htmlBackend;
}
