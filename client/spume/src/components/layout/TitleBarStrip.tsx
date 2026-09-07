import { createSignal, onMount, onCleanup, Show } from "solid-js";
import {
  getChromelessTitleBar,
  getTargetOs,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  startDraggingWindow,
  openSetupWizard,
  openAboutWindow,
  openDataFolder,
  getP2pStatus,
  startP2p,
  stopP2p,
  restartP2p,
  type P2pStatusResponse,
} from "../../app/services/charnel/commands";
import { videoMiniPlayerExpanded } from "../player/VideoMiniPlayer";
import { ContextMenu, ClickDropdownMenu, type MenuAction } from "../overlays/ContextMenu";
import { isNarrowViewport } from "../../config/breakpoints";

/**
 * height (px) reserved for the strip. also written to `--safe-area-top` so
 * every existing `--nav-height`/`--player-height`/popover max-height
 * consumer automatically reserves space for it (see theme.css) without any
 * per-view changes.
 */
const STRIP_HEIGHT_PX = 38;
// width of the pl-[10px] + 3 buttons (12px) + 2 gaps (8px) traffic-light cluster below.
const TRAFFIC_LIGHTS_WIDTH_PX = 80;
// width of the linux-chrome cluster: pl-[10px] + 4 buttons (20px, close/min/max/menu)
// + 3 gaps (8px) + backdrop padding (7px each side).
const LINUX_CHROME_WIDTH_PX = 132;
/** pointer movement (px) before a press on the strip becomes a window drag. */
const DRAG_THRESHOLD_PX = 4;

