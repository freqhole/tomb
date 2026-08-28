import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * height (px) reserved for the strip. also written to `--safe-area-top` so
 * any css relying on it (mirrors spume's convention, see
 * client/spume/src/design-system/theme.css) reserves space for it.
 */
const STRIP_HEIGHT_PX = 38;

/**
 * chromeless macOS title-bar strip for the setup-wizard window - mirrors
 * `client/spume/src/components/layout/TitleBarStrip.tsx`. duplicated here
 * (rather than imported) because charnel's wizard frontend is a separate
 * vite build target with no shared component package.
 *
 * self-contained: checks the `get_chromeless_title_bar` command on mount and
 * renders nothing unless this window is actually running chromeless (macOS +
 * `chromeless_title_bar` config enabled - see charnel-config.toml /
 * lib.rs / wizard.rs). safe to drop into the layout unconditionally.
 *
 * replaces the old `.sidebar-header { -webkit-app-region: drag; }` hack in
 * App.css, which only covered one nav layout and didn't provide any window
 * controls.
 */
export function TitleBarStrip() {
  const [enabled, setEnabled] = createSignal(false);
  const [focused, setFocused] = createSignal(true);
  const [hovered, setHovered] = createSignal(false);

  onMount(() => {
    let unlistenFocus: (() => void) | undefined;
    let appliedSafeAreaTop = false;

    void (async () => {
      try {
        const isChromeless = await invoke<boolean>("get_chromeless_title_bar");
        if (!isChromeless) {
          return;
        }
        setEnabled(true);
        document.documentElement.style.setProperty("--safe-area-top", `${STRIP_HEIGHT_PX}px`);
        appliedSafeAreaTop = true;

        const win = getCurrentWindow();
        setFocused(await win.isFocused());
        unlistenFocus = await win.onFocusChanged(({ payload }) => setFocused(payload));
      } catch (error) {
        // non-tauri, or focus tracking unsupported - keep default focused styling
      }
    })();

    onCleanup(() => {
      unlistenFocus?.();
      if (appliedSafeAreaTop) {
        document.documentElement.style.setProperty("--safe-area-top", "0px");
      }
    });
  });

  const dotColor = (idleColor: string) => (focused() ? idleColor : "#4d4d4d");

  const showGlyphs = () => hovered() && focused();

  const dotStyle = (idleColor: string) => ({
    flex: "none", // override App.css's global `button { flex: 1; }`
    width: "12px",
    height: "12px",
    "border-radius": "9999px",
    border: "none",
    padding: "0",
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    background: dotColor(idleColor),
    transition: "background-color 0.15s",
    cursor: "pointer",
  });

  return (
    <Show when={enabled()}>
      <div
        data-tauri-drag-region="deep"
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          "z-index": 20,
          "user-select": "none",
          height: `${STRIP_HEIGHT_PX}px`,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseDown={(e) => {
          // explicit fallback: don't rely solely on tauri's passive
          // data-tauri-drag-region mousedown listener - call startDragging
          // directly (skipping real buttons) so failures are visible in
          // the console instead of silently doing nothing.
          if (e.button !== 0 || (e.target as HTMLElement).closest("button")) {
            return;
          }
          e.stopPropagation();
          void getCurrentWindow()
            .startDragging()
            .catch((error) => console.error("startDragging failed:", error));
        }}
      >
        <div
          style={{
            display: "flex",
            "align-items": "center",
            height: "100%",
            gap: "8px",
            "padding-left": "10px",
          }}
        >
          <button
            type="button"
            aria-label="close window"
            style={dotStyle("#ff5f57")}
            onClick={() => void getCurrentWindow().close()}
          >
            <Show when={showGlyphs()}>
              <svg viewBox="0 0 10 10" style={{ width: "7px", height: "7px" }}>
                <path
                  d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                  stroke="#4d0000"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </Show>
          </button>
          <button
            type="button"
            aria-label="minimize window"
            style={dotStyle("#ffbd2e")}
            onClick={() => void getCurrentWindow().minimize()}
          >
            <Show when={showGlyphs()}>
              <svg viewBox="0 0 10 10" style={{ width: "7px", height: "7px" }}>
                <path d="M1.5 5h7" stroke="#985712" stroke-width="1.5" stroke-linecap="round" />
              </svg>
            </Show>
          </button>
          <button
            type="button"
            aria-label="maximize window"
            style={dotStyle("#28c840")}
            onClick={() => void getCurrentWindow().toggleMaximize()}
          >
            <Show when={showGlyphs()}>
              <svg viewBox="0 0 10 10" style={{ width: "7px", height: "7px" }}>
                <path
                  d="M6 2h2v2M4 8H2V6"
                  stroke="#0f5c1d"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill="none"
                />
              </svg>
            </Show>
          </button>
        </div>
      </div>
    </Show>
  );
}
