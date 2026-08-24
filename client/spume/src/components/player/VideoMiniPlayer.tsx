import { createSignal, onCleanup, onMount } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import { debug } from "../../utils/logger";
import { togglePlayback } from "../../music/services/audio/player";
import { appState } from "../../app/services/storage/db";
import { mediaItemKey } from "../../app/services/storage/mediaItem";
import { removeFromQueue } from "../../music/services/queue/queue";
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
}

/** floating mini video player — sits above the player bar, pinned to the
 * right (same width as the queue sidebar), above everything else in the
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

  // stop playback and drop the current video from the queue entirely
  const handleClose = () => {
    const state = appState();
    if (!state) return;
    const index = state.queue.findIndex((item) => mediaItemKey(item) === state.current_sha256);
    if (index >= 0) void removeFromQueue(index);
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
        "inset-x-0 wide:inset-x-auto wide:right-3 wide:w-72 lg:w-80 xl:w-96 aspect-video":
          !expanded(),
        "inset-0": expanded(),
      }}
      style={{
        bottom: "var(--player-bar-height, 0px)",
        ...(expanded()
          ? {}
          : {
              "box-shadow":
                "0 20px 60px -15px rgba(0, 0, 0, 0.8), 0 0 32px 6px rgba(255, 26, 158, 0.55)",
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
