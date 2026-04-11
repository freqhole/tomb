// bin media controller — manages audio/video playback for compact cards in bins.
//
// when a file widget with domain "audio" or "video" is rendered as a compact
// card inside a bin, this controller adds:
//   - a play/pause icon overlay on the card thumbnail
//   - hover behavior to show/hide the overlay
//   - tap-to-play/pause via the audioManager (audio) or DOM <video> (video)
//   - double-tap to enter fullscreen (video)
//
// the controller is created per-bin and manages all media cards within that bin.

import { Container, Graphics } from "pixi.js";
import { audioManager, getMediaPlaybackUrl } from "../../src/media";
import type { RenderedCard } from "./bin-types";

const TAG = "[bin-media]";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** check whether a CompactInfo represents a playable media type */
export function isMediaDomain(domain?: string): boolean {
  return domain === "audio" || domain === "video";
}

// ---------------------------------------------------------------------------
// overlay creation
// ---------------------------------------------------------------------------

/** parts of a media overlay — stored so we can toggle play/pause icon */
export interface MediaOverlayParts {
  overlay: Container;
  playIcon: Graphics;
  pauseIcon: Graphics;
}

/**
 * create a media overlay container with play and pause icons.
 * the overlay is hidden by default and has eventMode "none" so it
 * doesn't consume pointer events (the card handles those).
 */
export function createMediaOverlay(w: number, h: number, rounded = true): MediaOverlayParts {
  const overlay = new Container();
  overlay.label = "media-overlay";
  overlay.visible = false;
  overlay.eventMode = "none";

  // semi-transparent background
  const bg = new Graphics();
  if (rounded) {
    bg.roundRect(0, 0, w, h, 3).fill({ color: 0x000000, alpha: 0.5 });
  } else {
    bg.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.5 });
  }
  overlay.addChild(bg);

  const iconSize = Math.max(12, Math.min(w, h) * 0.35);
  const cx = w / 2;
  const cy = h / 2;

  // play icon — triangle pointing right
  const playIcon = new Graphics();
  const triH = iconSize;
  const triW = iconSize * 0.866;
  playIcon.poly([
    { x: cx - triW / 3, y: cy - triH / 2 },
    { x: cx + (triW * 2) / 3, y: cy },
    { x: cx - triW / 3, y: cy + triH / 2 },
  ]);
  playIcon.fill({ color: 0xffffff, alpha: 0.9 });
  overlay.addChild(playIcon);

  // pause icon — two vertical bars
  const pauseIcon = new Graphics();
  const barW = iconSize * 0.2;
  const barH = iconSize * 0.7;
  const gap = iconSize * 0.15;
  pauseIcon.rect(cx - gap - barW, cy - barH / 2, barW, barH);
  pauseIcon.fill({ color: 0xffffff, alpha: 0.9 });
  pauseIcon.rect(cx + gap, cy - barH / 2, barW, barH);
  pauseIcon.fill({ color: 0xffffff, alpha: 0.9 });
  pauseIcon.visible = false;
  overlay.addChild(pauseIcon);

  return { overlay, playIcon, pauseIcon };
}

/** show the play icon and hide pause */
export function showPlayIcon(parts: MediaOverlayParts): void {
  parts.playIcon.visible = true;
  parts.pauseIcon.visible = false;
}

/** show the pause icon and hide play */
export function showPauseIcon(parts: MediaOverlayParts): void {
  parts.playIcon.visible = false;
  parts.pauseIcon.visible = true;
}

// ---------------------------------------------------------------------------
// video tracker — positions a DOM <video> over a PixiJS card
// ---------------------------------------------------------------------------

interface VideoTracker {
  video: HTMLVideoElement;
  wrapper: HTMLDivElement;
  widgetId: string;
  rafId: number;
  close: () => void;
}

