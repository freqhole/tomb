/**
 * inline media player for video and audio, positioned over a PixiJS widget.
 *
 * creates a real DOM <video> or <audio> element with position: fixed,
 * tracked by a requestAnimationFrame loop so it follows the widget as the
 * canvas pans and zooms. used by the file widget for inline playback.
 *
 * photos do NOT use this — they stay in the full-screen overlay from
 * media-overlay.ts because viewing a photo inline at widget scale isn't useful.
 */

import type { Container } from "pixi.js";

export interface InlinePlayerOptions {
  /** type of media to play */
  type: "video" | "audio";
  /** source URL (data:, blob:, or asset:// URL) */
  src: string;
  /** MIME type */
  mime?: string;
  /** PixiJS container to position over (the widget's root container) */
  container: Container;
  /** the canvas DOM element for coordinate conversion */
  canvasElement: HTMLCanvasElement;
  /** width in PixiJS local coordinates (the widget width) */
  width: number;
  /** height in PixiJS local coordinates (the widget height) */
  height: number;
  /** called when the user closes the player or it's torn down */
  onClose?: () => void;
}

export interface InlinePlayerHandle {
  /** update the tracked widget size (call from the widget's resize()) */
  reposition(width: number, height: number): void;
  /** close the player and clean up */
  close(): void;
  /** true after close() has been called */
  readonly closed: boolean;
}

/**
 * create an inline media player positioned over a PixiJS container.
 *
 * the player is appended to document.body with position: fixed and tracks
 * the container's screen position via a requestAnimationFrame loop, so it
 * stays in sync as the canvas pans and zooms.
 *
 * dismiss via:
 * - clicking the close button
 * - pressing Escape
 *
 * close() removes all DOM elements, detaches all event listeners, cancels
 * the rAF loop, and stops media playback. safe to call multiple times
 * (idempotent).
 */
