/**
 * full-screen DOM overlay for media previews (photo, video, audio).
 *
 * creates a modal backdrop over the entire viewport with the media element
 * centered. used by the file widget to show full-screen previews when users
 * click on thumbnails.
 *
 * unlike dom-overlay.ts (which handles text input positioned over PixiJS
 * containers), this overlay is a standalone full-screen modal for viewing
 * media content.
 */

export interface MediaOverlayOptions {
  /** type of media to display */
  type: "photo" | "video" | "audio";
  /** source URL for the media (data URL, blob URL, or asset:// URL) */
  src: string;
  /** original filename for display */
  filename?: string;
  /** MIME type */
  mime?: string;
  /** optional waveform image URL for audio overlay */
  waveformSrc?: string;
  /** called when the overlay is dismissed */
  onClose?: () => void;
}

export interface MediaOverlayHandle {
  /** close the overlay and clean up */
  close(): void;
  /** true after close() has been called */
  readonly closed: boolean;
}

/**
 * create a full-screen media preview overlay.
 *
 * the overlay is appended to document.body with position: fixed and a high
 * z-index so it floats above everything including dom-overlay text inputs.
 *
 * dismiss via:
 * - clicking the close button
 * - clicking the backdrop (outside the media element)
 * - pressing Escape
 *
 * close() removes all DOM elements, detaches all event listeners, and stops
 * any active media playback. safe to call multiple times (idempotent).
 */