function createVideoTracker(
  src: string,
  mime: string | undefined,
  card: RenderedCard,
  canvasElement: HTMLCanvasElement,
  /** width/height of the thumbnail area in local coords */
  thumbW: number,
  thumbH: number
): VideoTracker {
  const wrapper = document.createElement("div");
  const ws = wrapper.style;
  ws.position = "fixed";
  ws.zIndex = "15000";
  ws.pointerEvents = "none"; // let pixi handle pointer events
  ws.overflow = "hidden";
  ws.backgroundColor = "rgba(0,0,0,0.9)";
  ws.borderRadius = "3px";

  const video = document.createElement("video");
  video.src = src;
  if (mime) video.setAttribute("type", mime);
  video.playsInline = true;
  video.muted = false;
  video.loop = true;
  const vs = video.style;
  vs.width = "100%";
  vs.height = "100%";
  vs.objectFit = "cover";
  vs.display = "block";
  vs.borderRadius = "3px";
  vs.outline = "none";
  vs.pointerEvents = "none";
  wrapper.appendChild(video);

  document.body.appendChild(wrapper);

  let closed = false;
  let rafId = 0;

  // track last values to avoid redundant DOM updates
  let lastX = -1;
  let lastY = -1;
  let lastW = -1;
  let lastH = -1;

  const track = (): void => {
    if (closed) return;

    const container = card.container;
    if (!container || container.destroyed) {
      close();
      return;
    }

    const globalPos = container.toGlobal({ x: 0, y: 0 });
    const globalEnd = container.toGlobal({ x: thumbW, y: thumbH });
    const rect = canvasElement.getBoundingClientRect();

    const screenX = Math.round(rect.left + globalPos.x);
    const screenY = Math.round(rect.top + globalPos.y);
    const screenW = Math.round(globalEnd.x - globalPos.x);
    const screenH = Math.round(globalEnd.y - globalPos.y);

    if (screenX !== lastX || screenY !== lastY || screenW !== lastW || screenH !== lastH) {
      ws.left = `${screenX}px`;
      ws.top = `${screenY}px`;
      ws.width = `${screenW}px`;
      ws.height = `${screenH}px`;
      lastX = screenX;
      lastY = screenY;
      lastW = screenW;
      lastH = screenH;
    }

    // hide if off-screen
    const canvasRight = Math.round(rect.left + rect.width);
    const canvasBottom = Math.round(rect.top + rect.height);
    const visible =
      screenX + screenW > Math.round(rect.left) &&
      screenY + screenH > Math.round(rect.top) &&
      screenX < canvasRight &&
      screenY < canvasBottom;
    ws.display = visible ? "block" : "none";

    rafId = requestAnimationFrame(track);
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (rafId) cancelAnimationFrame(rafId);
    video.pause();
    video.removeAttribute("src");
    video.load();
    wrapper.remove();
  };

  // start tracking
  rafId = requestAnimationFrame(track);

  return { video, wrapper, widgetId: card.widgetId, rafId, close };
}

// ---------------------------------------------------------------------------
// BinMediaController
// ---------------------------------------------------------------------------

export class BinMediaController {
  private canvasElement: HTMLCanvasElement;
  private getCard: (widgetId: string) => RenderedCard | undefined;
  private getPeers: () => Record<string, { nodeId: string }> | undefined;

  /** the widget currently playing audio */
  private audioPlayingId: string | null = null;
  /** the widget currently playing video */
  private videoTracker: VideoTracker | null = null;

  /** set of widget IDs that have hover listeners attached */
  private attachedCards = new Set<string>();
  /** stored overlay parts per widget ID (for icon toggling) */
  private overlayParts = new Map<string, MediaOverlayParts>();

  /** unsub functions for audioManager events */
  private unsubs: Array<() => void> = [];

  /** double-tap detection */
  private lastTapTime = 0;
  private lastTapWidgetId = "";
  private readonly DOUBLE_TAP_MS = 400;

  private destroyed = false;

  constructor(opts: {
    canvasElement: HTMLCanvasElement;
    getCard: (widgetId: string) => RenderedCard | undefined;
    getPeers: () => Record<string, { nodeId: string }> | undefined;
  }) {
    this.canvasElement = opts.canvasElement;
    this.getCard = opts.getCard;
    this.getPeers = opts.getPeers;

    // subscribe to audioManager events
    this.unsubs.push(
      audioManager.on("ended", () => this.onAudioEnded()),
      audioManager.on("stop", () => this.onAudioStopped()),
      audioManager.on("play", () => this.onAudioPlay()),
      audioManager.on("pause", () => this.onAudioPause())
    );
  }

  // -----------------------------------------------------------------------
  // public API — called by the bin renderer/index
  // -----------------------------------------------------------------------

