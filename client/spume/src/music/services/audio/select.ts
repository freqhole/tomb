// runtime backend selector.
//
// returns the appropriate `PlayerBackend` for the current host:
//
// - **html_audio** in browsers and in tauri when the "experimental
//   player" (libmpv) opt-in is off - a plain web-browser-style html
//   `<audio>` element, same as it ever was.
// - **rodio** (the TS class name predates libmpv, but the wire protocol
//   is backend-agnostic - see player_commands.rs) in tauri (charnel)
//   when the user has opted in via the wizard's settings view
//   (persisted in `FreqholeAppConfig` on the rust side;
//   `get_libmpv_playback` / `set_libmpv_playback` tauri commands now
//   drive it, not the old rodio-only commands).
// - **dummy** in node/test environments where no real audio surface
//   exists.
//
// **why the toggle is opt-in**: the html backend is the battle-
// tested default. surfacing the native (libmpv) path behind a settings
// flag lets us dogfood it in real usage without forcing every charnel
// user onto it on day one. linux flips the default on because
// webkitgtk's html `<audio>` is unreliable enough that the native path
// is strictly better there.
//
// **source of truth**: charnel's `FreqholeAppConfig.use_libmpv_playback`.
// this module caches the value synchronously so `selectBackend()` can
// stay non-async; `initLibmpvPreference()` (called once at app boot)
// fetches the initial value, and `onConfigChanged` re-fetches it when
// the wizard flips the toggle. in non-charnel mode there's a tiny
// localStorage fallback so dev/test code can still exercise the path,
// but there is no ui to set it.

import { isCharnelMode } from "../../../app/services/charnel/mode";
import type { PlayerBackend } from "./backend";
import { DummyBackend } from "./backends/dummy";
import { RodioBackend } from "./backends/rodioBackend";
// preference state lives in its own leaf module (see libmpvPreference.ts)
// so blobResolver.ts can read isLibmpvEnabled() without pulling in
// RodioBackend's own import chain, which closes a cycle back here.
export { initLibmpvPreference, isLibmpvEnabled, setLibmpvEnabled } from "./libmpvPreference";
import { isLibmpvEnabled } from "./libmpvPreference";

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
/// - `RodioBackend` in tauri/charnel when the user opted into the
///   experimental (libmpv) player
/// - the passed-in html instance in tauri (experimental player off) and
///   in browsers
/// - `DummyBackend` only when the dom isn't available (tests, ssr)
export function selectBackend(htmlBackend: PlayerBackend): PlayerBackend {
  if (isCharnelMode() && isLibmpvEnabled()) {
    return new RodioBackend();
  }
  if (typeof document === "undefined") {
    return new DummyBackend();
  }
  return htmlBackend;
}
