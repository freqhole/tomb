import { createSignal, onMount, onCleanup, Show } from "solid-js";
import {
  getChromelessTitleBar,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  startDraggingWindow,
} from "../../app/services/charnel/commands";
import { videoMiniPlayerExpanded } from "../player/VideoMiniPlayer";

/**
 * height (px) reserved for the strip. also written to `--safe-area-top` so
 * every existing `--nav-height`/`--player-height`/popover max-height
 * consumer automatically reserves space for it (see theme.css) without any
 * per-view changes.
 */
const STRIP_HEIGHT_PX = 38;
// width of the pl-[10px] + 3 buttons (12px) + 2 gaps (8px) traffic-light cluster below.
const TRAFFIC_LIGHTS_WIDTH_PX = 68;
/** pointer movement (px) before a press on the strip becomes a window drag. */
const DRAG_THRESHOLD_PX = 4;

/**
 * chromeless title-bar strip (macOS + linux): a transparent, full-width
 * `data-tauri-drag-region` band at the top of the window with custom
 * traffic-light (close/minimize/maximize) buttons, replacing the native
 * title bar.
 *
 * self-contained: checks `getChromelessTitleBar()` on mount and renders
 * nothing (a no-op) unless this window is actually running chromeless
 * (macOS/linux + tauri + `chromeless_title_bar` config enabled - see
 * charnel-config.toml / lib.rs / wizard.rs). safe to drop into any
 * top-level layout (spume's App.tsx, charnel's wizard App.tsx) unconditionally.
 *
 * `data-tauri-drag-region` already natively provides click-and-drag window
 * movement, double-click-to-maximize, and automatically excludes real
 * clickable elements (like the buttons below) from triggering a drag - no
 * extra plumbing needed for any of that.
 */
export function TitleBarStrip() {
  const [enabled, setEnabled] = createSignal(false);
  const [focused, setFocused] = createSignal(true);
  const [hovered, setHovered] = createSignal(false);

  onMount(() => {
    let unlistenFocus: (() => void) | undefined;
    let appliedSafeAreaTop = false;

    void (async () => {
      const isChromeless = await getChromelessTitleBar();
      if (!isChromeless) {
        return;
      }
      setEnabled(true);
      document.documentElement.style.setProperty("--safe-area-top", `${STRIP_HEIGHT_PX}px`);
      document.documentElement.style.setProperty("--chrome-top-inset", `${STRIP_HEIGHT_PX}px`);
      document.documentElement.style.setProperty(
        "--chrome-traffic-lights-inset",
        `${TRAFFIC_LIGHTS_WIDTH_PX}px`
      );
      appliedSafeAreaTop = true;

      try {
        // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
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
        document.documentElement.style.setProperty("--chrome-top-inset", "0px");
        document.documentElement.style.setProperty("--chrome-traffic-lights-inset", "0px");
      }
    });
  });

  const dotClass = (idleColorClass: string) =>
    `relative w-[12px] h-[12px] rounded-full transition-colors ${
      focused() ? idleColorClass : "bg-[#4d4d4d]"
    }`;

  const showGlyphs = () => hovered() && focused();

  return (
    <Show when={enabled()}>
      <div
        // deliberately NO `data-tauri-drag-region`: tauri's own document-level
        // listener runs in the capture phase, so on linux it toggled maximize
        // from mousedown while our dblclick toggled it back. drag and
        // double-click are both handled here, identically on every platform.
        class={`fixed top-0 left-0 right-0 select-none transition-colors ${
          videoMiniPlayerExpanded() ? "z-[1600]" : "z-[100]"
        } ${hovered() ? "bg-white/5" : ""}`}
        style={{ height: `${STRIP_HEIGHT_PX}px` }}
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
            void startDraggingWindow();
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", cleanup);
        }}
        onDblClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) {
            return;
          }
          void toggleMaximizeWindow();
        }}
      >
        <div class="flex items-center h-full pl-[10px]">
          {/* rounded semi-transparent backdrop so the dots keep contrast
              against light/bright window backgrounds behind the strip. */}
          <div class="flex items-center gap-2 px-[7px] py-[5px] rounded-lg bg-black/40">
            <button
              type="button"
              aria-label="close window"
              class={dotClass("bg-[#ff5f57]")}
              onClick={() => void closeWindow()}
            >
              <Show when={showGlyphs()}>
                <svg
                  viewBox="0 0 10 10"
                  class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[6px] h-[6px]"
                >
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
              class={dotClass("bg-[#ffbd2e]")}
              onClick={() => void minimizeWindow()}
            >
              <Show when={showGlyphs()}>
                <svg
                  viewBox="0 0 10 10"
                  class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[6px] h-[6px]"
                >
                  <path d="M1.5 5h7" stroke="#985712" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </Show>
            </button>
            <button
              type="button"
              aria-label="maximize window"
              class={dotClass("bg-[#28c840]")}
              onClick={() => void toggleMaximizeWindow()}
            >
              <Show when={showGlyphs()}>
                <svg
                  viewBox="0 0 10 10"
                  class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[6px] h-[6px]"
                >
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
      </div>
    </Show>
  );
}