  /**
   * attach media overlay + hover behavior to a card.
   * called after a card is built or rebuilt.
   * safe to call for non-media cards (returns immediately).
   */
  attachToCard(card: RenderedCard): void {
    if (this.destroyed) return;
    if (!card.mediaDomain || !isMediaDomain(card.mediaDomain)) return;

    // remove any previous attachment for this widget
    this.detachFromCard(card.widgetId);

    const overlay = card.mediaOverlay;
    if (!overlay) return;

    // find the overlay parts (play/pause icons) from the overlay container
    const parts = this.findOverlayParts(overlay);
    if (!parts) return;

    this.overlayParts.set(card.widgetId, parts);

    // set initial icon state — if this card's audio is currently playing,
    // show the pause icon and keep the overlay visible
    const isPlayingAudio =
      card.mediaDomain === "audio" &&
      this.audioPlayingId === card.widgetId &&
      audioManager.isPlaying;

    const isPlayingVideo =
      card.mediaDomain === "video" && this.videoTracker?.widgetId === card.widgetId;

    if (isPlayingAudio || isPlayingVideo) {
      showPauseIcon(parts);
      overlay.visible = true;
    } else {
      showPlayIcon(parts);
      overlay.visible = false;
    }

    // hover handlers
    const onEnter = (): void => {
      if (card.container.destroyed) return;
      overlay.visible = true;
    };

    const onLeave = (): void => {
      if (card.container.destroyed) return;
      // keep visible if currently playing
      const playing =
        (card.mediaDomain === "audio" &&
          this.audioPlayingId === card.widgetId &&
          audioManager.isPlaying) ||
        (card.mediaDomain === "video" && this.videoTracker?.widgetId === card.widgetId);
      if (!playing) {
        overlay.visible = false;
      }
    };

    card.container.on("pointerenter", onEnter);
    card.container.on("pointerleave", onLeave);

    this.attachedCards.add(card.widgetId);
  }

  /**
   * clean up media state for a removed card.
   * stops playback if this card was playing.
   */
  detachFromCard(widgetId: string): void {
    this.overlayParts.delete(widgetId);
    this.attachedCards.delete(widgetId);

    // stop audio if this card was playing
    if (this.audioPlayingId === widgetId) {
      audioManager.stop();
      this.audioPlayingId = null;
    }

    // stop video if this card was playing
    if (this.videoTracker?.widgetId === widgetId) {
      this.videoTracker.close();
      this.videoTracker = null;
    }
  }

  /**
   * handle a tap on a card.
   * returns true if this was a media card and the tap was handled.
   */
  handleTap(widgetId: string): boolean {
    const card = this.getCard(widgetId);
    if (!card || !card.mediaDomain || !isMediaDomain(card.mediaDomain)) {
      return false;
    }

    // double-tap detection
    const now = Date.now();
    const isDoubleTap =
      this.lastTapWidgetId === widgetId && now - this.lastTapTime < this.DOUBLE_TAP_MS;
    this.lastTapTime = now;
    this.lastTapWidgetId = widgetId;

    if (isDoubleTap && card.mediaDomain === "video") {
      this.handleVideoFullscreen();
      return true;
    }

    if (card.mediaDomain === "audio") {
      this.handleAudioTap(widgetId, card);
    } else if (card.mediaDomain === "video") {
      this.handleVideoTap(widgetId, card);
    }

    return true;
  }

  /** tear down everything */
  destroy(): void {
    this.destroyed = true;

    // unsub from audioManager events
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs.length = 0;

    // stop any active playback
    if (this.audioPlayingId) {
      // only stop if we own the current playback
      if (audioManager.isCurrentBlob(this.audioPlayingId)) {
        audioManager.stop();
      }
      this.audioPlayingId = null;
    }

    if (this.videoTracker) {
      this.videoTracker.close();
      this.videoTracker = null;
    }

    this.overlayParts.clear();
    this.attachedCards.clear();
  }

  // -----------------------------------------------------------------------
  // audio handling
  // -----------------------------------------------------------------------

  private async handleAudioTap(widgetId: string, card: RenderedCard): Promise<void> {
    const blobId = card.mediaBlobId;
    if (!blobId) return;

    // if this card is already playing, toggle pause
    if (this.audioPlayingId === widgetId && audioManager.isCurrentBlob(blobId)) {
      await audioManager.togglePlayPause();
      return;
    }

    // stop any video that might be playing
    if (this.videoTracker) {
      this.videoTracker.close();
      this.videoTracker = null;
      this.updateVideoCardIcon(null);
    }

    // clear previous audio card's icon
    const prevId = this.audioPlayingId;
    this.audioPlayingId = widgetId;

    if (prevId && prevId !== widgetId) {
      this.setCardIcon(prevId, "play");
    }

    // show loading state (pause icon = "active")
    this.setCardIcon(widgetId, "pause");
    this.setOverlayVisible(widgetId, true);

    const peers = this.getPeers();
    const ok = await audioManager.playBlob(blobId, {
      category: "audio",
      peers,
      mime: card.mediaMime ?? undefined,
    });

    if (!ok) {
      console.warn(TAG, "failed to play audio for card:", widgetId);
      this.audioPlayingId = null;
      this.setCardIcon(widgetId, "play");
    }
  }

  private onAudioPlay(): void {
    if (this.audioPlayingId) {
      this.setCardIcon(this.audioPlayingId, "pause");
      this.setOverlayVisible(this.audioPlayingId, true);
    }
  }

  private onAudioPause(): void {
    if (this.audioPlayingId) {
      this.setCardIcon(this.audioPlayingId, "play");
      // keep overlay visible so the user can tap to resume
      this.setOverlayVisible(this.audioPlayingId, true);
    }
  }

