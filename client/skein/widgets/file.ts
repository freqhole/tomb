import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import { isTauriMode } from "../src/p2p/tauri-transport";
import {
  checkBlobLocality,
  convertToAssetUrl,
  formatFileSize,
  getBlobLocalPath,
  getFullBlobDataUrl,
  getThumbnailDataUrl,
  pickFiles,
  revealBlobInFinder,
  saveBlobToDisk,
  snatchBlob,
  uploadFile,
  type PeersMap,
  type PickedFile,
  type ThumbnailOptions,
} from "../src/widgets/file-utils";
import { createInlinePlayer, type InlinePlayerHandle } from "../src/widgets/inline-media";
import { createMediaOverlay, type MediaOverlayHandle } from "../src/widgets/media-overlay";
import type {
  CompactInfo,
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
  /** embedded thumbnail as a data URL (written after upload/snatch for instant render) */
  thumbnailDataUrl: z.string().default(""),
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
    if (c.destroyed) return;
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

  getCompactInfo: (state: FileState): CompactInfo => ({
    label: state.filename || "untitled",
    thumbnailUrl: state.thumbnailDataUrl || undefined,
    accentColor: domainBadgeColor(state.domain),
  }),

  create(ctx: WidgetMountContext<typeof fileSchema>): WidgetController {
    const container = new Container();
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;
    let loadState: LoadState = "empty";
    let actionState: ActionState = "checking";
    let currentTexture: Texture | null = null;
    let thumbSprite: Sprite | null = null;
    let loadingAbort: AbortController | null = null;
    let snatchAbort: AbortController | null = null;
    let snatchCancelled = false;
    let snatchProgressText = "";
    let snatchHovered = false;
    let lastRequestedBlobId = "";
    let loadedAssetKey = "";
    let activeOverlay: MediaOverlayHandle | null = null;
    let activePlayer: InlinePlayerHandle | null = null;

    // flag: true when the user uploaded the file through this widget instance.
    // prevents showing "save to disk" for files the user just uploaded.
    let uploadedLocally = false;

    // set when the widget is destroyed; async handlers check this to bail out
    let destroyed = false;

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
      text: "loading...",
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
      text: "load failed",
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
    const snatchBtn = createPillButton("snatch", 0x2d5a27, () => {
      if (actionState === "snatching") {
        cancelSnatch();
      } else {
        handleSnatch();
      }
    });
    actionContainer.addChild(snatchBtn.container);

    snatchBtn.container.on("pointerover", () => {
      if (actionState === "snatching") {
        snatchHovered = true;
        snatchBtn.setLabel("cancel");
        snatchBtn.setColor(0x5a2727);
      }
    });
    snatchBtn.container.on("pointerout", () => {
      if (actionState === "snatching") {
        snatchHovered = false;
        snatchBtn.setLabel(snatchProgressText || "snatching...");
        snatchBtn.setColor(0x555555);
      }
    });

    // save to disk button — shown after snatch (blob is local but not "on disk")
    const saveBtn = createPillButton(
      isTauriMode() ? "reveal" : "save",
      0x27455a,
      isTauriMode() ? handleRevealInFinder : handleSaveToDisk
    );
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
      // even when uploadedLocally, show actions if preview is available
      if (actionState === "local" && uploadedLocally) {
        const domain = ctx.doc.current.domain || "file";
        return isPreviewableDomain(domain);
      }
      return false;
    }

    /** get the extra height needed for the action bar */
    function actionBarExtra(): number {
      return hasVisibleActions() ? ACTION_BAR_HEIGHT : 0;
    }

    /** sync action button visibility based on current actionState */
    function syncActionButtons() {
      if (destroyed) return;
      const state = ctx.doc.current;
      const domain = state.domain || "file";

      // snatch: visible when remote or actively snatching
      snatchBtn.setVisible(actionState === "remote" || actionState === "snatching");
      if (actionState === "snatching") {
        // label is managed by the progress callback in handleSnatch
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
        saveBtn.setLabel(isTauriMode() ? "reveal" : "save");
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

    // max data URL length we're willing to hand to PixiJS (~10 MB base64)
    const MAX_DATA_URL_LENGTH = 10 * 1024 * 1024;

    const isValidImageDataUrl = (url: string): boolean => {
      if (!url || typeof url !== "string") return false;
      if (!url.startsWith("data:image/")) return false;
      if (url.length > MAX_DATA_URL_LENGTH) return false;
      // must have the base64 comma separator
      if (!url.includes(",")) return false;
      return true;
    };

    const destroySprite = () => {
      try {
        if (thumbSprite) {
          container.removeChild(thumbSprite);
          thumbSprite.destroy();
          thumbSprite = null;
        }
      } catch (err) {
        // sprite/texture destruction can fail if the WebGL context was lost
        console.warn("[file-widget] destroySprite: sprite cleanup failed", err);
        thumbSprite = null;
      }
      if (loadedAssetKey) {
        const keyToUnload = loadedAssetKey;
        // defer unload to next frame so the render loop doesn't access a destroyed texture
        requestAnimationFrame(() => {
          // guard: if the same key was re-loaded between destroySprite and this RAF,
          // skip unload — the texture is back in use by a new sprite.
          if (loadedAssetKey === keyToUnload) return;
          try {
            Assets.unload(keyToUnload);
          } catch (err) {
            console.warn("[file-widget] destroySprite: asset unload failed", err);
          }
          if (keyToUnload.startsWith("blob:")) {
            URL.revokeObjectURL(keyToUnload);
          }
        });
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

      const info = await checkBlobLocality(blobId, ctx.doc.current.blake3);
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
      loadingText.text = "loading...";

      const abort = new AbortController();
      loadingAbort = abort;

      try {
        // only check cache + local — never contact peers during render.
        // peers that can generate thumbnails (Tauri w/ ffmpeg) write
        // thumbnailDataUrl back into the automerge doc after snatch,
        // which triggers the fast embedded path above on all peers.
        const thumbOpts: ThumbnailOptions = {
          size: 200,
        };
        const dataUrl = await getThumbnailDataUrl(blobId, thumbOpts);

        if (abort.signal.aborted || lastRequestedBlobId !== blobId) {
          return;
        }

        destroySprite();

        if (dataUrl && isValidImageDataUrl(dataUrl)) {
          let texture: Texture | null = null;
          try {
            texture = await Assets.load<Texture>(dataUrl);
          } catch (texErr) {
            console.warn("[file-widget] loadThumbnail: Assets.load failed for", blobId, texErr);
            texture = null;
          }

          // validate the texture has a usable WebGL source — Assets.load can
          // return a Texture whose underlying source or style is null/invalid
          // (e.g. malformed image data, GPU resource lost). this causes an
          // "addressModeU" crash during the render frame when PixiJS tries to
          // bind the texture. treat it as a failed load instead.
          if (texture && !texture.source?.style) {
            console.warn(
              "[file-widget] loadThumbnail: texture has invalid source, skipping",
              blobId
            );
            try {
              Assets.unload(dataUrl);
            } catch {
              /* ignored */
            }
            texture = null;
          }

          if (abort.signal.aborted || lastRequestedBlobId !== blobId) {
            if (texture) {
              try {
                Assets.unload(dataUrl);
              } catch {
                /* ignored */
              }
            }
            return;
          }

          if (texture) {
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
            // texture failed to load — show fallback icon
            hasThumbnail = false;
            positionFallbackIcon(currentWidth, currentHeight);
          }
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

    // -- embedded thumbnail (from automerge doc data URL) ---------------------

    const loadEmbeddedThumbnail = async (dataUrl: string) => {
      if (!dataUrl) return;

      // abort any in-flight loadThumbnail so it doesn't clobber our sprite later
      if (loadingAbort) {
        loadingAbort.abort();
        loadingAbort = null;
      }

      if (!isValidImageDataUrl(dataUrl)) {
        console.warn(
          "[file-widget] loadEmbeddedThumbnail: malformed data URL, falling back to async fetch"
        );
        loadThumbnail(ctx.doc.current.blobId);
        return;
      }

      try {
        destroySprite();

        let texture: Texture | null = null;
        try {
          texture = await Assets.load<Texture>(dataUrl);
        } catch (texErr) {
          console.warn("[file-widget] loadEmbeddedThumbnail: Assets.load failed", texErr);
          texture = null;
        }

        // validate the texture has a usable WebGL source (same guard as loadThumbnail)
        if (texture && !texture.source?.style) {
          console.warn("[file-widget] loadEmbeddedThumbnail: texture has invalid source, skipping");
          try {
            Assets.unload(dataUrl);
          } catch {
            /* ignored */
          }
          texture = null;
        }

        // check we haven't been superseded while loading
        if (ctx.doc.current.thumbnailDataUrl !== dataUrl) {
          if (texture) {
            try {
              Assets.unload(dataUrl);
            } catch {
              /* ignored */
            }
          }
          return;
        }

        if (!texture) {
          // texture load failed — fall back to the async thumbnail fetch
          loadThumbnail(ctx.doc.current.blobId);
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

        syncVisibility();
        fitSprite(currentWidth, currentHeight);
      } catch {
        // unexpected error — fall back to the async thumbnail fetch
        loadThumbnail(ctx.doc.current.blobId);
      }
    };

    // -- upload flow ----------------------------------------------------------

    /**
     * when multiple files are picked, replace this file widget with a new bin
     * widget containing all the selected files as children.
     */
    const handleMultiFileUpload = async (picked: PickedFile[]) => {
      const store = ctx.canvasStore;
      if (!store) return;

      // read this widget's position/size so the bin appears in the same spot
      const selfEntry = store.getWidget(ctx.widgetId);
      if (!selfEntry) return;

      // dynamically import bin schema to avoid circular deps
      const { binSchema: _binSchema } = await import("./bin/index");

      // create the bin widget at the same position as this file widget.
      // make it a bit wider/taller to accommodate multiple items.
      const binId = crypto.randomUUID();
      const cols = Math.min(picked.length, 3);
      store.addWidget({
        id: binId,
        type: "bin",
        x: selfEntry.x,
        y: selfEntry.y,
        width: Math.max(selfEntry.width, 320),
        height: Math.max(selfEntry.height, 240),
        zIndex: selfEntry.zIndex,
        props: {},
        collapsed: false,
        docId: null,
        parentId: null,
      });

      // wait a tick so the widget manager can create the bin's automerge doc
      // via reconcile. after this, the bin's docId will be set.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const binEntry = store.getWidget(binId);
      if (!binEntry?.docId) {
        console.warn("file: bin doc not created after auto-bin, aborting");
        return;
      }

      // get the bin's doc handle
      const repo = store.repo;
      const binDocHandle = repo.handles[binEntry.docId as any];
      if (!binDocHandle) {
        console.warn("file: bin doc handle not found, aborting");
        return;
      }

      // upload each file and create child widgets in the bin
      const items: Array<{ widgetId: string; slot: { col: number; row: number } }> = [];

      for (let i = 0; i < picked.length; i++) {
        const file = picked[i];
        const slot = { col: i % cols, row: Math.floor(i / cols) };
        const childId = crypto.randomUUID();

        // create a child file widget entry nested in the bin
        store.addWidget({
          id: childId,
          type: "file",
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          zIndex: 0,
          props: {},
          collapsed: false,
          docId: null,
          parentId: binId,
        });

        // the widget manager skips widgets with parentId, so no automerge doc
        // was created during reconcile. create the per-widget doc ourselves.
        const childDefaults = fileSchema.parse({});
        const childDocHandle = repo.create(childDefaults);
        store.setDocId(childId, childDocHandle.documentId);

        // add the item to the bin immediately so it appears as a card
        items.push({ widgetId: childId, slot });

        // fire-and-forget upload — don't await each one sequentially for better UX
        uploadFile(file, { waitForCompletion: true })
          .then((result) => {
            childDocHandle.change((draft: any) => {
              draft.blobId = result.blobId;
              draft.domain = result.domain;
              draft.entityId = result.entityId;
              draft.filename = file.filename;
              draft.mime = result.mime;
              draft.size = result.size;
              draft.blake3 = result.blake3 ?? "";
              draft.thumbnailDataUrl = result.thumbnailDataUrl ?? "";
            });
          })
          .catch((err) => {
            console.warn(`file: auto-bin upload failed for ${file.filename}:`, err);
            // leave the child widget in place — it will show as empty
          });
      }

      // write all items into the bin's doc at once
      const rows = Math.ceil(picked.length / cols);
      binDocHandle.change((draft: any) => {
        draft.items = items;
        draft.cols = cols;
        draft.rows = rows;
        draft.title = "";
        draft.mode = "grid";
      });

      // remove this file widget — the bin replaces it
      store.removeWidget(ctx.widgetId);
    };

    const handleUpload = async () => {
      if (loadState !== "empty") return;

      try {
        const picked = await pickFiles();
        if (!picked || picked.length === 0) return;

        // single file: upload into this widget as before
        if (picked.length === 1) {
          const file = picked[0];
          loadState = "loading";
          syncVisibility();
          loadingText.text = "uploading...";

          const result = await uploadFile(file, { waitForCompletion: true });

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
            draft.filename = file.filename;
            draft.mime = result.mime;
            draft.size = result.size;
            draft.blake3 = result.blake3 ?? "";
            draft.thumbnailDataUrl = result.thumbnailDataUrl ?? "";
          });

          // use the embedded thumbnail if the upload produced one, otherwise
          // fall back to the async thumbnail fetch from grimoire/peers
          if (result.thumbnailDataUrl) {
            loadState = "loaded";
            syncVisibility();
            positionInfoBar(currentWidth, currentHeight);
            positionFallbackIcon(currentWidth, currentHeight);
            loadEmbeddedThumbnail(result.thumbnailDataUrl);
          } else {
            loadThumbnail(result.blobId);
          }
          return;
        }

        // multiple files: replace this file widget with a bin
        await handleMultiFileUpload(picked);
      } catch (err) {
        console.error("file upload failed:", err);
        loadState = "error";
        syncVisibility();
      }
    };

    placeholderText.on("pointertap", handleUpload);
    placeholderBorder.on("pointertap", handleUpload);

    // -- snatch handler -------------------------------------------------------

    function cancelSnatch() {
      if (actionState !== "snatching") return;
      snatchCancelled = true;
      if (snatchAbort) {
        snatchAbort.abort();
        snatchAbort = null;
      }
      snatchHovered = false;
      snatchProgressText = "";
      actionState = "remote";
      snatchBtn.setLabel("snatch");
      snatchBtn.setColor(0x2d5a27);
      syncActionButtons();
      positionInfoBar(currentWidth, currentHeight);
      console.log("[file] snatch cancelled by user");
    }

    async function handleSnatch() {
      if (actionState !== "remote") return;

      const state = ctx.doc.current;
      const peers = ctx.canvasStore?.peers();
      if (!peers || Object.keys(peers).length === 0) {
        console.warn("[file] no peers available for snatch");
        return;
      }

      snatchCancelled = false;
      snatchAbort = new AbortController();

      actionState = "snatching";
      snatchBtn.setLabel("snatching...");
      snatchBtn.setColor(0x555555);
      syncActionButtons();

      // show "probing..." while the parallel probe runs (before download starts)
      snatchProgressText = "probing...";
      if (!snatchHovered) {
        snatchBtn.setLabel(snatchProgressText);
      }

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
          peers as PeersMap,
          {
            onProgress: (fraction) => {
              if (snatchCancelled) return;
              if (fraction >= 0) {
                const pct = Math.round(fraction * 100);
                snatchProgressText = `${pct}%`;
                if (!snatchHovered) {
                  snatchBtn.setLabel(snatchProgressText);
                }
              } else {
                snatchProgressText = "snatching...";
                if (!snatchHovered) {
                  snatchBtn.setLabel(snatchProgressText);
                }
              }
            },
            signal: snatchAbort?.signal,
            isPeerOnline: ctx.canvasStore
              ? (nodeId: string) => ctx.canvasStore!.isPeerOnline(nodeId)
              : undefined,
            onPeerAttempt: (peerIndex, peerCount, online) => {
              if (snatchCancelled) return;
              const label =
                peerCount > 1
                  ? `peer ${peerIndex + 1}/${peerCount}${online ? "" : " (offline)"}`
                  : "snatching...";
              snatchProgressText = label;
              if (!snatchHovered) {
                snatchBtn.setLabel(snatchProgressText);
              }
            },
          }
        );

        if (snatchCancelled) {
          console.log("[file] snatch result discarded (cancelled)");
          return;
        }

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

        // re-layout
        positionInfoBar(currentWidth, currentHeight);
        fitSprite(currentWidth, currentHeight);
        if (!hasThumbnail) {
          positionFallbackIcon(currentWidth, currentHeight);
        }

        // generate thumbnail locally and write to doc if possible.
        // writing thumbnailDataUrl to the doc triggers loadEmbeddedThumbnail
        // via the doc-change subscription — single code path, no race.
        // if local generation fails (e.g. audio in browser — no ffmpeg),
        // fall back to loadThumbnail which checks cache + local only.
        try {
          if (!ctx.doc.current.thumbnailDataUrl) {
            const thumbDataUrl = await getThumbnailDataUrl(result.blobId, {
              size: 200,
            });
            if (thumbDataUrl && ctx.doc.current.blobId === result.blobId) {
              ctx.doc.change((draft) => {
                draft.thumbnailDataUrl = thumbDataUrl;
              });
              // doc-change subscription will call loadEmbeddedThumbnail
            } else {
              // no thumbnail generated — try loading from local/cache
              loadThumbnail(result.blobId);
            }
          } else {
            // doc already has a thumbnail (maybe peer wrote it) — load it
            loadEmbeddedThumbnail(ctx.doc.current.thumbnailDataUrl);
          }
        } catch {
          // thumbnail generation failed — try loading from local/cache
          loadThumbnail(result.blobId);
        }
      } catch (err) {
        if (snatchCancelled) {
          console.log("[file] snatch aborted (cancelled)");
          return;
        }
        console.error("[file] snatch failed:", err);
        actionState = "remote";
        syncActionButtons();
      } finally {
        snatchAbort = null;
      }
    }

    // -- save to disk handler -------------------------------------------------

    async function handleRevealInFinder() {
      if (actionState !== "snatched" && actionState !== "local") return;
      const state = ctx.doc.current;
      const revealed = await revealBlobInFinder(state.blobId);
      if (!revealed) {
        console.warn("[file] could not reveal blob in finder, falling back to save dialog");
        handleSaveToDisk();
      }
    }

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

      const overlayType = domainToOverlayType(state.domain);

      // photos use the fullscreen overlay — inline at widget scale isn't useful
      if (overlayType === "photo") {
        // close any existing overlay/player
        if (activeOverlay && !activeOverlay.closed) {
          activeOverlay.close();
        }
        if (activePlayer && !activePlayer.closed) {
          activePlayer.close();
          activePlayer = null;
        }

        let src: string | null = null;
        const peers = ctx.canvasStore?.peers() as PeersMap | undefined;
        src = await getFullBlobDataUrl(state.blobId, peers);

        if (!src) {
          console.warn("[file] could not resolve blob data for photo preview");
          return;
        }

        activeOverlay = createMediaOverlay({
          type: "photo",
          src,
          filename: state.filename,
          mime: state.mime,
          onClose: () => {
            activeOverlay = null;
          },
        });
        return;
      }

      // video/audio use the inline player positioned over the widget
      // close any existing overlay/player
      if (activeOverlay && !activeOverlay.closed) {
        activeOverlay.close();
        activeOverlay = null;
      }
      if (activePlayer && !activePlayer.closed) {
        activePlayer.close();
        activePlayer = null;
      }

      let src: string | null = null;

      // for video/audio, prefer asset:// URL (supports range requests / streaming)
      if (isTauriMode()) {
        const localPath = await getBlobLocalPath(state.blobId);
        if (localPath) {
          try {
            src = await convertToAssetUrl(localPath);
          } catch {
            // fall through to data URL approach
          }
        }
      }

      // fallback: fetch full blob data
      if (!src) {
        const peers = ctx.canvasStore?.peers() as PeersMap | undefined;
        src = await getFullBlobDataUrl(state.blobId, peers);
      }

      if (!src) {
        console.warn("[file] could not resolve blob data for preview");
        return;
      }

      // hide thumbnail while player is active
      if (thumbSprite) {
        thumbSprite.visible = false;
      }

      activePlayer = createInlinePlayer({
        type: overlayType as "video" | "audio",
        src,
        mime: state.mime,
        container,
        canvasElement: ctx.canvasElement,
        width: currentWidth,
        height: currentHeight,
        onClose: () => {
          activePlayer = null;
          // re-show thumbnail
          if (thumbSprite) {
            thumbSprite.visible = true;
          }
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
    let prevThumbDataUrl = ctx.doc.current.thumbnailDataUrl;
    const unsub = ctx.doc.on("change", (state) => {
      drawBg(currentWidth, currentHeight);

      if (state.blobId !== prevBlobId) {
        prevBlobId = state.blobId;
        prevThumbDataUrl = state.thumbnailDataUrl;
        // reset uploaded flag when blobId changes (e.g. from a peer's change)
        uploadedLocally = false;

        // immediately show metadata from the new state
        if (state.blobId) {
          loadState = "loaded";
          syncVisibility();
          positionInfoBar(currentWidth, currentHeight);
          positionFallbackIcon(currentWidth, currentHeight);

          if (state.thumbnailDataUrl) {
            loadEmbeddedThumbnail(state.thumbnailDataUrl);
          } else {
            loadThumbnail(state.blobId);
          }
        } else {
          loadThumbnail(state.blobId);
        }
        checkLocality(state.blobId);
      } else if (state.thumbnailDataUrl && state.thumbnailDataUrl !== prevThumbDataUrl) {
        // a peer (or Tauri snatch) wrote a new thumbnail — load it
        prevThumbDataUrl = state.thumbnailDataUrl;
        loadEmbeddedThumbnail(state.thumbnailDataUrl);
      } else if (loadState === "loaded") {
        // metadata changed — refresh info bar
        syncActionButtons();
        positionInfoBar(currentWidth, currentHeight);
      }
    });

    // kick off initial load if a blob ID is already set
    if (ctx.doc.current.blobId) {
      // immediately show metadata (filename, size, domain badge) — no async needed
      loadState = "loaded";
      syncVisibility();
      positionInfoBar(currentWidth, currentHeight);
      positionFallbackIcon(currentWidth, currentHeight);

      // if we have an embedded thumbnail, load it (fast — it's a data URL, already local)
      if (ctx.doc.current.thumbnailDataUrl) {
        loadEmbeddedThumbnail(ctx.doc.current.thumbnailDataUrl);
      } else {
        // fall back to the old async thumbnail fetch from grimoire/peers
        loadThumbnail(ctx.doc.current.blobId);
      }

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
        if (snatchAbort) {
          snatchAbort.abort();
          snatchAbort = null;
        }
        if (activeOverlay && !activeOverlay.closed) {
          activeOverlay.close();
          activeOverlay = null;
        }
        if (activePlayer && !activePlayer.closed) {
          activePlayer.close();
          activePlayer = null;
        }
        unsub();
        destroyed = true;
        destroySprite();
        container.destroy({ children: true });
      },
      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height);
        drawPlaceholderBorder(width, height);
        repositionOverlays(width, height);
        if (activePlayer && !activePlayer.closed) {
          activePlayer.reposition(width, height);
        }
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
