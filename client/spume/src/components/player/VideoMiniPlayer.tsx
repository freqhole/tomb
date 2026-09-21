import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import { debug } from "../../utils/logger";
import { isTouchDevice } from "../../utils/isMobile";
import { useChromeSuppression } from "../../app/shell/chromeSuppression";
import {
  isPlaying as musicIsPlaying,
  pause as musicPause,
  togglePlayback as musicTogglePlayback,
} from "../../music/services/audio/player";

// delay before a click's play/pause toggle fires, so a second click
// arriving within the window can cancel it and fire fullscreen instead.
const CLICK_VS_DBLCLICK_DELAY_MS = 220;

// module-level (not per-instance) so TitleBarStrip can read it directly
// (it needs to render above the expanded player without touching every
// other z-indexed thing that already relies on beating the strip - see
// TitleBarStrip.tsx) and so the expanded/collapsed state survives an
// incidental remount of this component.
const [expanded, setExpanded] = createSignal(false);
export const videoMiniPlayerExpanded = expanded;

/** collapses an expanded mini player from outside this component - used
 * by the player bar's queue toggle on touch devices, where the queue
 * sidebar never renders above the expanded video anyway (see
 * AppLayout.tsx's handleQueueToggle). no-op if already collapsed. */
export function collapseVideoMiniPlayer(): void {
  setExpanded(false);
}

export interface VideoMiniPlayerProps {
  /** the singleton `<video>` element owned by the video backend — moved
   * into this panel via DOM append (not recreated). */
  videoElement: HTMLVideoElement;
  /** called when the user closes the panel - the panel itself is hidden
   * by the caller (queue/playback is left untouched); see handleClose. */
  onClose?: () => void;
  /** "floating" (default): the normal anchored-bottom-right panel used
   *  in AppLayout. "inline": fills its parent in-flow instead (no fixed
   *  positioning, no collapse/expand toggle, no close button) - used by
   *  CenotaphPlayerApp to show video in the same slot the now-playing
   *  artwork/qr code occupies. real browser fullscreen (the fullscreen
   *  button/double-click) works the same either way. */
  variant?: "floating" | "inline";
  /** overrides for the default (on-demand queue) music player's
   * isPlaying/togglePlayback/pause - lets radio's video-kind tracks reuse
   * this component with radioStatus()/radioResume()/radioPause() instead.
   * omitted (the non-radio, default queue-video case) keeps existing
   * behavior unchanged. */
  isPlaying?: () => boolean;
  onTogglePlayback?: () => void | Promise<void>;
  onPause?: () => void;
  /** hides the panel via CSS instead of unmounting it - unmounting here
   * (e.g. via a parent `<Show>` keyed on this) tears down the video
   * element's DOM position/reactive owner every time the user
   * dismisses/re-shows the panel, which is unnecessary churn for
   * something this is just a visibility toggle - see the module doc
   * comment for the full reasoning. omitted/false = visible. */
  hidden?: boolean;
  /** called when this panel unmounts (dismissed, or the underlying video
   * stops being active) - lets a caller whose video element must always
   * stay attached SOMEWHERE in the dom (radio's persistent sink; see its
   * ManagedMediaSource doc comments) move it back to a hidden parent
   * instead of leaving it orphaned. no-op for the default queue-video
   * case, which has no such requirement. */
  onElementDetach?: (el: HTMLVideoElement) => void;
}

/** floating mini video player — sits above the player bar, anchored to
 * the right edge (clear of the scrollbar), above everything else in the
 * layout (modals, queue sidebar, context menus). mounts the shared,
 * singleton video element via `appendChild` (same technique as the old
 * in-bar `VideoThumbSlot`), so playback isn't interrupted by the move. */
