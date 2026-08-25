import { createSignal, onCleanup, onMount } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import { debug } from "../../utils/logger";
import { isPlaying, pause, togglePlayback } from "../../music/services/audio/player";
import { pushModal, popModal } from "../../music/hooks/modals";

// delay before a click's play/pause toggle fires, so a second click
// arriving within the window can cancel it and fire fullscreen instead.
const CLICK_VS_DBLCLICK_DELAY_MS = 220;

// modal-stack id so pressing esc while expanded collapses it (and doesn't
// also trigger whatever's underneath, e.g. a graph view's own esc handler)
const EXPAND_MODAL_ID = "video-mini-player-expand";

export interface VideoMiniPlayerProps {
  /** the singleton `<video>` element owned by the video backend — moved
   * into this panel via DOM append (not recreated). */
  videoElement: HTMLVideoElement;
  /** called when the user closes the panel - the panel itself is hidden
   * by the caller (queue/playback is left untouched); see handleClose. */
  onClose?: () => void;
}

/** floating mini video player — sits above the player bar, anchored to
 * the right edge (clear of the scrollbar), above everything else in the
 * layout (modals, queue sidebar, context menus). mounts the shared,
 * singleton video element via `appendChild` (same technique as the old
 * in-bar `VideoThumbSlot`), so playback isn't interrupted by the move. */
export function VideoMiniPlayer(props: VideoMiniPlayerProps) {
  let mount!: HTMLDivElement;
  const [expanded, setExpanded] = createSignal(false);

  onMount(() => {
    const el = props.videoElement;
    debug("player.video", "VideoMiniPlayer mount", {
      readyState: el.readyState,
      paused: el.paused,
      hasParent: !!el.parentElement,
      currentParentTag: el.parentElement?.tagName,
    });
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.objectFit = "contain";
    if (mount && el.parentElement !== mount) {
      mount.appendChild(el);
      debug("player.video", "VideoMiniPlayer: moved video element into mini-player mount");
    }
  });

  // make sure we don't leave a dangling esc handler registered if this
  // unmounts (e.g. closed) while still expanded.
  onCleanup(() => {
    if (expanded()) popModal(EXPAND_MODAL_ID);
  });

  const requestFullscreen = () => {
    const el = props.videoElement;
    if (el.requestFullscreen) void el.requestFullscreen();
    else if ("webkitEnterFullscreen" in el) {
      (el as unknown as { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
    }
  };

  const toggleExpand = () => {
    setExpanded((was) => {
      const next = !was;
      if (next) pushModal(EXPAND_MODAL_ID, () => setExpanded(false));
      else popModal(EXPAND_MODAL_ID);
      return next;
    });
  };

  // pause (if playing) and hide the panel - does NOT touch the queue, so
  // playback can resume from the player bar and the panel reopens then.
  const handleClose = () => {
    if (isPlaying()) pause();
    props.onClose?.();
  };

  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });

  const handleClick = () => {
    if (clickTimer) return;
    clickTimer = setTimeout(() => {
      clickTimer = null;
      void togglePlayback();
    }, CLICK_VS_DBLCLICK_DELAY_MS);
  };

  const handleDblClick = () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    requestFullscreen();
  };

  return (
    <div
      class="fixed z-[1500] bg-black overflow-hidden group"
      classList={{
        "inset-x-0 wide:inset-x-auto wide:right-[66px] wide:w-96 lg:w-[28rem] xl:w-[36rem] 2xl:w-[40rem] aspect-video":
          !expanded(),
        "inset-0": expanded(),
      }}
      style={{
        bottom: "var(--player-bar-height, 0px)",
        ...(expanded()
          ? {}
          : {
              "box-shadow":
                "0 20px 60px -15px rgba(0, 0, 0, 0.9), 0 0 24px 4px rgba(255, 255, 255, 0.12)",
              // clip the shadow itself at the bottom edge (sits flush against
              // the player bar there) while letting it show on the other sides
              "clip-path": "inset(-40px -40px 0 -40px)",
            }),
      }}
    >
      <div
        ref={(el) => (mount = el)}
        class="w-full h-full cursor-pointer"
        onClick={handleClick}
        onDblClick={handleDblClick}
      />
      <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          class="bg-black/50 rounded p-1.5"
          onClick={toggleExpand}
          title={expanded() ? "collapse" : "expand"}
        >
          <Icon
            name={expanded() ? IconNames.collapseWindow : IconNames.expandWindow}
            size={16}
            className="text-white drop-shadow-lg"
          />
        </button>
        <button
          type="button"
          class="bg-black/50 rounded p-1.5"
          onClick={requestFullscreen}
          title="fullscreen"
        >
          <Icon name={IconNames.fullscreen} size={16} className="text-white drop-shadow-lg" />
        </button>
        <button type="button" class="bg-black/50 rounded p-1.5" onClick={handleClose} title="close">
          <Icon name={IconNames.close} size={16} className="text-white drop-shadow-lg" />
        </button>
      </div>
    </div>
  );
}