export function createInlinePlayer(options: InlinePlayerOptions): InlinePlayerHandle {
  const { type, src, mime, container, canvasElement, onClose } = options;

  let _closed = false;
  let localWidth = options.width;
  let localHeight = options.height;

  // track last applied screen values to avoid redundant DOM style updates
  let lastScreenX = -1;
  let lastScreenY = -1;
  let lastScreenW = -1;
  let lastScreenH = -1;
  let lastVisible = true;

  let rafId = 0;

  // track media element for teardown
  let mediaEl: HTMLVideoElement | HTMLAudioElement | null = null;

  // ---------------------------------------------------------------------------
  // wrapper — position: fixed container for the player
  // ---------------------------------------------------------------------------

  const wrapper = document.createElement("div");
  const ws = wrapper.style;
  ws.position = "fixed";
  ws.zIndex = "15000";
  ws.pointerEvents = "auto";
  ws.display = "flex";
  ws.alignItems = "center";
  ws.justifyContent = "center";
  ws.overflow = "hidden";
  ws.backgroundColor = "rgba(0, 0, 0, 0.9)";
  ws.borderRadius = "2px";
  ws.boxSizing = "border-box";

  // ---------------------------------------------------------------------------
  // close button
  // ---------------------------------------------------------------------------

  const closeBtn = document.createElement("div");
  closeBtn.textContent = "\u00D7"; // multiplication sign (x)
  const cbs = closeBtn.style;
  cbs.position = "absolute";
  cbs.top = "4px";
  cbs.right = "6px";
  cbs.color = "#ffffff";
  cbs.fontSize = "22px";
  cbs.fontFamily = "system-ui, sans-serif";
  cbs.fontWeight = "300";
  cbs.lineHeight = "1";
  cbs.cursor = "pointer";
  cbs.userSelect = "none";
  cbs.zIndex = "15001";

  wrapper.appendChild(closeBtn);

  // ---------------------------------------------------------------------------
  // media element
  // ---------------------------------------------------------------------------

  if (type === "video") {
    const video = document.createElement("video");
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    if (mime) video.setAttribute("type", mime);
    const vs = video.style;
    vs.width = "100%";
    vs.height = "100%";
    vs.objectFit = "contain";
    vs.display = "block";
    vs.borderRadius = "2px";
    vs.outline = "none";
    mediaEl = video;
    wrapper.appendChild(video);
  } else if (type === "audio") {
    const audio = document.createElement("audio");
    audio.src = src;
    audio.controls = true;
    audio.autoplay = true;
    if (mime) audio.setAttribute("type", mime);
    const as_ = audio.style;
    as_.display = "block";
    as_.maxWidth = "100%";
    as_.outline = "none";
    mediaEl = audio;
    wrapper.appendChild(audio);
  }

  // ---------------------------------------------------------------------------
  // rAF tracking loop — keeps the wrapper in sync with the PixiJS container
  // ---------------------------------------------------------------------------

  const track = (): void => {
    if (_closed) return;

    const globalPos = container.toGlobal({ x: 0, y: 0 });
    const globalEnd = container.toGlobal({ x: localWidth, y: localHeight });
    const rect = canvasElement.getBoundingClientRect();

    const screenX = Math.round(rect.left + globalPos.x);
    const screenY = Math.round(rect.top + globalPos.y);
    const screenW = Math.round(globalEnd.x - globalPos.x);
    const screenH = Math.round(globalEnd.y - globalPos.y);

    // check if the widget is entirely outside the canvas viewport
    const canvasRight = Math.round(rect.left + rect.width);
    const canvasBottom = Math.round(rect.top + rect.height);
    const visible =
      screenX + screenW > Math.round(rect.left) &&
      screenY + screenH > Math.round(rect.top) &&
      screenX < canvasRight &&
      screenY < canvasBottom;

    // update visibility if changed
    if (visible !== lastVisible) {
      ws.display = visible ? "flex" : "none";
      lastVisible = visible;
    }

    // only update position/size styles if values actually changed
    if (
      screenX !== lastScreenX ||
      screenY !== lastScreenY ||
      screenW !== lastScreenW ||
      screenH !== lastScreenH
    ) {
      ws.left = `${screenX}px`;
      ws.top = `${screenY}px`;
      ws.width = `${screenW}px`;
      ws.height = `${screenH}px`;
      lastScreenX = screenX;
      lastScreenY = screenY;
      lastScreenW = screenW;
      lastScreenH = screenH;
    }

    rafId = requestAnimationFrame(track);
  };

  // ---------------------------------------------------------------------------
  // teardown
  // ---------------------------------------------------------------------------

  const close = (): void => {
    if (_closed) return;
    _closed = true;

    // cancel tracking loop
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    // stop playback and unload
    if (mediaEl) {
      mediaEl.pause();
      mediaEl.removeAttribute("src");
      mediaEl.load();
    }

    // detach event listeners
    closeBtn.removeEventListener("click", handleCloseClick);
    document.removeEventListener("keydown", handleKeyDown, true);

    // remove from DOM
    wrapper.remove();

    onClose?.();
  };

  // ---------------------------------------------------------------------------
  // event handlers
  // ---------------------------------------------------------------------------

  const handleCloseClick = (e: MouseEvent): void => {
    e.stopPropagation();
    close();
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    // stop propagation so canvas shortcuts don't fire while player is open
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  closeBtn.addEventListener("click", handleCloseClick);
  // use capture phase so we intercept before anything else
  document.addEventListener("keydown", handleKeyDown, true);

  // ---------------------------------------------------------------------------
  // mount and start tracking
  // ---------------------------------------------------------------------------

  document.body.appendChild(wrapper);
  rafId = requestAnimationFrame(track);

  // ---------------------------------------------------------------------------
  // public handle
  // ---------------------------------------------------------------------------

  return {
    reposition(width: number, height: number): void {
      localWidth = width;
      localHeight = height;
      // the rAF loop will pick up the new dimensions on the next frame
    },

    close,

    get closed(): boolean {
      return _closed;
    },
  };
}
