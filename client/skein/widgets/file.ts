import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import {
  pickFile,
  uploadFile,
  getThumbnailDataUrl,
  formatFileSize,
} from "../src/widgets/file-utils";
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

const INFO_BAR_HEIGHT = 48;
const THUMB_PADDING = 4;

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

export const fileWidget: WidgetFactory<typeof fileSchema> = {
  type: "file",
  metadata: {
    name: "file",
    description: "upload and display any file with thumbnail preview",
    version: "0.1.0",
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
    let currentTexture: Texture | null = null;
    let thumbSprite: Sprite | null = null;
    let loadingAbort: AbortController | null = null;
    let lastRequestedBlobId = "";
    let loadedAssetKey = "";

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

    const drawInfoBarBg = (w: number, h: number) => {
      infoBarBg.clear();
      infoBarBg.rect(0, h - INFO_BAR_HEIGHT, w, INFO_BAR_HEIGHT);
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

    // -- layout helpers -------------------------------------------------------

    const positionInfoBar = (w: number, h: number) => {
      drawInfoBarBg(w, h);

      const state = ctx.doc.current;
      const maxFilenameChars = Math.max(8, Math.floor((w - 80) / 6));
      filenameText.text = truncateText(state.filename || "unknown", maxFilenameChars);
      filenameText.x = 8;
      filenameText.y = h - INFO_BAR_HEIGHT + 6;

      sizeText.text = formatFileSize(state.size);
      sizeText.x = w - 8 - sizeText.width;
      sizeText.y = h - INFO_BAR_HEIGHT + 6;

      const domain = state.domain || "file";
      domainText.text = domain;

      domainBadgeBg.clear();
      const badgeX = 8;
      const badgeY = h - INFO_BAR_HEIGHT + 24;
      const badgePadH = 6;
      const badgePadV = 2;
      const badgeW = domainText.width + badgePadH * 2;
      const badgeH = domainText.height + badgePadV * 2;
      domainBadgeBg.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
      domainBadgeBg.fill({ color: domainBadgeColor(domain) });

      domainText.x = badgeX + badgePadH;
      domainText.y = badgeY + badgePadV;
    };

    const positionFallbackIcon = (w: number, h: number) => {
      const thumbAreaH = h - INFO_BAR_HEIGHT;
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

      const thumbAreaH = h - INFO_BAR_HEIGHT;
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
        const dataUrl = await getThumbnailDataUrl(blobId, 200);

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
          // insert above bg but below overlay texts
          container.addChildAt(thumbSprite, 1);
          hasThumbnail = true;
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

        ctx.doc.change((draft) => {
          draft.blobId = result.blobId;
          draft.domain = result.domain;
          draft.entityId = result.entityId;
          draft.filename = picked.filename;
          draft.mime = result.mime;
          draft.size = result.size;
          draft.blake3 = result.blake3 ?? "";
        });
      } catch (err) {
        console.error("file upload failed:", err);
        loadState = "error";
        syncVisibility();
      }
    };

    placeholderText.on("pointertap", handleUpload);
    placeholderBorder.on("pointertap", handleUpload);

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
        loadThumbnail(state.blobId);
      } else if (loadState === "loaded") {
        // metadata changed — refresh info bar
        positionInfoBar(currentWidth, currentHeight);
      }
    });

    // kick off initial load if a blob ID is already set
    if (ctx.doc.current.blobId) {
      loadThumbnail(ctx.doc.current.blobId);
    }

    // -- return controller ----------------------------------------------------

    return {
      container,
      destroy() {
        if (loadingAbort) {
          loadingAbort.abort();
          loadingAbort = null;
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
          positionInfoBar(width, height);
          if (!hasThumbnail) {
            positionFallbackIcon(width, height);
          }
        }
      },
    };
  },
};
