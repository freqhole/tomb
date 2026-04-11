import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import { pickImageAsDataUrl } from "../src/widgets/image-utils";
import type {
  CompactInfo,
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../src/widgets/widget-types";

export const imageSchema = z.object({
  url: z.string().default(""),
  fit: z.string().default("contain"),
  bgColor: z.number().default(-1),
  borderColor: z.number().default(-1),
  borderRadius: z.number().default(4),
});

export type ImageState = z.infer<typeof imageSchema>;

type LoadState = "empty" | "loading" | "loaded" | "error";

export const imageWidget: WidgetFactory<typeof imageSchema> = {
  type: "image",
  metadata: {
    name: "image",
    description: "displays an image from a URL with contain/cover fitting",
    version: "0.1.0",
    category: "basics",
  },
  schema: imageSchema,
  editableProps: [
    {
      key: "url",
      label: "image",
      type: "image" as const,
      default: "",
      imageMaxWidth: 800,
      imageMaxHeight: 800,
    },
    {
      key: "fit",
      label: "fit mode",
      type: "select" as const,
      options: ["contain", "cover"],
      default: "contain",
    },
    { key: "bgColor", label: "background", type: "color" as const, default: -1 },
    { key: "borderColor", label: "border", type: "color" as const, default: -1 },
  ],

  getCompactInfo: (state: ImageState): CompactInfo => ({
    label: state.url ? "image" : "empty image",
    thumbnailUrl: state.url || undefined,
    domain: state.url ? "photo" : undefined,
  }),

  create(ctx: WidgetMountContext<typeof imageSchema>): WidgetController {
    const container = new Container();
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;
    let loadState: LoadState = "empty";
    let currentTexture: Texture | null = null;
    let sprite: Sprite | null = null;
    let loadingAbort: AbortController | null = null;
    // track the URL we last started loading so we can skip stale completions
    let lastRequestedUrl = "";
    let loadedAssetKey = "";

    // background graphics
    const bg = new Graphics();
    container.addChild(bg);

    const drawBg = (w: number, h: number) => {
      const state = ctx.doc.current;
      bg.clear();
      bg.roundRect(0, 0, w, h, state.borderRadius);
      bg.fill(state.bgColor === -1 ? { color: 0, alpha: 0 } : { color: state.bgColor });
      bg.stroke(
        state.borderColor === -1
          ? { color: 0, alpha: 0, width: 1 }
          : { color: state.borderColor, width: 1 }
      );
    };
    drawBg(currentWidth, currentHeight);

    // placeholder text — shown when no URL is set
    const placeholderText = new Text({
      text: "click to add image",
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

    // placeholder dashed border overlay
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

    // click placeholder to upload an image
    const handlePlaceholderClick = async () => {
      if (loadState !== "empty") return;
      const dataUrl = await pickImageAsDataUrl({
        maxWidth: 800,
        maxHeight: 800,
      });
      if (dataUrl) {
        ctx.doc.change((draft) => {
          draft.url = dataUrl;
        });
      }
    };
    placeholderText.on("pointertap", handlePlaceholderClick);
    placeholderBorder.on("pointertap", handlePlaceholderClick);

    // loading text
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

    // error text
    const errorText = new Text({
      text: "failed to load",
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

    // update visibility of overlays based on current load state
    const syncOverlayVisibility = () => {
      placeholderText.visible = loadState === "empty";
      placeholderBorder.visible = loadState === "empty";
      loadingText.visible = loadState === "loading";
      errorText.visible = loadState === "error";
      if (sprite) {
        sprite.visible = loadState === "loaded";
      }
    };

    // fit the sprite within the widget bounds according to the current fit mode
    const fitSprite = (w: number, h: number) => {
      if (!sprite || !currentTexture) return;

      const imageWidth = currentTexture.width;
      const imageHeight = currentTexture.height;
      if (imageWidth === 0 || imageHeight === 0) return;

      const state = ctx.doc.current;
      const scaleX = w / imageWidth;
      const scaleY = h / imageHeight;
      const scale = state.fit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

      sprite.width = imageWidth * scale;
      sprite.height = imageHeight * scale;
      sprite.x = (w - sprite.width) / 2;
      sprite.y = (h - sprite.height) / 2;
    };

    // clean up the current sprite and texture
    const destroySprite = () => {
      if (sprite) {
        container.removeChild(sprite);
        sprite.destroy();
        sprite = null;
      }
      if (loadedAssetKey) {
        Assets.unload(loadedAssetKey);
        // if it was a blob URL, revoke it to free blob memory
        if (loadedAssetKey.startsWith("blob:")) {
          URL.revokeObjectURL(loadedAssetKey);
        }
        loadedAssetKey = "";
      }
      currentTexture = null;
    };

    // load an image from a URL, creating a texture and sprite
    const loadImage = async (url: string) => {
      // abort any in-flight request
      if (loadingAbort) {
        loadingAbort.abort();
        loadingAbort = null;
      }

      // handle empty URL
      if (!url) {
        destroySprite();
        loadState = "empty";
        syncOverlayVisibility();
        return;
      }

      lastRequestedUrl = url;
      loadState = "loading";
      syncOverlayVisibility();

      const abort = new AbortController();
      loadingAbort = abort;

      try {
        let texture: Texture;
        let assetKey: string;

        if (url.startsWith("data:")) {
          // data URL — use Assets.load (PixiJS v8 compatible)
          texture = await Assets.load<Texture>(url);
          assetKey = url;
        } else {
          // remote URL — fetch, create bitmap, then load via Assets
          const response = await fetch(url, { signal: abort.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          texture = await Assets.load<Texture>(blobUrl);
          assetKey = blobUrl;
        }

        // check if this request is still current
        if (abort.signal.aborted || lastRequestedUrl !== url) {
          Assets.unload(assetKey);
          if (assetKey.startsWith("blob:")) {
            URL.revokeObjectURL(assetKey);
          }
          return;
        }

        // tear down previous sprite/texture before creating new ones
        destroySprite();

        currentTexture = texture;
        loadedAssetKey = assetKey;
        sprite = new Sprite(currentTexture);
        // insert sprite above bg but below overlay texts
        container.addChildAt(sprite, 1);

        loadState = "loaded";
        syncOverlayVisibility();
        fitSprite(currentWidth, currentHeight);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (lastRequestedUrl !== url) return;

        destroySprite();
        loadState = "error";
        syncOverlayVisibility();
      } finally {
        if (loadingAbort === abort) {
          loadingAbort = null;
        }
      }
    };

    // center all overlay texts after a resize
    const repositionOverlays = (w: number, h: number) => {
      placeholderText.x = w / 2;
      placeholderText.y = h / 2;
      loadingText.x = w / 2;
      loadingText.y = h / 2;
      errorText.x = w / 2;
      errorText.y = h / 2;
    };

    // subscribe to doc changes — reload image when URL changes, re-fit on fit mode change
    let prevUrl = ctx.doc.current.url;
    const unsub = ctx.doc.on("change", (state) => {
      drawBg(currentWidth, currentHeight);

      if (state.url !== prevUrl) {
        prevUrl = state.url;
        loadImage(state.url);
      } else if (loadState === "loaded") {
        // fit mode or other style changed — re-fit the existing sprite
        fitSprite(currentWidth, currentHeight);
      }
    });

    // kick off initial load if a URL is already set
    if (ctx.doc.current.url) {
      loadImage(ctx.doc.current.url);
    }

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
      },
    };
  },
};
