import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * height (px) reserved for the strip. also written to `--safe-area-top` so
 * any css relying on it (mirrors spume's convention, see
 * client/spume/src/design-system/theme.css) reserves space for it.
 */
const STRIP_HEIGHT_PX = 38;

/** pointer movement (px) before a press on the strip becomes a window drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * chromeless title-bar strip (macOS + linux) for the setup-wizard window -
 * mirrors
 * `client/spume/src/components/layout/TitleBarStrip.tsx`. duplicated here
 * (rather than imported) because charnel's wizard frontend is a separate
 * vite build target with no shared component package.
 *
 * self-contained: checks the `get_chromeless_title_bar` command on mount and
 * renders nothing unless this window is actually running chromeless (macOS/
 * linux + `chromeless_title_bar` config enabled - see charnel-config.toml /
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
  const [resizeHovered, setResizeHovered] = createSignal(false);

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
    position: "relative" as const, // anchors the absolutely-centered glyph below
    flex: "none", // override App.css's global `button { flex: 1; }`
    width: "12px",
    height: "12px",
    "border-radius": "9999px",
    border: "none",
    padding: "0",
    background: dotColor(idleColor),
    transition: "background-color 0.15s",
    cursor: "pointer",
  });

  // absolute + transform centering (not flexbox) so an odd-vs-even sized
  // glyph never sub-pixel-rounds off-center - mirrors spume's TitleBarStrip.
  const glyphStyle = {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "6px",
    height: "6px",
  };

  return (
    <Show when={enabled()}>
      <div
        // deliberately NO `data-tauri-drag-region`: tauri's own document-level
        // listener runs in the capture phase, so on linux it toggled maximize
        // from mousedown while our dblclick toggled it back. drag and
        // double-click are both handled here, identically on every platform.
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          "z-index": 20,
          "user-select": "none",
          height: `${STRIP_HEIGHT_PX}px`,
          background: hovered() ? "rgba(255, 255, 255, 0.05)" : "transparent",
          transition: "background-color 0.15s",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseDown={(e) => {
          // deliberately do NOT start dragging on mousedown. on macOS
          // startDragging() -> performWindowDragWithEvent: enters an AppKit
          // modal drag loop that swallows the matching mouseup, so the
          // webview never counts a second click: e.detail stays 1 and no
          // dblclick event is ever generated. waiting for real pointer
          // movement keeps a stationary click a normal click, which is what
          // lets double-click-to-maximize fire at all.
          //
          // stopPropagation keeps tauri's own document-level drag.js
          // listener (which drags immediately on mousedown) from
          // reintroducing the same problem - drag and double-click are both
          // handled here instead.
          if (e.button !== 0 || (e.target as HTMLElement).closest("button")) {
            return;
          }
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const cleanup = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", cleanup);
          };
          const onMove = (move: MouseEvent) => {
            if (
              Math.abs(move.clientX - startX) < DRAG_THRESHOLD_PX &&
              Math.abs(move.clientY - startY) < DRAG_THRESHOLD_PX
            ) {
              return;
            }
            cleanup();
            void getCurrentWindow()
              .startDragging()
              .catch((error) => console.error("startDragging failed:", error));
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", cleanup);
        }}
        onDblClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) {
            return;
          }
          void getCurrentWindow()
            .toggleMaximize()
            .catch((error) => console.error("toggleMaximize failed:", error));
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
              <svg viewBox="0 0 10 10" style={glyphStyle}>
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
              <svg viewBox="0 0 10 10" style={glyphStyle}>
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
              <svg viewBox="0 0 10 10" style={glyphStyle}>
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
      {/* undecorated windows lose the window manager's own resize border,
       *  so give the corner back as a small hover-visible grip. */}
      <div
        style={{
          position: "fixed",
          bottom: "0",
          right: "0",
          "z-index": 20,
          width: "16px",
          height: "16px",
          cursor: "nwse-resize",
        }}
        onMouseEnter={() => setResizeHovered(true)}
        onMouseLeave={() => setResizeHovered(false)}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          void getCurrentWindow()
            .startResizeDragging("SouthEast")
            .catch((error) => console.error("startResizeDragging failed:", error));
        }}
      >
        <Show when={resizeHovered()}>
          <svg
            viewBox="0 0 16 16"
            style={{ width: "16px", height: "16px", "pointer-events": "none" }}
          >
            <path
              d="M14 2L2 14M14 8L8 14"
              stroke="#ff1a9e"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </Show>
      </div>
    </Show>
  );
}