const STATIC_MENU_ACTIONS: MenuAction[] = [
  { label: "logs", onClick: () => void openSetupWizard("/logs") },
  { label: "library", onClick: () => void openSetupWizard("/library") },
  { label: "users", onClick: () => void openSetupWizard("/users") },
  { label: "radio", onClick: () => void openSetupWizard("/radio") },
  { label: "federation", onClick: () => void openSetupWizard("/federation") },
  { label: "settings", onClick: () => void openSetupWizard("/settings") },
  { label: "config", onClick: () => void openSetupWizard("/config") },
];

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
  const [resizeHovered, setResizeHovered] = createSignal(false);
  let beginResize: (() => void) | undefined;
  // narrow (mobile top nav) only shows the close dot (plus the hamburger menu
  // in linux-chrome mode) - the cluster's width stays fixed either way so the
  // drag handle + right-click context menu keep the same reserved space
  // regardless of button count.
  const [narrow, setNarrow] = createSignal(isNarrowViewport());
  const [p2pStatus, setP2pStatus] = createSignal<P2pStatusResponse | null>(null);
  const [targetOs, setTargetOs] = createSignal<string | null>(null);
  const isLinux = () => targetOs() === "linux";
  const useLinuxChrome = isLinux;

  const refreshP2pStatus = () => void getP2pStatus().then(setP2pStatus);

  const chromeMenuActions = (): MenuAction[] => {
    const status = p2pStatus();
    const actions: MenuAction[] = [
      { label: "about freqhole", onClick: () => void openAboutWindow() },
    ];

    if (status?.federationEnabled) {
      const canStart = status.status === "stopped" || status.status === "offline";
      const canStop = status.status !== "stopped" && status.status !== "starting...";
      actions.push(
        { type: "separator" },
        { label: `p2p: ${status.status}`, onClick: () => {}, disabled: true },
        { label: "start", onClick: () => void startP2p(), disabled: !canStart },
        { label: "stop", onClick: () => void stopP2p(), disabled: !canStop },
        { label: "restart", onClick: () => void restartP2p(), disabled: !canStop }
      );
    }

    actions.push(
      { type: "separator" },
      { label: "open data folder...", onClick: () => void openDataFolder() },
      { type: "separator" },
      ...STATIC_MENU_ACTIONS
    );
    return actions;
  };

  onMount(() => {
    let unlistenFocus: (() => void) | undefined;
    let appliedSafeAreaTop = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabled() || !(event.ctrlKey || event.metaKey) || event.key !== ",") return;
      event.preventDefault();
      void openSetupWizard("/settings");
    };
    window.addEventListener("keydown", onKeyDown);
    // recompute on a rAF tick rather than synchronously in the resize handler -
    // some webviews deliver `resize` a frame before layout/`innerWidth` has
    // actually settled, which can leave `narrow()` reading a stale value (a
    // likely contributor to the traffic-light cluster occasionally failing to
    // reflect narrow/wide state). also recompute on focus, since a resize that
    // happens while the window is unfocused/backgrounded can have its event
    // throttled or dropped entirely by the OS/webview.
    const recomputeNarrow = () => requestAnimationFrame(() => setNarrow(isNarrowViewport()));
    window.addEventListener("resize", recomputeNarrow);
    window.addEventListener("focus", recomputeNarrow);

    void (async () => {
      const [isChromeless, os] = await Promise.all([getChromelessTitleBar(), getTargetOs()]);
      if (!isChromeless) {
        return;
      }
      setTargetOs(os);
      setEnabled(true);
      recomputeNarrow();
      document.documentElement.style.setProperty("--safe-area-top", `${STRIP_HEIGHT_PX}px`);
      document.documentElement.style.setProperty("--chrome-top-inset", `${STRIP_HEIGHT_PX}px`);
      document.documentElement.style.setProperty(
        "--chrome-traffic-lights-inset",
        `${useLinuxChrome() ? LINUX_CHROME_WIDTH_PX : TRAFFIC_LIGHTS_WIDTH_PX}px`
      );
      appliedSafeAreaTop = true;

      try {
        // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        beginResize = () => {
          void win
            .startResizeDragging("SouthEast")
            .catch((error) => console.error("startResizeDragging failed:", error));
        };
        setFocused(await win.isFocused());
        unlistenFocus = await win.onFocusChanged(({ payload }) => setFocused(payload));
      } catch (error) {
        // non-tauri, or focus tracking unsupported - keep default focused styling
      }
    })();

    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", recomputeNarrow);
      window.removeEventListener("focus", recomputeNarrow);
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

  // linux-chrome (outline-style) buttons: dark grey, white border, magenta
  // accent on hover - deliberately not macOS-dot-shaped. `currentColor` on
  // each glyph inherits the button's own hover/focus text color, so hover
  // recolors the border AND the icon together with no extra classes needed
  // on the svg itself.
  const linuxButtonClass = () =>
    `relative w-[20px] h-[20px] rounded-[5px] border transition-colors ${
      focused()
        ? "bg-[#232323] border-white/50 text-white/80 hover:border-[var(--color-accent-500)] hover:text-[var(--color-accent-500)]"
        : "bg-[#1a1a1a] border-white/25 text-white/40"
    }`;
  const linuxIconClass =
    "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[11px] h-[11px] pointer-events-none";

  return (
    <Show when={enabled()}>
      <ContextMenu
        actions={chromeMenuActions()}
        onOpen={refreshP2pStatus}
        triggerClass={`block fixed top-0 left-0 right-0 ${
          videoMiniPlayerExpanded() ? "z-[1600]" : "z-[100]"
        }`}
      >
        <div
          // deliberately NO `data-tauri-drag-region`: tauri's own document-level
          // listener runs in the capture phase, so on linux it toggled maximize
          // from mousedown while our dblclick toggled it back. drag and
          // double-click are both handled here, identically on every platform.
          class={`fixed top-0 left-0 right-0 select-none transition-colors ${
            hovered() ? "bg-white/5" : ""
          }`}
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
              against light/bright window backgrounds behind the strip.
              linux-chrome buttons get nudged down a few px to line up
              better with the top nav's own items. */}
            <div
              class={`flex items-center gap-2 px-[7px] py-[5px] rounded-lg bg-black/40 ${
                useLinuxChrome() ? "mt-[4px]" : ""
              }`}
            >
              <Show
                when={useLinuxChrome()}
                fallback={
                  <>
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
                      classList={{ invisible: narrow() }}
                      onClick={() => void minimizeWindow()}
                    >
                      <Show when={showGlyphs() && !narrow()}>
                        <svg
                          viewBox="0 0 10 10"
                          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[6px] h-[6px]"
                        >
                          <path
                            d="M1.5 5h7"
                            stroke="#985712"
                            stroke-width="1.5"
                            stroke-linecap="round"
                          />
                        </svg>
                      </Show>
                    </button>
                    <button
                      type="button"
                      aria-label="maximize window"
                      class={dotClass("bg-[#28c840]")}
                      classList={{ invisible: narrow() }}
                      onClick={() => void toggleMaximizeWindow()}
                    >
                      <Show when={showGlyphs() && !narrow()}>
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
                  </>
                }
              >
                <button
                  type="button"
                  aria-label="close window"
                  class={linuxButtonClass()}
                  onClick={() => void closeWindow()}
                >
                  <svg viewBox="0 0 12 12" class={linuxIconClass}>
                    <path
                      d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                      stroke="currentColor"
                      stroke-width="1.4"
                      stroke-linecap="round"
                      fill="none"
                    />
                  </svg>
                </button>
                {/* min/max removed from the flex flow entirely (not just
                  `invisible`) when narrow, so the hamburger sits right next
                  to close instead of leaving a gap where they'd otherwise be. */}
                <Show when={!narrow()}>
                  <button
                    type="button"
                    aria-label="minimize window"
                    class={linuxButtonClass()}
                    onClick={() => void minimizeWindow()}
                  >
                    <svg viewBox="0 0 12 12" class={linuxIconClass}>
                      <path
                        d="M2.5 9h7"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                        fill="none"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="maximize window"
                    class={linuxButtonClass()}
                    onClick={() => void toggleMaximizeWindow()}
                  >
                    <svg viewBox="0 0 12 12" class={linuxIconClass}>
                      <rect
                        x="2.5"
                        y="2.5"
                        width="7"
                        height="7"
                        rx="1"
                        stroke="currentColor"
                        stroke-width="1.4"
                        fill="none"
                      />
                    </svg>
                  </button>
                </Show>
                {/* hamburger: opens the same flyout as right-clicking the
                  strip - always visible (wide and narrow), since right-click
                  isn't very discoverable and this is its only other entry
                  point. */}
                <ClickDropdownMenu
                  trigger={
                    <button type="button" aria-label="menu" class={linuxButtonClass()}>
                      <svg viewBox="0 0 12 12" class={linuxIconClass}>
                        <path
                          d="M2.5 3.5h7M2.5 6h7M2.5 8.5h7"
                          stroke="currentColor"
                          stroke-width="1.4"
                          stroke-linecap="round"
                        />
                      </svg>
                    </button>
                  }
                  actions={chromeMenuActions()}
                  onOpen={refreshP2pStatus}
                  align="left"
                />
              </Show>
            </div>
          </div>
        </div>
      </ContextMenu>
      {/* undecorated windows lose the window manager's own resize border,
       *  so give the corner back as a small hover-visible grip. */}
      <div
        class="fixed bottom-0 right-0 z-[100] w-4 h-4 cursor-nwse-resize"
        onMouseEnter={() => setResizeHovered(true)}
        onMouseLeave={() => setResizeHovered(false)}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          beginResize?.();
        }}
      >
        <Show when={resizeHovered()}>
          <svg viewBox="0 0 16 16" class="w-4 h-4 pointer-events-none">
            <path
              d="M14 2L2 14M14 8L8 14"
              stroke="var(--color-accent-500)"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </Show>
      </div>
    </Show>
  );
}