export function VideoMiniPlayer(props: VideoMiniPlayerProps) {
  let mount!: HTMLDivElement;
  // captured once, NOT read live via `props.videoElement` elsewhere - that
  // getter re-invokes the owning `<Show>`'s render-prop accessor on every
  // read (solid compiles JSX expression props as getters), which throws
  // "stale value from <Show>" if read from `onCleanup` - by definition
  // running while that same `<Show>` is mid-disposal. this prop never
  // legitimately changes for a given mounted instance, so a plain capture
  // is correct, not just a workaround.
  const videoEl = props.videoElement;
  const isInline = () => props.variant === "inline";
  const playing = () => (props.isPlaying ?? musicIsPlaying)();
  const doTogglePlayback = () => void (props.onTogglePlayback ?? musicTogglePlayback)();
  const doPause = () => (props.onPause ?? musicPause)();

  // hide the chromeless title-bar strip's stoplight buttons (show on
  // hover only) while this panel is expanded to fill the screen - an
  // expanded floating player is the one case that visually competes with
  // them; "inline" (kiosk) usage never expands, so it never suppresses.
  useChromeSuppression("video-mini-player", () => !isInline() && expanded());

  onCleanup(() => props.onElementDetach?.(videoEl));

  onMount(() => {
    const el = videoEl;
    debug("player.video", "VideoMiniPlayer mount", {
      readyState: el.readyState,
      paused: el.paused,
      hasParent: !!el.parentElement,
      currentParentTag: el.parentElement?.tagName,
    });
    // the radio hidden-sink styling (RadioAudioSink) sets `position:
    // absolute` + `clip: rect(0,0,0,0)` to stay invisible-but-laid-out;
    // `clip` only applies to absolutely/fixed-positioned elements, so
    // leaving `position: absolute` in place here (only width/height/
    // objectFit were ever reset) meant the clip rect kept zeroing out
    // the video's visible area even after appending it into a normal,
    // visible panel - audio decoded/played fine (clip doesn't affect
    // audio), but nothing ever painted. clear all three so the element
    // actually renders at its natural (now 100%/100%) size.
    el.style.removeProperty("position");
    el.style.removeProperty("clip");
    el.style.removeProperty("overflow");
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.objectFit = "contain";
    if (mount && el.parentElement !== mount) {
      mount.appendChild(el);
      debug("player.video", "VideoMiniPlayer: moved video element into mini-player mount");
    }
  });

  // android charnel: Element.requestFullscreen() on this WebView is
  // handled entirely as in-page CSS fullscreen - WebChromeClient.
  // onShowCustomView never fires for it, so the system status/gesture-nav
  // bars are never hidden natively. MainActivity.onWebViewCreate installs
  // a JS-callable bridge (SystemBarsBridge) for exactly this case; a no-op
  // everywhere else (desktop/iOS/plain web all leave window.AndroidSystemBars
  // undefined).
  onMount(() => {
    const androidSystemBars = (
      window as unknown as {
        AndroidSystemBars?: { hide: () => void; show: () => void };
      }
    ).AndroidSystemBars;
    if (!androidSystemBars) return;

    const handleFullscreenChange = () => {
      if (document.fullscreenElement) androidSystemBars.hide();
      else androidSystemBars.show();
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    onCleanup(() => document.removeEventListener("fullscreenchange", handleFullscreenChange));
  });

  // esc collapses the expanded view - a private listener, not the shared
  // global modal stack (pushing onto that stack would itself flip
  // `isAnyModalOpenReactive()` in AppLayout, which auto-dismisses this
  // very panel whenever "any modal" opens - collapsing right back to
  // closed the instant expand was pressed).
  createEffect(() => {
    if (!expanded()) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    onCleanup(() => window.removeEventListener("keydown", handleEscape));
  });

  const requestFullscreen = () => {
    const el = videoEl;
    console.info(
      "[player.video] requestFullscreen fired, has requestFullscreen:",
      !!el.requestFullscreen,
      "has webkitEnterFullscreen:",
      "webkitEnterFullscreen" in el
    );
    if (el.requestFullscreen) {
      el.requestFullscreen().catch((err: unknown) => {
        console.error("[fullscreen] requestFullscreen() rejected", err);
      });
    } else if ("webkitEnterFullscreen" in el) {
      (el as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
    } else {
      console.error("[fullscreen] no fullscreen API available on this element");
    }
  };

  const toggleExpand = () => {
    console.info("[player.video] toggleExpand fired, was", expanded());
    setExpanded((was) => !was);
  };

  // pause (if playing) and hide the panel - does NOT touch the queue, so
  // playback can resume from the player bar and the panel reopens then.
  const handleClose = () => {
    console.info("[player.video] handleClose fired, playing:", playing());
    if (playing()) doPause();
    props.onClose?.();
  };

  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });

  const handleClick = () => {
    console.info("[player.video] handleClick (single) fired");
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      doTogglePlayback();
    }, CLICK_VS_DBLCLICK_DELAY_MS);
  };

  const handleDblClick = () => {
    console.info("[player.video] handleDblClick fired");
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    requestFullscreen();
  };

  // shared button markup for both placements below - a touch device with
  // the panel collapsed renders these in a row above the video (no hover
  // affordance to reveal an overlay), everyone else gets the overlay.
  // inline (kiosk) usage skips the expand/collapse and close buttons -
  // there's no floating panel to collapse and nothing to close.
  const ControlButtons = () => (
    <>
      <Show when={!isInline()}>
        <button
          type="button"
          class="bg-black/50 rounded p-1.5"
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand();
          }}
          title={expanded() ? "collapse" : "expand"}
        >
          <Icon
            name={expanded() ? IconNames.collapseWindow : IconNames.expandWindow}
            size={16}
            className="text-white drop-shadow-lg"
          />
        </button>
      </Show>
      <button
        type="button"
        class="bg-black/50 rounded p-1.5"
        onClick={(e) => {
          e.stopPropagation();
          requestFullscreen();
        }}
        title="fullscreen"
      >
        <Icon name={IconNames.fullscreen} size={16} className="text-white drop-shadow-lg" />
      </button>
      <Show when={!isInline()}>
        <button
          type="button"
          class="bg-black/50 rounded p-1.5"
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
          title="close"
        >
          <Icon name={IconNames.close} size={16} className="text-white drop-shadow-lg" />
        </button>
      </Show>
    </>
  );

  // controls sit above the video (own row, no overlap) only when
  // collapsed on a touch device - expanded has no "above" space to move
  // into (the panel already fills the viewport), so it keeps the overlay.
  const controlsAboveVideo = () => !isInline() && isTouchDevice() && !expanded();

  return (
    <div
      class={isInline() ? "relative w-full h-full" : "fixed z-[1500] flex flex-col"}
      classList={
        isInline()
          ? {}
          : {
              "inset-x-0 wide:inset-x-auto wide:right-[66px] wide:w-96 lg:w-[28rem] xl:w-[36rem] 2xl:w-[40rem]":
                !expanded(),
              "inset-0": expanded(),
            }
      }
      // inline style (not a `hidden`/`display:none` class) - guaranteed to
      // win regardless of tailwind's utility ordering, unlike relying on
      // class-vs-class specificity against the "flex"/"fixed" classes above.
      style={{
        ...(isInline() ? {} : { bottom: "var(--player-bar-height, 0px)" }),
        ...(props.hidden ? { display: "none" } : {}),
      }}
    >
      <Show when={controlsAboveVideo()}>
        <div class="flex justify-end pb-1.5">
          <div class="flex items-center gap-1 bg-black/40 rounded-lg p-1">
            <ControlButtons />
          </div>
        </div>
      </Show>
      <div
        class="relative bg-black overflow-hidden group"
        classList={
          isInline()
            ? { "w-full h-full rounded-lg": true }
            : { "aspect-video": !expanded(), "h-full": expanded() }
        }
        style={
          isInline() || expanded()
            ? {}
            : {
                "box-shadow":
                  "0 20px 60px -15px rgba(0, 0, 0, 0.9), 0 0 24px 4px rgba(255, 255, 255, 0.12)",
                // clip the shadow itself at the bottom edge (sits flush against
                // the player bar there) while letting it show on the other sides
                "clip-path": "inset(-40px -40px 0 -40px)",
              }
        }
      >
        <div
          ref={(el) => (mount = el)}
          class="w-full h-full cursor-pointer"
          onClick={handleClick}
          onDblClick={handleDblClick}
        />
        <Show when={!controlsAboveVideo()}>
          <div
            class="absolute right-2 flex items-center gap-1"
            classList={{
              // hover has no touch equivalent - keep the controls always
              // visible on touch devices instead of hiding them behind an
              // unreachable hover state.
              "opacity-100": isTouchDevice() || isInline(),
              "opacity-0 group-hover:opacity-100 transition-opacity":
                !isTouchDevice() && !isInline(),
            }}
            style={{
              // while expanded, the chromeless title-bar strip renders above
              // this panel (see TitleBarStrip.tsx) - drop below its height so
              // it doesn't cover these buttons. --chrome-top-inset is 0 when
              // the strip isn't active (non-mac/non-tauri), so this is a
              // no-op there.
              top:
                !isInline() && expanded()
                  ? "calc(0.5rem + var(--chrome-top-inset, 0px))"
                  : "0.5rem",
            }}
          >
            <ControlButtons />
          </div>
        </Show>
      </div>
    </div>
  );
}
