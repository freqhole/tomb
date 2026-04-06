import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import {
  pickFile,
  uploadFile,
  getThumbnailDataUrl,
  formatFileSize,
  checkBlobLocality,
  snatchBlob,
  saveBlobToDisk,
  getFullBlobDataUrl,
  getBlobLocalPath,
  convertToAssetUrl,
  type ThumbnailOptions,
  type PeersMap,
} from "../src/widgets/file-utils";
import { createMediaOverlay, type MediaOverlayHandle } from "../src/widgets/media-overlay";
import type {
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../src/widgets/widget-types";

export const fileSchema = z.object({
  /** media blob ID from grimoire */
  blobId: z.string().default(""),
  /** media domain: audio, photo, video, document, file */
  domain: z.string().default(""),
  /** domain entity ID (audioz, photoz, etc.) */
  entityId: z.string().default(""),
  /** original filename */
  filename: z.string().default(""),
  /** MIME type */
  mime: z.string().default(""),
  /** file size in bytes */
  size: z.number().default(0),
  /** blake3 content hash (for P2P verified fetch) */
  blake3: z.string().default(""),
});

export type FileState = z.infer<typeof fileSchema>;

type LoadState = "empty" | "loading" | "loaded" | "error";

/** tracks whether the blob is local, remote, or just snatched this session */
type ActionState = "checking" | "local" | "remote" | "snatched" | "saving" | "snatching";

const INFO_BAR_HEIGHT = 48;
const ACTION_BAR_HEIGHT = 28;
const THUMB_PADDING = 4;
const BUTTON_H = 20;
const BUTTON_PAD_H = 8;
const BUTTON_PAD_V = 2;
const BUTTON_RADIUS = 3;
const BUTTON_FONT_SIZE = 10;

/**
 * truncate a string to a maximum length, appending "..." if truncated.
 */
function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * pick a fill color for the domain badge background.
 */
function domainBadgeColor(domain: string): number {
  switch (domain) {
    case "audio":
      return 0x2d5a27;
    case "photo":
      return 0x27455a;
    case "video":
      return 0x5a2745;
    case "document":
      return 0x4a4a27;
    default:
      return 0x3a3a4a;
  }
}

/**
 * returns true if the domain supports full-screen preview/playback.
 */
function isPreviewableDomain(domain: string): boolean {
  return domain === "photo" || domain === "video" || domain === "audio";
}

/**
 * map domain to the media overlay type.
 */
function domainToOverlayType(domain: string): "photo" | "video" | "audio" {
  if (domain === "video") return "video";
  if (domain === "audio") return "audio";
  return "photo";
}

// ---------------------------------------------------------------------------
// pill button helper — creates a small rounded-rect button with text
// ---------------------------------------------------------------------------

interface PillButton {
  container: Container;
  bg: Graphics;
  label: Text;
  setLabel(text: string): void;
  setColor(fill: number): void;
  setVisible(v: boolean): void;
  getWidth(): number;
}

function createPillButton(text: string, fill: number, onClick: () => void): PillButton {
  const c = new Container();
  c.eventMode = "static";
  c.cursor = "pointer";

  const bg = new Graphics();
  c.addChild(bg);

  const label = new Text({
    text,
    style: {
      fontFamily: "system-ui, sans-serif",
      fontSize: BUTTON_FONT_SIZE,
      fill: 0xddddee,
      align: "center",
    },
    resolution: 2,
  });
  c.addChild(label);

  const redraw = () => {
    const w = label.width + BUTTON_PAD_H * 2;
    bg.clear();
    bg.roundRect(0, 0, w, BUTTON_H, BUTTON_RADIUS);
    bg.fill({ color: fill });
    label.x = BUTTON_PAD_H;
    label.y = BUTTON_PAD_V + 1;
  };

  redraw();
  c.on("pointertap", (e) => {
    e.stopPropagation();
    onClick();
  });

  return {
    container: c,
    bg,
    label,
    setLabel(t: string) {
      label.text = t;
      redraw();
    },
    setColor(f: number) {
      fill = f;
      redraw();
    },
    setVisible(v: boolean) {
      c.visible = v;
    },
    getWidth() {
      return label.width + BUTTON_PAD_H * 2;
    },
  };
}

// ---------------------------------------------------------------------------
// file widget factory
// ---------------------------------------------------------------------------

export const fileWidget: WidgetFactory<typeof fileSchema> = {
  type: "file",
  metadata: {
    name: "file",
    description: "upload and display any file with thumbnail preview",
    version: "0.2.0",
    category: "basics",
    defaultWidth: 280,
    defaultHeight: 200,
  },
  schema: fileSchema,
  // no editableProps — the file is set by uploading, not by editing fields

  create(ctx: WidgetMountContext<typeof fileSchema>): WidgetController {
    const container = new Container();
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;
    let loadState: LoadState = "empty";
    let actionState: ActionState = "checking";
    let currentTexture: Texture | null = null;
    let thumbSprite: Sprite | null = null;
    let loadingAbort: AbortController | null = null;
    let lastRequestedBlobId = "";
    let loadedAssetKey = "";
    let activeOverlay: MediaOverlayHandle | null = null;

    // flag: true when the user uploaded the file through this widget instance.
    // prevents showing "save to disk" for files the user just uploaded.
    let uploadedLocally = false;

    // -- background -----------------------------------------------------------

    const bg = new Graphics();
    container.addChild(bg);

    const drawBg = (w: number, h: number) => {
      bg.clear();
      bg.roundRect(0, 0, w, h, 4);
      bg.fill({ color: 0x1a1a2e });
      bg.stroke({ color: 0x2a2a3e, width: 1 });
    };
    drawBg(currentWidth, currentHeight);

    // -- placeholder (empty state) --------------------------------------------

    const placeholderBorder = new Graphics();
    const drawPlaceholderBorder = (w: number, h: number) => {
      const inset = 12;
      placeholderBorder.clear();
      placeholderBorder.rect(inset, inset, w - inset * 2, h - inset * 2);
      placeholderBorder.stroke({ color: 0x444460, width: 1 });
    };
    drawPlaceholderBorder(currentWidth, currentHeight);
    placeholderBorder.eventMode = "static";
    placeholderBorder.cursor = "pointer";
    container.addChild(placeholderBorder);

    const placeholderText = new Text({
      text: "click to upload file",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fill: 0x666680,
        align: "center",
      },
      resolution: 2,
    });
    placeholderText.anchor.set(0.5);
    placeholderText.x = currentWidth / 2;
    placeholderText.y = currentHeight / 2;
    placeholderText.eventMode = "static";
    placeholderText.cursor = "pointer";
    container.addChild(placeholderText);

    // -- loading text ---------------------------------------------------------

    const loadingText = new Text({
      text: "uploading...",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fill: 0x888899,
        align: "center",
      },
      resolution: 2,
    });
    loadingText.anchor.set(0.5);
    loadingText.x = currentWidth / 2;
    loadingText.y = currentHeight / 2;
    loadingText.visible = false;
    container.addChild(loadingText);

    // -- error text -----------------------------------------------------------

    const errorText = new Text({
      text: "upload failed",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fill: 0xdd4444,
        align: "center",
      },
      resolution: 2,
    });
    errorText.anchor.set(0.5);
    errorText.x = currentWidth / 2;
    errorText.y = currentHeight / 2;
    errorText.visible = false;
    container.addChild(errorText);

    // -- info bar (loaded state) ----------------------------------------------

    const infoContainer = new Container();
    infoContainer.visible = false;
    container.addChild(infoContainer);

    const infoBarBg = new Graphics();
    infoContainer.addChild(infoBarBg);

    const drawInfoBarBg = (w: number, h: number, extraHeight: number) => {
      const totalH = INFO_BAR_HEIGHT + extraHeight;
      infoBarBg.clear();
      infoBarBg.rect(0, h - totalH, w, totalH);
      infoBarBg.fill({ color: 0x141422, alpha: 0.85 });
    };

    const filenameText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fill: 0xccccdd,
        align: "left",
      },
      resolution: 2,
    });
    infoContainer.addChild(filenameText);

    const sizeText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 10,
        fill: 0x888899,
        align: "right",
      },
      resolution: 2,
    });
    infoContainer.addChild(sizeText);

    const domainBadgeBg = new Graphics();
    infoContainer.addChild(domainBadgeBg);

    const domainText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 9,
        fill: 0xaaaacc,
        align: "left",
      },
      resolution: 2,
    });
    infoContainer.addChild(domainText);

    // -- action buttons -------------------------------------------------------

    const actionContainer = new Container();
    actionContainer.visible = false;
    infoContainer.addChild(actionContainer);

    // snatch button — shown when blob is remote
    const snatchBtn = createPillButton("snatch", 0x2d5a27, handleSnatch);
    actionContainer.addChild(snatchBtn.container);

    // save to disk button — shown after snatch (blob is local but not "on disk")
    const saveBtn = createPillButton("save", 0x27455a, handleSaveToDisk);
    actionContainer.addChild(saveBtn.container);

    // preview/play button — shown when blob is local and domain supports it
    const previewBtn = createPillButton("view", 0x3a3a5a, handlePreview);
    actionContainer.addChild(previewBtn.container);

    // -- fallback icon (when no thumbnail is available) -----------------------

    const fallbackIcon = new Container();
    fallbackIcon.visible = false;
    container.addChild(fallbackIcon);

    const fallbackRect = new Graphics();
    fallbackIcon.addChild(fallbackRect);

    const fallbackText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        fill: 0xaaaacc,
        align: "center",
      },
      resolution: 2,
    });
    fallbackText.anchor.set(0.5);
    fallbackIcon.addChild(fallbackText);

    let hasThumbnail = false;

    // -- action state helpers -------------------------------------------------

    /** check whether any action buttons should be visible */
    function hasVisibleActions(): boolean {
      if (actionState === "checking" || loadState !== "loaded") return false;
      if (actionState === "remote") return true;
      if (actionState === "snatched") return true;
      if (actionState === "local" && !uploadedLocally) return true;
      if (actionState === "saving" || actionState === "snatching") return true;
      return false;
    }

    /** get the extra height needed for the action bar */
    function actionBarExtra(): number {
      return hasVisibleActions() ? ACTION_BAR_HEIGHT : 0;
    }

    /** sync action button visibility based on current actionState */
    function syncActionButtons() {
      const state = ctx.doc.current;
      const domain = state.domain || "file";

      // snatch: visible when remote or actively snatching
      snatchBtn.setVisible(actionState === "remote" || actionState === "snatching");
      if (actionState === "snatching") {
        snatchBtn.setLabel("snatching...");
        snatchBtn.setColor(0x555555);
      } else {
        snatchBtn.setLabel("snatch");
        snatchBtn.setColor(0x2d5a27);
      }

      // save: visible when snatched or local (but not uploaded locally), or saving
      const showSave =
        actionState === "snatched" ||
        actionState === "saving" ||
        (actionState === "local" && !uploadedLocally);
      saveBtn.setVisible(showSave);
      if (actionState === "saving") {
        saveBtn.setLabel("saving...");
        saveBtn.setColor(0x555555);
      } else {
        saveBtn.setLabel("save");
        saveBtn.setColor(0x27455a);
      }

      // preview: visible when local or snatched, and domain supports it
      const canPreview =
        (actionState === "local" || actionState === "snatched") && isPreviewableDomain(domain);
      previewBtn.setVisible(canPreview);

      actionContainer.visible = hasVisibleActions();
    }

    // -- layout helpers -------------------------------------------------------

    const positionInfoBar = (w: number, h: number) => {
      const extra = actionBarExtra();
      drawInfoBarBg(w, h, extra);

      const state = ctx.doc.current;
      const totalBarH = INFO_BAR_HEIGHT + extra;
      const barTop = h - totalBarH;

      const maxFilenameChars = Math.max(8, Math.floor((w - 80) / 6));
      filenameText.text = truncateText(state.filename || "unknown", maxFilenameChars);
      filenameText.x = 8;
      filenameText.y = barTop + 6;

      sizeText.text = formatFileSize(state.size);
      sizeText.x = w - 8 - sizeText.width;
      sizeText.y = barTop + 6;

      const domain = state.domain || "file";
      domainText.text = domain;

      domainBadgeBg.clear();
      const badgeX = 8;
      const badgeY = barTop + 24;
      const badgePadH = 6;
      const badgePadV = 2;
      const badgeW = domainText.width + badgePadH * 2;
      const badgeH = domainText.height + badgePadV * 2;
      domainBadgeBg.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
      domainBadgeBg.fill({ color: domainBadgeColor(domain) });

      domainText.x = badgeX + badgePadH;
      domainText.y = badgeY + badgePadV;

      // position action buttons
      if (hasVisibleActions()) {
        const actionY = h - ACTION_BAR_HEIGHT + 2;
        let xCursor = 8;

        const buttons = [snatchBtn, saveBtn, previewBtn];
        for (const btn of buttons) {
          if (btn.container.visible) {
            btn.container.x = xCursor;
            btn.container.y = actionY;
            xCursor += btn.getWidth() + 6;
          }
        }
      }
    };

    const positionFallbackIcon = (w: number, h: number) => {
      const extra = actionBarExtra();
      const thumbAreaH = h - INFO_BAR_HEIGHT - extra;
      const iconSize = Math.min(60, thumbAreaH - 16, w - 16);
      if (iconSize <= 0) return;

      fallbackRect.clear();
      const rx = (w - iconSize) / 2;
      const ry = (thumbAreaH - iconSize) / 2;
      fallbackRect.roundRect(rx, ry, iconSize, iconSize, 6);
      fallbackRect.fill({ color: 0x2a2a3e });
      fallbackRect.stroke({ color: 0x3a3a5e, width: 1 });

      const state = ctx.doc.current;
      fallbackText.text = (state.domain || "file").toUpperCase();
      fallbackText.x = w / 2;
      fallbackText.y = thumbAreaH / 2;
    };

    // -- sprite management ----------------------------------------------------

    const fitSprite = (w: number, h: number) => {
      if (!thumbSprite || !currentTexture) return;

      const extra = actionBarExtra();
      const thumbAreaH = h - INFO_BAR_HEIGHT - extra;
      const imageWidth = currentTexture.width;
      const imageHeight = currentTexture.height;
      if (imageWidth === 0 || imageHeight === 0) return;

      const availW = w - THUMB_PADDING * 2;
      const availH = thumbAreaH - THUMB_PADDING * 2;
      const scale = Math.min(availW / imageWidth, availH / imageHeight);

      thumbSprite.width = imageWidth * scale;
      thumbSprite.height = imageHeight * scale;
      thumbSprite.x = (w - thumbSprite.width) / 2;
      thumbSprite.y = (thumbAreaH - thumbSprite.height) / 2;
    };

    const destroySprite = () => {
      if (thumbSprite) {
        container.removeChild(thumbSprite);
        thumbSprite.destroy();
        thumbSprite = null;
      }
      if (loadedAssetKey) {
        Assets.unload(loadedAssetKey);
        if (loadedAssetKey.startsWith("blob:")) {
          URL.revokeObjectURL(loadedAssetKey);
        }
        loadedAssetKey = "";
      }
      currentTexture = null;
      hasThumbnail = false;
    };

    // -- visibility management ------------------------------------------------

    const syncVisibility = () => {
      placeholderText.visible = loadState === "empty";
      placeholderBorder.visible = loadState === "empty";
      loadingText.visible = loadState === "loading";
      errorText.visible = loadState === "error";
      infoContainer.visible = loadState === "loaded";
      fallbackIcon.visible = loadState === "loaded" && !hasThumbnail;
      if (thumbSprite) {
        thumbSprite.visible = loadState === "loaded" && hasThumbnail;
      }
      syncActionButtons();
    };

    // -- blob locality checking -----------------------------------------------

    const checkLocality = async (blobId: string) => {
      if (!blobId) {
        actionState = "checking";
        syncActionButtons();
        return;
      }

      actionState = "checking";
      syncActionButtons();

      const info = await checkBlobLocality(blobId);
      // make sure we're still looking at the same blob
      if (ctx.doc.current.blobId !== blobId) return;

      // map locality: "unknown" stays as "checking" (no action buttons) to avoid
      // showing a non-functional snatch button in browser mode
      if (info.locality === "local") actionState = "local";
      else if (info.locality === "remote") actionState = "remote";
      else actionState = "checking";
      syncActionButtons();

      // re-layout to account for action bar height change
      if (loadState === "loaded") {
        positionInfoBar(currentWidth, currentHeight);
        fitSprite(currentWidth, currentHeight);
        if (!hasThumbnail) {
          positionFallbackIcon(currentWidth, currentHeight);
        }
      }
    };

    // -- thumbnail loading ----------------------------------------------------

    const loadThumbnail = async (blobId: string) => {
      if (loadingAbort) {
        loadingAbort.abort();
        loadingAbort = null;
      }

      if (!blobId) {
        destroySprite();
        loadState = "empty";
        syncVisibility();
        return;
      }

      lastRequestedBlobId = blobId;
      loadState = "loading";
      syncVisibility();

      const abort = new AbortController();
      loadingAbort = abort;

      try {
        const thumbOpts: ThumbnailOptions = {
          size: 200,
          peers: ctx.canvasStore?.peers(),
        };
        const dataUrl = await getThumbnailDataUrl(blobId, thumbOpts);

        if (abort.signal.aborted || lastRequestedBlobId !== blobId) {
          return;
        }

        destroySprite();

        if (dataUrl) {
          const texture = await Assets.load<Texture>(dataUrl);

          if (abort.signal.aborted || lastRequestedBlobId !== blobId) {
            Assets.unload(dataUrl);
            return;
          }

          currentTexture = texture;
          loadedAssetKey = dataUrl;
          thumbSprite = new Sprite(currentTexture);
          // insert above bg but below info container and overlays
          container.addChildAt(thumbSprite, 1);
          hasThumbnail = true;

          // make thumbnail clickable for preview when the domain supports it
          const domain = ctx.doc.current.domain || "file";
          thumbSprite.eventMode = "static";
          thumbSprite.cursor = isPreviewableDomain(domain) ? "pointer" : "default";
          thumbSprite.on("pointertap", (e) => {
            e.stopPropagation();
            handlePreview();
          });
        } else {
          // no thumbnail available — show fallback icon with domain name
          hasThumbnail = false;
          positionFallbackIcon(currentWidth, currentHeight);
        }

        loadState = "loaded";
        syncVisibility();
        positionInfoBar(currentWidth, currentHeight);
        fitSprite(currentWidth, currentHeight);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (lastRequestedBlobId !== blobId) return;

        destroySprite();
        loadState = "error";
        syncVisibility();
      } finally {
        if (loadingAbort === abort) {
          loadingAbort = null;
        }
      }
    };

    // -- upload flow ----------------------------------------------------------

    const handleUpload = async () => {
      if (loadState !== "empty") return;

      try {
        const picked = await pickFile();
        if (!picked) return;

        loadState = "loading";
        syncVisibility();

        const result = await uploadFile(picked, { waitForCompletion: true });

        // mark as locally uploaded so we don't show "save to disk".
        // suppress the doc-change subscription by updating prevBlobId first,
        // otherwise the subscription resets uploadedLocally to false.
        uploadedLocally = true;
        prevBlobId = result.blobId;
        actionState = "local";

        ctx.doc.change((draft) => {
          draft.blobId = result.blobId;
          draft.domain = result.domain;
          draft.entityId = result.entityId;
          draft.filename = picked.filename;
          draft.mime = result.mime;
          draft.size = result.size;
          draft.blake3 = result.blake3 ?? "";
        });

        // manually trigger thumbnail load (subscription is suppressed)
        loadThumbnail(result.blobId);
      } catch (err) {
        console.error("file upload failed:", err);
        loadState = "error";
        syncVisibility();
      }
    };

    placeholderText.on("pointertap", handleUpload);
    placeholderBorder.on("pointertap", handleUpload);

    // -- snatch handler -------------------------------------------------------

    async function handleSnatch() {
      if (actionState !== "remote") return;

      const state = ctx.doc.current;
      const peers = ctx.canvasStore?.peers();
      if (!peers || Object.keys(peers).length === 0) {
        console.warn("[file] no peers available for snatch");
        return;
      }

      actionState = "snatching";
      syncActionButtons();

      try {
        const result = await snatchBlob(
          {
            blobId: state.blobId,
            filename: state.filename,
            mime: state.mime,
            size: state.size,
            blake3: state.blake3,
            domain: state.domain,
          },
          peers as PeersMap
        );

        // update the doc if the blob ID changed (SHA256 dedup might map to existing)
        // suppress the doc-change subscription so it doesn't overwrite
        // "snatched" with a re-check that resolves to "local"
        prevBlobId = result.blobId;
        actionState = "snatched";

        if (result.blobId !== state.blobId) {
          ctx.doc.change((draft) => {
            draft.blobId = result.blobId;
            draft.domain = result.domain;
            draft.entityId = result.entityId;
            draft.mime = result.mime;
            draft.size = result.size;
            draft.blake3 = result.blake3 ?? "";
          });
        }
        syncActionButtons();

        // re-layout and re-fetch thumbnail from local
        positionInfoBar(currentWidth, currentHeight);
        fitSprite(currentWidth, currentHeight);
        if (!hasThumbnail) {
          positionFallbackIcon(currentWidth, currentHeight);
        }

        // reload thumbnail from local source
        loadThumbnail(result.blobId);
      } catch (err) {
        console.error("[file] snatch failed:", err);
        actionState = "remote";
        syncActionButtons();
      }
    }

    // -- save to disk handler -------------------------------------------------

    async function handleSaveToDisk() {
      if (actionState !== "snatched" && actionState !== "local") return;

      const state = ctx.doc.current;
      const prevState = actionState;

      actionState = "saving";
      syncActionButtons();

      try {
        const saved = await saveBlobToDisk(state.blobId, state.filename || "file");
        if (saved) {
          console.log("[file] saved to disk successfully");
        }
      } catch (err) {
        console.error("[file] save to disk failed:", err);
      }

      actionState = prevState;
      syncActionButtons();
      positionInfoBar(currentWidth, currentHeight);
    }

    // -- preview handler ------------------------------------------------------

    async function handlePreview() {
      const state = ctx.doc.current;
      if (!state.blobId || !isPreviewableDomain(state.domain)) return;
      if (actionState !== "local" && actionState !== "snatched") return;

      // close any existing overlay
      if (activeOverlay && !activeOverlay.closed) {
        activeOverlay.close();
      }

      const overlayType = domainToOverlayType(state.domain);
      let src: string | null = null;

      // for video/audio, prefer asset:// URL (supports range requests / streaming)
      if (overlayType === "video" || overlayType === "audio") {
        const localPath = await getBlobLocalPath(state.blobId);
        if (localPath) {
          try {
            src = await convertToAssetUrl(localPath);
          } catch {
            // fall through to data URL approach
          }
        }
      }

      // fallback: fetch full blob data as a data URL
      if (!src) {
        const peers = ctx.canvasStore?.peers() as PeersMap | undefined;
        src = await getFullBlobDataUrl(state.blobId, peers);
      }

      if (!src) {
        console.warn("[file] could not resolve blob data for preview");
        return;
      }

      // for audio, also try to get waveform
      let waveformSrc: string | undefined;
      if (overlayType === "audio") {
        // waveform thumbnails use the same blob thumbnail system
        const thumbOpts: ThumbnailOptions = {
          size: 200,
          peers: ctx.canvasStore?.peers(),
        };
        const waveform = await getThumbnailDataUrl(state.blobId, thumbOpts);
        if (waveform) {
          waveformSrc = waveform;
        }
      }

      activeOverlay = createMediaOverlay({
        type: overlayType,
        src,
        filename: state.filename,
        mime: state.mime,
        waveformSrc,
        onClose: () => {
          activeOverlay = null;
        },
      });
    }

    // -- overlay repositioning ------------------------------------------------

    const repositionOverlays = (w: number, h: number) => {
      placeholderText.x = w / 2;
      placeholderText.y = h / 2;
      loadingText.x = w / 2;
      loadingText.y = h / 2;
      errorText.x = w / 2;
      errorText.y = h / 2;
    };

    // -- doc change subscription ----------------------------------------------

    let prevBlobId = ctx.doc.current.blobId;
    const unsub = ctx.doc.on("change", (state) => {
      drawBg(currentWidth, currentHeight);

      if (state.blobId !== prevBlobId) {
        prevBlobId = state.blobId;
        // reset uploaded flag when blobId changes (e.g. from a peer's change)
        uploadedLocally = false;
        loadThumbnail(state.blobId);
        checkLocality(state.blobId);
      } else if (loadState === "loaded") {
        // metadata changed — refresh info bar
        syncActionButtons();
        positionInfoBar(currentWidth, currentHeight);
      }
    });

    // kick off initial load if a blob ID is already set
    if (ctx.doc.current.blobId) {
      loadThumbnail(ctx.doc.current.blobId);
      checkLocality(ctx.doc.current.blobId);
    }

    // -- return controller ----------------------------------------------------

    return {
      container,
      destroy() {
        if (loadingAbort) {
          loadingAbort.abort();
          loadingAbort = null;
        }
        if (activeOverlay && !activeOverlay.closed) {
          activeOverlay.close();
          activeOverlay = null;
        }
        unsub();
        destroySprite();
        container.destroy({ children: true });
      },
      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height);
        drawPlaceholderBorder(width, height);
        repositionOverlays(width, height);
        fitSprite(width, height);
        if (loadState === "loaded") {
          syncActionButtons();
          positionInfoBar(width, height);
          if (!hasThumbnail) {
            positionFallbackIcon(width, height);
          }
        }
      },
    };
  },
};