  private onAudioEnded(): void {
    if (this.audioPlayingId) {
      this.setCardIcon(this.audioPlayingId, "play");
      this.setOverlayVisible(this.audioPlayingId, false);
      this.audioPlayingId = null;
    }
  }

  private onAudioStopped(): void {
    if (this.audioPlayingId) {
      this.setCardIcon(this.audioPlayingId, "play");
      this.setOverlayVisible(this.audioPlayingId, false);
      this.audioPlayingId = null;
    }
  }

  // -----------------------------------------------------------------------
  // video handling
  // -----------------------------------------------------------------------

  private async handleVideoTap(widgetId: string, card: RenderedCard): Promise<void> {
    const blobId = card.mediaBlobId;
    if (!blobId) return;

    // if this card is already playing video, toggle pause
    if (this.videoTracker?.widgetId === widgetId) {
      const video = this.videoTracker.video;
      if (video.paused) {
        try {
          await video.play();
        } catch {
          /* ignore */
        }
        this.setCardIcon(widgetId, "pause");
      } else {
        video.pause();
        this.setCardIcon(widgetId, "play");
        this.setOverlayVisible(widgetId, true);
      }
      return;
    }

    // stop any previous video
    if (this.videoTracker) {
      const prevId = this.videoTracker.widgetId;
      this.videoTracker.close();
      this.videoTracker = null;
      this.setCardIcon(prevId, "play");
      this.setOverlayVisible(prevId, false);
    }

    // stop any audio
    if (this.audioPlayingId) {
      const prevId = this.audioPlayingId;
      audioManager.stop();
      this.audioPlayingId = null;
      this.setCardIcon(prevId, "play");
      this.setOverlayVisible(prevId, false);
    }

    // resolve the media URL
    const peers = this.getPeers();
    const src = await getMediaPlaybackUrl(blobId, {
      category: "video",
      peers,
      mime: card.mediaMime ?? undefined,
    });

    if (!src) {
      console.warn(TAG, "failed to resolve video URL for card:", widgetId);
      return;
    }

    // determine thumbnail area dimensions based on the card's media overlay size
    // the overlay covers the thumbnail area, so use its dimensions
    const overlayBounds = card.mediaOverlay;
    const thumbW = overlayBounds ? overlayBounds.width : 100;
    const thumbH = overlayBounds ? overlayBounds.height : 100;

    this.videoTracker = createVideoTracker(
      src,
      card.mediaMime ?? undefined,
      card,
      this.canvasElement,
      thumbW,
      thumbH
    );

    // start playback
    try {
      await this.videoTracker.video.play();
      this.setCardIcon(widgetId, "pause");
      // hide the pixi overlay while video is playing — the DOM video covers it
      this.setOverlayVisible(widgetId, false);
    } catch (err) {
      console.warn(TAG, "video play failed:", err);
      this.videoTracker.close();
      this.videoTracker = null;
      this.setCardIcon(widgetId, "play");
    }
  }

  private handleVideoFullscreen(): void {
    if (!this.videoTracker) return;
    const video = this.videoTracker.video;
    try {
      if (video.requestFullscreen) {
        video.requestFullscreen().catch(() => {});
      } else if ((video as any).webkitRequestFullscreen) {
        (video as any).webkitRequestFullscreen();
      }
    } catch {
      /* ignore fullscreen errors */
    }
  }

  /** update the video card's icon after it's been closed */
  private updateVideoCardIcon(widgetId: string | null): void {
    if (widgetId) {
      this.setCardIcon(widgetId, "play");
      this.setOverlayVisible(widgetId, false);
    }
  }

  // -----------------------------------------------------------------------
  // icon management
  // -----------------------------------------------------------------------

  private setCardIcon(widgetId: string, icon: "play" | "pause"): void {
    const parts = this.overlayParts.get(widgetId);
    if (!parts) return;
    if (icon === "play") {
      showPlayIcon(parts);
    } else {
      showPauseIcon(parts);
    }
  }

  private setOverlayVisible(widgetId: string, visible: boolean): void {
    const card = this.getCard(widgetId);
    if (!card?.mediaOverlay) return;
    card.mediaOverlay.visible = visible;
  }

  /**
   * find the play/pause icon graphics inside a media overlay container.
   * the overlay is built by createMediaOverlay() which adds children in order:
   * [0] bg, [1] playIcon, [2] pauseIcon
   */
  private findOverlayParts(overlay: Container): MediaOverlayParts | null {
    if (overlay.children.length < 3) return null;
    const playIcon = overlay.children[1] as Graphics;
    const pauseIcon = overlay.children[2] as Graphics;
    return { overlay, playIcon, pauseIcon };
  }
}
