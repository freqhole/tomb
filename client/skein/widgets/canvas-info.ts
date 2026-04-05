import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import type { CanvasStore } from "../src/canvas/canvas-store";
import { createDomOverlay, type DomOverlayHandle } from "../src/widgets/dom-overlay";
import { colorToCss } from "../src/widgets/format";
import { pickImageAsDataUrl } from "../src/widgets/image-utils";
import type {
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../src/widgets/widget-types";

// -- constants ----------------------------------------------------------------

const PADDING = 10;
const TAB_HEIGHT = 28;
const BORDER_RADIUS = 8;

const BG_COLOR = 0x1e1e2e;
const BORDER_COLOR = 0x333355;
const TAB_BG_COLOR = 0x181828;
const ACCENT_COLOR = 0xd946ef;
const TEXT_PRIMARY = 0xe2e8f0;
const TEXT_SECONDARY = 0x94a3b8;
const TEXT_DIM = 0x666680;
const TEXT_ACTIVE = 0xffffff;
const TEXT_INACTIVE = 0x888899;
const BUTTON_BG = 0x2a2a3e;

const SWATCH_COLORS = [
  0xd946ef, 0x06b6d4, 0x22c55e, 0xeab308, 0xf97316, 0xef4444, 0x8b5cf6, 0x64748b,
];
const SWATCH_RADIUS = 8;
const SWATCH_GAP = 6;

// -- schema -------------------------------------------------------------------

export const canvasInfoSchema = z.object({
  activeTab: z.enum(["details", "history"]).default("details"),
});

export type CanvasInfoState = z.infer<typeof canvasInfoSchema>;

// -- helpers ------------------------------------------------------------------

/** format an ISO date string as YYYY-MM-DD */
function shortDate(iso: string): string {
  if (!iso) return "—";
  try {
    return iso.slice(0, 10);
  } catch {
    return "—";
  }
}

/** format an ISO date string as YYYY-MM-DD HH:MM */
function shortDateTime(iso: string): string {
  if (!iso) return "—";
  try {
    return iso.slice(0, 16).replace("T", " ");
  } catch {
    return "—";
  }
}

// -- widget factory -----------------------------------------------------------

export const canvasInfoWidget: WidgetFactory<typeof canvasInfoSchema> = {
  type: "canvas-info",
  metadata: {
    name: "canvas info",
    description: "view and edit canvas metadata, see document stats",
    version: "0.1.0",
    category: "canvas",
    singleton: true,
    defaultWidth: 280,
    defaultHeight: 340,
  },
  schema: canvasInfoSchema,

  create(ctx: WidgetMountContext<typeof canvasInfoSchema>): WidgetController {
    const container = new Container();
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // -- fallback when canvasStore is unavailable ----------------------------

    if (!ctx.canvasStore) {
      const fallbackBg = new Graphics();
      fallbackBg.roundRect(0, 0, currentWidth, currentHeight, BORDER_RADIUS);
      fallbackBg.fill({ color: BG_COLOR });
      fallbackBg.stroke({ color: BORDER_COLOR, width: 1 });
      container.addChild(fallbackBg);

      const fallbackText = new Text({
        text: "canvas info not available",
        style: { fontFamily: "system-ui, sans-serif", fontSize: 12, fill: TEXT_DIM },
      });
      fallbackText.x = PADDING;
      fallbackText.y = PADDING;
      container.addChild(fallbackText);

      return {
        container,
        destroy() {
          container.destroy({ children: true });
        },
        resize(w: number, h: number) {
          fallbackBg.clear();
          fallbackBg.roundRect(0, 0, w, h, BORDER_RADIUS);
          fallbackBg.fill({ color: BG_COLOR });
          fallbackBg.stroke({ color: BORDER_COLOR, width: 1 });
        },
      };
    }

    const canvasStore: CanvasStore = ctx.canvasStore;

    // -- main background ------------------------------------------------------

    const bg = new Graphics();
    container.addChild(bg);

    const drawBg = (w: number, h: number) => {
      bg.clear();
      bg.roundRect(0, 0, w, h, BORDER_RADIUS);
      bg.fill({ color: BG_COLOR });
      bg.stroke({ color: BORDER_COLOR, width: 1 });
    };
    drawBg(currentWidth, currentHeight);

    // -- tab bar --------------------------------------------------------------

    const tabBar = new Container();
    tabBar.y = 0;
    container.addChild(tabBar);

    const tabBarBg = new Graphics();
    tabBar.addChild(tabBarBg);

    const drawTabBarBg = (w: number) => {
      tabBarBg.clear();
      // top-rounded rect for tab bar area
      tabBarBg.roundRect(0, 0, w, TAB_HEIGHT, BORDER_RADIUS);
      tabBarBg.fill({ color: TAB_BG_COLOR });
      // cover bottom rounding with a plain rect
      tabBarBg.rect(0, TAB_HEIGHT / 2, w, TAB_HEIGHT / 2);
      tabBarBg.fill({ color: TAB_BG_COLOR });
    };
    drawTabBarBg(currentWidth);

    // tab separator line at the bottom of the tab bar
    const tabSeparator = new Graphics();
    tabBar.addChild(tabSeparator);

    const drawTabSeparator = (w: number) => {
      tabSeparator.clear();
      tabSeparator.moveTo(0, TAB_HEIGHT);
      tabSeparator.lineTo(w, TAB_HEIGHT);
      tabSeparator.stroke({ color: BORDER_COLOR, width: 1 });
    };
    drawTabSeparator(currentWidth);

    // accent underline for active tab
    const tabUnderline = new Graphics();
    tabBar.addChild(tabUnderline);

    const TAB_LABEL_FONT = { fontFamily: "system-ui, sans-serif", fontSize: 11 };

    const detailsTabText = new Text({
      text: "details",
      style: { ...TAB_LABEL_FONT, fill: TEXT_ACTIVE },
    });
    detailsTabText.x = PADDING;
    detailsTabText.y = (TAB_HEIGHT - detailsTabText.height) / 2;
    tabBar.addChild(detailsTabText);

    const historyTabText = new Text({
      text: "history",
      style: { ...TAB_LABEL_FONT, fill: TEXT_INACTIVE },
    });
    historyTabText.x = PADDING + detailsTabText.width + 20;
    historyTabText.y = (TAB_HEIGHT - historyTabText.height) / 2;
    tabBar.addChild(historyTabText);

    // clickable hit areas for tabs
    const detailsHit = new Graphics();
    detailsHit.rect(0, 0, detailsTabText.width + 20, TAB_HEIGHT);
    detailsHit.fill({ color: 0xffffff, alpha: 0 });
    detailsHit.x = PADDING - 4;
    detailsHit.eventMode = "static";
    detailsHit.cursor = "pointer";
    tabBar.addChild(detailsHit);

    const historyHit = new Graphics();
    historyHit.rect(0, 0, historyTabText.width + 20, TAB_HEIGHT);
    historyHit.fill({ color: 0xffffff, alpha: 0 });
    historyHit.x = historyTabText.x - 4;
    historyHit.eventMode = "static";
    historyHit.cursor = "pointer";
    tabBar.addChild(historyHit);

    const drawTabUnderline = () => {
      const activeTab = ctx.doc.current.activeTab;
      const target = activeTab === "details" ? detailsTabText : historyTabText;
      tabUnderline.clear();
      tabUnderline.moveTo(target.x, TAB_HEIGHT - 2);
      tabUnderline.lineTo(target.x + target.width, TAB_HEIGHT - 2);
      tabUnderline.stroke({ color: ACCENT_COLOR, width: 2 });
    };
    drawTabUnderline();

    const updateTabStyles = () => {
      const activeTab = ctx.doc.current.activeTab;
      detailsTabText.style.fill = activeTab === "details" ? TEXT_ACTIVE : TEXT_INACTIVE;
      historyTabText.style.fill = activeTab === "history" ? TEXT_ACTIVE : TEXT_INACTIVE;
      drawTabUnderline();
    };

    const switchTab = (tab: "details" | "history") => {
      if (ctx.doc.current.activeTab === tab) return;
      ctx.doc.change((draft) => {
        draft.activeTab = tab;
      });
      updateTabStyles();
      syncTabVisibility();
    };

    detailsHit.on("pointertap", () => switchTab("details"));
    historyHit.on("pointertap", () => switchTab("history"));

    // -- content area with clip mask ------------------------------------------

    const contentY = TAB_HEIGHT + 1;

    const contentClip = new Graphics();
    container.addChild(contentClip);

    const drawContentClip = (w: number, h: number) => {
      contentClip.clear();
      contentClip.rect(0, contentY, w, h - contentY);
      contentClip.fill({ color: 0xffffff });
    };
    drawContentClip(currentWidth, currentHeight);

    // -- details tab ----------------------------------------------------------

    const detailsContainer = new Container();
    detailsContainer.x = PADDING;
    detailsContainer.y = contentY + PADDING;
    detailsContainer.mask = contentClip;
    container.addChild(detailsContainer);

    // title display
    const meta = canvasStore.metadata();

    const titleText = new Text({
      text: meta.title || "untitled canvas",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        fontWeight: "bold",
        fill: meta.title ? TEXT_PRIMARY : TEXT_DIM,
        fontStyle: meta.title ? "normal" : "italic",
        wordWrap: true,
        wordWrapWidth: currentWidth - PADDING * 2,
      },
    });
    detailsContainer.addChild(titleText);

    // description display
    const descText = new Text({
      text: meta.description || "no description",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fill: meta.description ? TEXT_SECONDARY : TEXT_DIM,
        fontStyle: meta.description ? "normal" : "italic",
        wordWrap: true,
        wordWrapWidth: currentWidth - PADDING * 2,
      },
    });
    descText.y = titleText.y + titleText.height + 8;
    detailsContainer.addChild(descText);

    // color label
    const colorLabel = new Text({
      text: "color",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fill: TEXT_DIM },
    });
    detailsContainer.addChild(colorLabel);

    // color swatches container
    const swatchContainer = new Container();
    detailsContainer.addChild(swatchContainer);

    const swatchGraphics: Graphics[] = [];

    const drawSwatches = () => {
      // clear previous
      swatchContainer.removeChildren();
      swatchGraphics.length = 0;

      const currentColor = canvasStore.metadata().color;

      for (let i = 0; i < SWATCH_COLORS.length; i++) {
        const color = SWATCH_COLORS[i];
        const g = new Graphics();
        const cx = i * (SWATCH_RADIUS * 2 + SWATCH_GAP) + SWATCH_RADIUS;
        const cy = SWATCH_RADIUS;

        // white ring for active color
        if (color === currentColor) {
          g.circle(cx, cy, SWATCH_RADIUS + 2);
          g.stroke({ color: 0xffffff, width: 2 });
        }

        g.circle(cx, cy, SWATCH_RADIUS);
        g.fill({ color });

        g.eventMode = "static";
        g.cursor = "pointer";
        g.on("pointertap", () => {
          canvasStore.setColor(color);
        });

        swatchContainer.addChild(g);
        swatchGraphics.push(g);
      }
    };

    // image preview area
    const imageContainer = new Container();
    detailsContainer.addChild(imageContainer);

    let previewSprite: Sprite | null = null;
    let previewTexture: Texture | null = null;
    let loadedAssetKey = "";

    const setImageText = new Text({
      text: "set image",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 10,
        fill: TEXT_DIM,
      },
    });
    setImageText.eventMode = "static";
    setImageText.cursor = "pointer";
    imageContainer.addChild(setImageText);

    // underline effect on hover
    setImageText.on("pointerover", () => {
      setImageText.style.fill = TEXT_SECONDARY;
    });
    setImageText.on("pointerout", () => {
      setImageText.style.fill = TEXT_DIM;
    });

    setImageText.on("pointertap", async () => {
      const url = await pickImageAsDataUrl({ maxWidth: 320, maxHeight: 200 });
      if (url) {
        canvasStore.setPreviewUrl(url);
      }
    });

    const destroyPreview = () => {
      if (previewSprite) {
        imageContainer.removeChild(previewSprite);
        previewSprite.destroy();
        previewSprite = null;
      }
      if (loadedAssetKey) {
        Assets.unload(loadedAssetKey);
        if (loadedAssetKey.startsWith("blob:")) {
          URL.revokeObjectURL(loadedAssetKey);
        }
        loadedAssetKey = "";
      }
      previewTexture = null;
    };

    const loadPreview = async (url: string) => {
      destroyPreview();
      if (!url) {
        setImageText.y = 0;
        return;
      }
      try {
        const texture = await Assets.load<Texture>(url);
        previewTexture = texture;
        loadedAssetKey = url;

        const maxW = currentWidth - PADDING * 2;
        const maxH = 80;
        const aspect = texture.width / texture.height;
        let w = texture.width;
        let h = texture.height;
        if (h > maxH) {
          h = maxH;
          w = h * aspect;
        }
        if (w > maxW) {
          w = maxW;
          h = w / aspect;
        }

        previewSprite = new Sprite(texture);
        previewSprite.width = w;
        previewSprite.height = h;
        imageContainer.addChildAt(previewSprite, 0);

        setImageText.y = h + 4;
      } catch {
        setImageText.y = 0;
      }
    };

    // layout details content vertically
    const layoutDetails = () => {
      const availW = currentWidth - PADDING * 2;
      titleText.style.wordWrapWidth = availW;
      descText.style.wordWrapWidth = availW;

      descText.y = titleText.y + titleText.height + 8;
      colorLabel.y = descText.y + descText.height + 12;
      swatchContainer.y = colorLabel.y + colorLabel.height + 4;
      imageContainer.y = swatchContainer.y + SWATCH_RADIUS * 2 + 12;
    };

    // initial swatch draw and preview load
    drawSwatches();
    layoutDetails();
    if (meta.previewUrl) {
      loadPreview(meta.previewUrl);
    }

    // -- editing overlays (double-click) --------------------------------------

    let titleOverlay: DomOverlayHandle | null = null;
    let descOverlay: DomOverlayHandle | null = null;
    let lastTitleTap = 0;
    let lastDescTap = 0;

    titleText.eventMode = "static";
    titleText.cursor = "text";
    titleText.on("pointertap", () => {
      const now = Date.now();
      if (now - lastTitleTap < 400) {
        startTitleEdit();
        lastTitleTap = 0;
      } else {
        lastTitleTap = now;
      }
    });

    descText.eventMode = "static";
    descText.cursor = "text";
    descText.on("pointertap", () => {
      const now = Date.now();
      if (now - lastDescTap < 400) {
        startDescEdit();
        lastDescTap = 0;
      } else {
        lastDescTap = now;
      }
    });

    const startTitleEdit = () => {
      if (titleOverlay) return;
      titleText.visible = false;

      const m = canvasStore.metadata();
      // create a temporary anchor container at the title's global position
      const anchor = new Container();
      anchor.x = detailsContainer.x;
      anchor.y = detailsContainer.y + titleText.y;
      container.addChild(anchor);

      titleOverlay = createDomOverlay({
        container: anchor,
        canvasElement: ctx.canvasElement,
        width: currentWidth - PADDING * 2,
        height: 24,
        multiline: false,
        value: m.title,
        enterCommits: true,
        selectAll: true,
        placeholder: "untitled canvas",
        onCommit: (value: string) => {
          titleOverlay = null;
          container.removeChild(anchor);
          anchor.destroy();
          canvasStore.setTitle(value.trim());
          refreshDetailsFromStore();
          titleText.visible = true;
        },
        onRevert: () => {
          titleOverlay = null;
          container.removeChild(anchor);
          anchor.destroy();
          titleText.visible = true;
        },
        css: {
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
          fontWeight: "bold",
          color: colorToCss(TEXT_PRIMARY),
          padding: "0",
          background: colorToCss(TAB_BG_COLOR),
          borderRadius: "3px",
        },
      });
    };

    const startDescEdit = () => {
      if (descOverlay) return;
      descText.visible = false;

      const m = canvasStore.metadata();
      const anchor = new Container();
      anchor.x = detailsContainer.x;
      anchor.y = detailsContainer.y + descText.y;
      container.addChild(anchor);

      descOverlay = createDomOverlay({
        container: anchor,
        canvasElement: ctx.canvasElement,
        width: currentWidth - PADDING * 2,
        height: 60,
        multiline: true,
        value: m.description,
        enterCommits: false,
        placeholder: "no description",
        onCommit: (value: string) => {
          descOverlay = null;
          container.removeChild(anchor);
          anchor.destroy();
          canvasStore.setDescription(value.trim());
          refreshDetailsFromStore();
          descText.visible = true;
        },
        onRevert: () => {
          descOverlay = null;
          container.removeChild(anchor);
          anchor.destroy();
          descText.visible = true;
        },
        css: {
          fontFamily: "system-ui, sans-serif",
          fontSize: "12px",
          color: colorToCss(TEXT_SECONDARY),
          padding: "0",
          background: colorToCss(TAB_BG_COLOR),
          borderRadius: "3px",
          lineHeight: "1.4",
        },
      });
    };

    // refresh the details tab text from the canvas store
    const refreshDetailsFromStore = () => {
      const m = canvasStore.metadata();
      titleText.text = m.title || "untitled canvas";
      titleText.style.fill = m.title ? TEXT_PRIMARY : TEXT_DIM;
      titleText.style.fontStyle = m.title ? "normal" : "italic";

      descText.text = m.description || "no description";
      descText.style.fill = m.description ? TEXT_SECONDARY : TEXT_DIM;
      descText.style.fontStyle = m.description ? "normal" : "italic";

      drawSwatches();
      layoutDetails();
    };

    // -- history tab ----------------------------------------------------------

    const historyContainer = new Container();
    historyContainer.x = PADDING;
    historyContainer.y = contentY + PADDING;
    historyContainer.mask = contentClip;
    historyContainer.visible = false;
    container.addChild(historyContainer);

    const STAT_FONT = { fontFamily: "system-ui, sans-serif", fontSize: 12, fill: TEXT_SECONDARY };
    const DIM_FONT = { fontFamily: "monospace", fontSize: 10, fill: TEXT_DIM };

    const widgetCountText = new Text({ text: "", style: { ...STAT_FONT } });
    historyContainer.addChild(widgetCountText);

    const createdText = new Text({ text: "", style: { ...DIM_FONT } });
    historyContainer.addChild(createdText);

    const modifiedText = new Text({ text: "", style: { ...DIM_FONT } });
    historyContainer.addChild(modifiedText);

    const changesText = new Text({ text: "", style: { ...DIM_FONT } });
    historyContainer.addChild(changesText);

    const docSizeText = new Text({ text: "", style: { ...DIM_FONT } });
    historyContainer.addChild(docSizeText);

    // compact button (disabled placeholder)
    const compactContainer = new Container();
    historyContainer.addChild(compactContainer);

    const compactBg = new Graphics();
    compactContainer.addChild(compactBg);

    const compactText = new Text({
      text: "compact (coming soon)",
      style: { fontFamily: "system-ui, sans-serif", fontSize: 11, fill: TEXT_DIM },
    });
    compactContainer.addChild(compactText);

    const drawCompactButton = () => {
      const bw = compactText.width + 16;
      const bh = compactText.height + 8;
      compactBg.clear();
      compactBg.roundRect(0, 0, bw, bh, 4);
      compactBg.fill({ color: BUTTON_BG, alpha: 0.5 });
      compactText.x = 8;
      compactText.y = 4;
    };

    const layoutHistory = () => {
      let y = 0;

      widgetCountText.y = y;
      y += widgetCountText.height + 8;

      createdText.y = y;
      y += createdText.height + 4;

      modifiedText.y = y;
      y += modifiedText.height + 10;

      changesText.y = y;
      y += changesText.height + 4;

      docSizeText.y = y;
      y += docSizeText.height + 14;

      compactContainer.y = y;
      drawCompactButton();
    };

    const refreshHistory = () => {
      const m = canvasStore.metadata();
      const wCount = canvasStore.widgetCount();

      widgetCountText.text = `${wCount} widget${wCount !== 1 ? "s" : ""}`;
      createdText.text = `created: ${shortDate(m.createdAt)}`;
      modifiedText.text = `modified: ${shortDateTime(m.lastModified)}`;

      // show placeholders while async stats load
      changesText.text = "changes: ...";
      docSizeText.text = "doc size: ...";

      layoutHistory();

      // load automerge stats asynchronously (dynamic import)
      loadAutomergeStats();
    };

    const loadAutomergeStats = async () => {
      try {
        const Automerge = await import("@automerge/automerge");
        const doc = canvasStore.handle.doc();
        if (!doc) {
          changesText.text = "changes: unknown";
          docSizeText.text = "doc size: unknown";
          layoutHistory();
          return;
        }

        try {
          const changes = Automerge.getAllChanges(doc);
          changesText.text = `changes: ${changes.length}`;
        } catch {
          changesText.text = "changes: unknown";
        }

        try {
          const bytes = Automerge.save(doc);
          const kb = (bytes.byteLength / 1024).toFixed(1);
          docSizeText.text = `doc size: ${kb} KB`;
        } catch {
          docSizeText.text = "doc size: unknown";
        }

        layoutHistory();
      } catch {
        changesText.text = "changes: unavailable";
        docSizeText.text = "doc size: unavailable";
        layoutHistory();
      }
    };

    // -- tab visibility -------------------------------------------------------

    const syncTabVisibility = () => {
      const activeTab = ctx.doc.current.activeTab;
      detailsContainer.visible = activeTab === "details";
      historyContainer.visible = activeTab === "history";

      if (activeTab === "details") {
        refreshDetailsFromStore();
      } else {
        refreshHistory();
      }
    };

    syncTabVisibility();

    // -- subscribe to canvas store changes ------------------------------------

    let prevPreviewUrl = meta.previewUrl;

    const unsubCanvas = canvasStore.onChange(() => {
      const newMeta = canvasStore.metadata();

      // reload preview image if it changed
      if (newMeta.previewUrl !== prevPreviewUrl) {
        prevPreviewUrl = newMeta.previewUrl;
        loadPreview(newMeta.previewUrl);
      }

      // refresh whichever tab is active
      const activeTab = ctx.doc.current.activeTab;
      if (activeTab === "details") {
        refreshDetailsFromStore();
      } else {
        refreshHistory();
      }
    });

    // subscribe to per-widget doc changes (tab switching)
    const unsubDoc = ctx.doc.on("change", () => {
      updateTabStyles();
      syncTabVisibility();
    });

    // -- controller -----------------------------------------------------------

    return {
      container,

      destroy() {
        if (titleOverlay) {
          titleOverlay.remove();
          titleOverlay = null;
        }
        if (descOverlay) {
          descOverlay.remove();
          descOverlay = null;
        }
        unsubCanvas();
        unsubDoc();
        destroyPreview();
        container.destroy({ children: true });
      },

      resize(width: number, height: number) {
        // dismiss any open overlays on resize
        if (titleOverlay) {
          titleOverlay.element.blur();
        }
        if (descOverlay) {
          descOverlay.element.blur();
        }

        currentWidth = width;
        currentHeight = height;

        drawBg(width, height);
        drawTabBarBg(width);
        drawTabSeparator(width);
        drawTabUnderline();
        drawContentClip(width, height);

        // re-layout details content with new width
        titleText.style.wordWrapWidth = width - PADDING * 2;
        descText.style.wordWrapWidth = width - PADDING * 2;
        layoutDetails();

        // re-layout history
        layoutHistory();

        // re-fit preview sprite if present
        if (previewSprite && previewTexture) {
          const maxW = width - PADDING * 2;
          const maxH = 80;
          const aspect = previewTexture.width / previewTexture.height;
          let w = previewTexture.width;
          let h = previewTexture.height;
          if (h > maxH) {
            h = maxH;
            w = h * aspect;
          }
          if (w > maxW) {
            w = maxW;
            h = w / aspect;
          }
          previewSprite.width = w;
          previewSprite.height = h;
          setImageText.y = h + 4;
        }
      },
    };
  },
};
