// shared "display & playback preferences" toggles - 4 app-local settings
// (experimental/libmpv player, in-app title bar, background images,
// edge-swipe navigation) persisted in charnel-config.toml via
// commands.rs's get/set pairs. extracted out of SettingsView.tsx's own
// "advanced settings" section so SetupView.tsx's own setup flow can offer
// the same 4 toggles during initial setup without re-implementing (and
// then needing to keep in sync with) the same state/invoke logic in a
// second place - this repo's already been burned more than once by
// toggles like these needing updates in several near-identical spots.
//
// fully self-contained (loads its own current values on mount, manages
// its own busy/error state per toggle) - no props, no external admin-
// scope dependency. SettingsView.tsx only ever mounts this while
// `!admin.isRemote()` (these are charnel-app-local settings, meaningless
// for a remote-scoped admin session) - mounting/unmounting on scope
// change already re-triggers this component's own onMount, so settings
// naturally refresh on scope change for free, no extra wiring needed.
import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export default function AdvancedPreferencesToggles() {
  // libmpv opt-in ("experimental player"). when on, spume's
  // `selectBackend()`/`selectVideoBackend()` route audio AND video
  // through libmpv instead of the html `<audio>`/`<video>` elements.
  // defaults on for linux (replaces the embedded loopback http server
  // hack for audio, and is the only way to get working video at all
  // there) and off elsewhere until we've burned it in.
  const [useLibmpvPlayback, setUseLibmpvPlayback] = createSignal(false);
  const [libmpvBusy, setLibmpvBusy] = createSignal(false);
  const [libmpvError, setLibmpvError] = createSignal("");

  // chromeless (in-webview) title bar opt-out. macOS + linux only -
  // hidden entirely elsewhere (see `supports_chromeless_title_bar`).
  const [chromelessSupported, setChromelessSupported] = createSignal(false);
  const [chromelessTitleBar, setChromelessTitleBar] = createSignal(true);
  const [chromelessBusy, setChromelessBusy] = createSignal(false);
  const [chromelessError, setChromelessError] = createSignal("");

  // background images opt-out. when on (default), spume shows a blurred
  // full-page backdrop (built from the item's own image) behind playlist/
  // album/artist/video-series detail views. mirrors spume's own
  // AppState.background_images_enabled toggle (web/android/ios) - desktop
  // doesn't surface spume's settings pages as the primary way to reach
  // settings, so this is controlled from here instead.
  const [backgroundImagesEnabled, setBackgroundImagesEnabled] = createSignal(true);
  const [backgroundImagesBusy, setBackgroundImagesBusy] = createSignal(false);
  const [backgroundImagesError, setBackgroundImagesError] = createSignal("");

  // edge-swipe navigation opt-in. when on, an edge-started horizontal
  // drag/swipe in spume navigates browser history back/forward. mirrors
  // spume's own AppState.edge_swipe_navigation_enabled toggle (web/
  // android/ios) - desktop controls it from here instead, same reasoning
  // as backgroundImagesEnabled above.
  const [edgeSwipeNavigationEnabled, setEdgeSwipeNavigationEnabled] = createSignal(false);
  const [edgeSwipeNavigationBusy, setEdgeSwipeNavigationBusy] = createSignal(false);
  const [edgeSwipeNavigationError, setEdgeSwipeNavigationError] = createSignal("");

  onMount(async () => {
    try {
      const enabled = await invoke<boolean>("get_libmpv_playback");
      setUseLibmpvPlayback(enabled);
    } catch (e) {
      console.error("failed to load libmpv playback setting:", e);
    }
    try {
      setChromelessSupported(await invoke<boolean>("supports_chromeless_title_bar"));
      setChromelessTitleBar(await invoke<boolean>("get_chromeless_title_bar"));
    } catch (e) {
      console.error("failed to load chromeless title bar setting:", e);
    }
    try {
      setBackgroundImagesEnabled(await invoke<boolean>("get_background_images_enabled"));
    } catch (e) {
      console.error("failed to load background images setting:", e);
    }
    try {
      setEdgeSwipeNavigationEnabled(await invoke<boolean>("get_edge_swipe_navigation_enabled"));
    } catch (e) {
      console.error("failed to load edge swipe navigation setting:", e);
    }
  });

  async function toggleLibmpvPlayback() {
    if (libmpvBusy()) return;
    const newValue = !useLibmpvPlayback();
    setUseLibmpvPlayback(newValue);
    setLibmpvBusy(true);
    setLibmpvError("");
    try {
      await invoke("set_libmpv_playback", { enabled: newValue });
    } catch (e) {
      console.error("failed to toggle libmpv playback:", e);
      setLibmpvError(String(e));
      // revert on error
      setUseLibmpvPlayback(!newValue);
    } finally {
      setLibmpvBusy(false);
    }
  }

  async function toggleChromelessTitleBar() {
    if (chromelessBusy()) return;
    const newValue = !chromelessTitleBar();
    setChromelessTitleBar(newValue);
    setChromelessBusy(true);
    setChromelessError("");
    try {
      await invoke("set_chromeless_title_bar", { enabled: newValue });
    } catch (e) {
      console.error("failed to toggle chromeless title bar:", e);
      setChromelessError(String(e));
      // revert on error
      setChromelessTitleBar(!newValue);
    } finally {
      setChromelessBusy(false);
    }
  }

  async function toggleBackgroundImagesEnabled() {
    if (backgroundImagesBusy()) return;
    const newValue = !backgroundImagesEnabled();
    setBackgroundImagesEnabled(newValue);
    setBackgroundImagesBusy(true);
    setBackgroundImagesError("");
    try {
      await invoke("set_background_images_enabled", { enabled: newValue });
    } catch (e) {
      console.error("failed to toggle background images setting:", e);
      setBackgroundImagesError(String(e));
      // revert on error
      setBackgroundImagesEnabled(!newValue);
    } finally {
      setBackgroundImagesBusy(false);
    }
  }

  async function toggleEdgeSwipeNavigationEnabled() {
    if (edgeSwipeNavigationBusy()) return;
    const newValue = !edgeSwipeNavigationEnabled();
    setEdgeSwipeNavigationEnabled(newValue);
    setEdgeSwipeNavigationBusy(true);
    setEdgeSwipeNavigationError("");
    try {
      await invoke("set_edge_swipe_navigation_enabled", { enabled: newValue });
    } catch (e) {
      console.error("failed to toggle edge swipe navigation setting:", e);
      setEdgeSwipeNavigationError(String(e));
      // revert on error
      setEdgeSwipeNavigationEnabled(!newValue);
    } finally {
      setEdgeSwipeNavigationBusy(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "1rem",
          "margin-top": "1rem",
        }}
      >
        <button
          class={`toggle-button ${useLibmpvPlayback() ? "active" : ""}`}
          onClick={toggleLibmpvPlayback}
          disabled={libmpvBusy()}
          style={{
            flex: "none",
            width: "44px",
            height: "24px",
            "border-radius": "12px",
            border: "none",
            padding: "0",
            background: useLibmpvPlayback()
              ? "var(--color-accent-500, #ff69b4)"
              : "var(--color-bg-tertiary, #333)",
            cursor: libmpvBusy() ? "wait" : "pointer",
            position: "relative",
            transition: "background 0.2s",
            "flex-shrink": "0",
            opacity: libmpvBusy() ? "0.6" : "1",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "4px",
              left: useLibmpvPlayback() ? "24px" : "4px",
              width: "16px",
              height: "16px",
              "border-radius": "50%",
              background: "white",
              transition: "left 0.2s",
            }}
          />
        </button>
        <div>
          <div style={{ "font-weight": "500" }}>use experimental player</div>
          <div
            style={{
              "font-size": "0.875rem",
              color: "var(--color-text-secondary, #888)",
              "margin-top": "0.25rem",
            }}
          >
            turn on if you are having playback issues, or want to play more audio/video formats than
            the browser supports.
          </div>
          <Show when={libmpvError()}>
            <div
              style={{
                "font-size": "0.8125rem",
                color: "var(--color-error-500, #ff4d6d)",
                "margin-top": "0.25rem",
              }}
            >
              {libmpvError()}
            </div>
          </Show>
        </div>
      </div>

      <Show when={chromelessSupported()}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            gap: "1rem",
            "margin-top": "1.5rem",
          }}
        >
          <button
            class={`toggle-button ${chromelessTitleBar() ? "active" : ""}`}
            onClick={toggleChromelessTitleBar}
            disabled={chromelessBusy()}
            style={{
              flex: "none",
              width: "44px",
              height: "24px",
              "border-radius": "12px",
              border: "none",
              padding: "0",
              background: chromelessTitleBar()
                ? "var(--color-accent-500, #ff69b4)"
                : "var(--color-bg-tertiary, #333)",
              cursor: chromelessBusy() ? "wait" : "pointer",
              position: "relative",
              transition: "background 0.2s",
              "flex-shrink": "0",
              opacity: chromelessBusy() ? "0.6" : "1",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: "4px",
                left: chromelessTitleBar() ? "24px" : "4px",
                width: "16px",
                height: "16px",
                "border-radius": "50%",
                background: "white",
                transition: "left 0.2s",
              }}
            />
          </button>
          <div>
            <div style={{ "font-weight": "500" }}>use in-app title bar</div>
            <div
              style={{
                "font-size": "0.875rem",
                color: "var(--color-text-secondary, #888)",
                "margin-top": "0.25rem",
              }}
            >
              turn off to use system default title bar. takes effect next time the app restarts.
            </div>
            <Show when={chromelessError()}>
              <div
                style={{
                  "font-size": "0.8125rem",
                  color: "var(--color-error-500, #ff4d6d)",
                  "margin-top": "0.25rem",
                }}
              >
                {chromelessError()}
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "1rem",
          "margin-top": "1.5rem",
        }}
      >
        <button
          class={`toggle-button ${backgroundImagesEnabled() ? "active" : ""}`}
          onClick={toggleBackgroundImagesEnabled}
          disabled={backgroundImagesBusy()}
          style={{
            flex: "none",
            width: "44px",
            height: "24px",
            "border-radius": "12px",
            border: "none",
            padding: "0",
            background: backgroundImagesEnabled()
              ? "var(--color-accent-500, #ff69b4)"
              : "var(--color-bg-tertiary, #333)",
            cursor: backgroundImagesBusy() ? "wait" : "pointer",
            position: "relative",
            transition: "background 0.2s",
            "flex-shrink": "0",
            opacity: backgroundImagesBusy() ? "0.6" : "1",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "4px",
              left: backgroundImagesEnabled() ? "24px" : "4px",
              width: "16px",
              height: "16px",
              "border-radius": "50%",
              background: "white",
              transition: "left 0.2s",
            }}
          />
        </button>
        <div>
          <div style={{ "font-weight": "500" }}>background images</div>
          <div
            style={{
              "font-size": "0.875rem",
              color: "var(--color-text-secondary, #888)",
              "margin-top": "0.25rem",
            }}
          >
            show backdrop images behind playlist, album, artist, and video series detail views
          </div>
          <Show when={backgroundImagesError()}>
            <div
              style={{
                "font-size": "0.8125rem",
                color: "var(--color-error-500, #ff4d6d)",
                "margin-top": "0.25rem",
              }}
            >
              {backgroundImagesError()}
            </div>
          </Show>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "1rem",
          "margin-top": "1.5rem",
        }}
      >
        <button
          class={`toggle-button ${edgeSwipeNavigationEnabled() ? "active" : ""}`}
          onClick={toggleEdgeSwipeNavigationEnabled}
          disabled={edgeSwipeNavigationBusy()}
          style={{
            flex: "none",
            width: "44px",
            height: "24px",
            "border-radius": "12px",
            border: "none",
            padding: "0",
            background: edgeSwipeNavigationEnabled()
              ? "var(--color-accent-500, #ff69b4)"
              : "var(--color-bg-tertiary, #333)",
            cursor: edgeSwipeNavigationBusy() ? "wait" : "pointer",
            position: "relative",
            transition: "background 0.2s",
            "flex-shrink": "0",
            opacity: edgeSwipeNavigationBusy() ? "0.6" : "1",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "4px",
              left: edgeSwipeNavigationEnabled() ? "24px" : "4px",
              width: "16px",
              height: "16px",
              "border-radius": "50%",
              background: "white",
              transition: "left 0.2s",
            }}
          />
        </button>
        <div>
          <div style={{ "font-weight": "500" }}>edge-swipe navigation</div>
          <div
            style={{
              "font-size": "0.875rem",
              color: "var(--color-text-secondary, #888)",
              "margin-top": "0.25rem",
            }}
          >
            drag in from the left or right edge of the window to go back/forward
          </div>
          <Show when={edgeSwipeNavigationError()}>
            <div
              style={{
                "font-size": "0.8125rem",
                color: "var(--color-error-500, #ff4d6d)",
                "margin-top": "0.25rem",
              }}
            >
              {edgeSwipeNavigationError()}
            </div>
          </Show>
        </div>
      </div>
    </>
  );
}