export function createMediaOverlay(options: MediaOverlayOptions): MediaOverlayHandle {
  const { type, src, filename, mime, waveformSrc, onClose } = options;

  let _closed = false;

  // ---------------------------------------------------------------------------
  // backdrop
  // ---------------------------------------------------------------------------

  const backdrop = document.createElement("div");
  const bs = backdrop.style;
  bs.position = "fixed";
  bs.top = "0";
  bs.left = "0";
  bs.width = "100vw";
  bs.height = "100vh";
  bs.backgroundColor = "rgba(0, 0, 0, 0.85)";
  bs.zIndex = "20000";
  bs.display = "flex";
  bs.alignItems = "center";
  bs.justifyContent = "center";
  bs.flexDirection = "column";
  bs.margin = "0";
  bs.padding = "0";

  // ---------------------------------------------------------------------------
  // close button
  // ---------------------------------------------------------------------------

  const closeBtn = document.createElement("div");
  closeBtn.textContent = "\u00D7"; // multiplication sign (x)
  const cbs = closeBtn.style;
  cbs.position = "absolute";
  cbs.top = "16px";
  cbs.right = "24px";
  cbs.color = "#ffffff";
  cbs.fontSize = "36px";
  cbs.fontFamily = "system-ui, sans-serif";
  cbs.fontWeight = "300";
  cbs.lineHeight = "1";
  cbs.cursor = "pointer";
  cbs.userSelect = "none";
  cbs.zIndex = "20001";

  backdrop.appendChild(closeBtn);

  // ---------------------------------------------------------------------------
  // content wrapper — catches clicks to distinguish media vs backdrop
  // ---------------------------------------------------------------------------

  const contentWrap = document.createElement("div");
  const cws = contentWrap.style;
  cws.display = "flex";
  cws.flexDirection = "column";
  cws.alignItems = "center";
  cws.justifyContent = "center";
  cws.maxWidth = "90vw";
  cws.maxHeight = "85vh";

  // track media elements for teardown
  let videoEl: HTMLVideoElement | null = null;
  let audioEl: HTMLAudioElement | null = null;

  // ---------------------------------------------------------------------------
  // media element
  // ---------------------------------------------------------------------------

  if (type === "photo") {
    const img = document.createElement("img");
    img.src = src;
    if (mime) img.setAttribute("type", mime);
    img.alt = filename ?? "image preview";
    const is = img.style;
    is.maxWidth = "90vw";
    is.maxHeight = "85vh";
    is.objectFit = "contain";
    is.display = "block";
    is.borderRadius = "2px";
    contentWrap.appendChild(img);
  } else if (type === "video") {
    const video = document.createElement("video");
    video.src = src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    if (mime) video.setAttribute("type", mime);
    const vs = video.style;
    vs.maxWidth = "90vw";
    vs.maxHeight = "85vh";
    vs.objectFit = "contain";
    vs.display = "block";
    vs.borderRadius = "2px";
    vs.outline = "none";
    videoEl = video;
    contentWrap.appendChild(video);
  } else if (type === "audio") {
    // optional waveform image above the audio controls
    if (waveformSrc) {
      const waveform = document.createElement("img");
      waveform.src = waveformSrc;
      waveform.alt = "audio waveform";
      const wfs = waveform.style;
      wfs.maxWidth = "80vw";
      wfs.maxHeight = "40vh";
      wfs.objectFit = "contain";
      wfs.display = "block";
      wfs.marginBottom = "24px";
      wfs.borderRadius = "2px";
      contentWrap.appendChild(waveform);
    }

    const audio = document.createElement("audio");
    audio.src = src;
    audio.controls = true;
    audio.autoplay = true;
    if (mime) audio.setAttribute("type", mime);
    const as_ = audio.style;
    as_.display = "block";
    as_.minWidth = "320px";
    as_.maxWidth = "80vw";
    as_.outline = "none";
    audioEl = audio;
    contentWrap.appendChild(audio);
  }

  backdrop.appendChild(contentWrap);

  // ---------------------------------------------------------------------------
  // filename display
  // ---------------------------------------------------------------------------

  if (filename) {
    const label = document.createElement("div");
    label.textContent = filename;
    const ls = label.style;
    ls.color = "rgba(255, 255, 255, 0.7)";
    ls.fontSize = "13px";
    ls.fontFamily = "system-ui, sans-serif";
    ls.marginTop = "12px";
    ls.textAlign = "center";
    ls.maxWidth = "90vw";
    ls.overflow = "hidden";
    ls.textOverflow = "ellipsis";
    ls.whiteSpace = "nowrap";
    ls.userSelect = "none";
    backdrop.appendChild(label);
  }

  // ---------------------------------------------------------------------------
  // teardown
  // ---------------------------------------------------------------------------

  const close = (): void => {
    if (_closed) return;
    _closed = true;

    // stop playback
    if (videoEl) {
      videoEl.pause();
      videoEl.removeAttribute("src");
      videoEl.load();
    }
    if (audioEl) {
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    }

    // detach event listeners
    closeBtn.removeEventListener("click", handleCloseClick);
    backdrop.removeEventListener("click", handleBackdropClick);
    document.removeEventListener("keydown", handleKeyDown, true);

    // remove from DOM
    backdrop.remove();

    onClose?.();
  };

  // ---------------------------------------------------------------------------
  // event handlers
  // ---------------------------------------------------------------------------

  const handleCloseClick = (e: MouseEvent): void => {
    e.stopPropagation();
    close();
  };

  const handleBackdropClick = (e: MouseEvent): void => {
    // only close if clicking outside the content area
    if (e.target === backdrop) {
      close();
    }
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    // stop propagation so canvas shortcuts don't fire while overlay is open
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  // prevent clicks on the content wrapper from bubbling to the backdrop
  contentWrap.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();
  });

  closeBtn.addEventListener("click", handleCloseClick);
  backdrop.addEventListener("click", handleBackdropClick);
  // use capture phase so we intercept before anything else
  document.addEventListener("keydown", handleKeyDown, true);

  // ---------------------------------------------------------------------------
  // mount
  // ---------------------------------------------------------------------------

  document.body.appendChild(backdrop);

  // ---------------------------------------------------------------------------
  // public handle
  // ---------------------------------------------------------------------------

  return {
    close,

    get closed(): boolean {
      return _closed;
    },
  };
}
