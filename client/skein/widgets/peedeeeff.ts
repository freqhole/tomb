import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import type {
  CompactInfo,
  HeaderAction,
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

export const peedeeeffSchema = z.object({
  blobId: z.string().default(""),
  filename: z.string().default(""),
  mime: z.string().default(""),
  blake3: z.string().default(""),
  size: z.number().default(0),
  pageCount: z.number().default(0),
  pageBlobIds: z.array(z.string()).default([]),
  currentPage: z.number().default(0),
  pagesPerView: z.number().default(1),
  syncPage: z.boolean().default(true),
  background: z.number().default(0x000000),
});

export type PeedeeeffState = z.infer<typeof peedeeeffSchema>;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type PageLoadState = "empty" | "loading" | "loaded" | "error";

interface PageSlot {
  state: PageLoadState;
  texture: Texture | null;
  sprite: Sprite | null;
  assetKey: string;
  abort: AbortController | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// nav button drawing
// ---------------------------------------------------------------------------

const NAV_BTN_W = 32;
const NAV_BTN_H = 48;
const NAV_BTN_RADIUS = 6;
const NAV_HIDE_DELAY = 1200;

function drawChevron(g: Graphics, direction: "left" | "right", w: number, h: number) {
  g.clear();
  // background pill
  g.roundRect(0, 0, w, h, NAV_BTN_RADIUS);
  g.fill({ color: 0x000000, alpha: 0.45 });

  // chevron arrow
  const cx = w / 2;
  const cy = h / 2;
  const arm = 8;
  g.moveTo(direction === "left" ? cx + arm * 0.4 : cx - arm * 0.4, cy - arm);
  g.lineTo(direction === "left" ? cx - arm * 0.4 : cx + arm * 0.4, cy);
  g.lineTo(direction === "left" ? cx + arm * 0.4 : cx - arm * 0.4, cy + arm);
  g.stroke({ color: 0xffffff, width: 2.5, cap: "round", join: "round" });
}

function drawGoToStartButton(g: Graphics, size: number) {
  g.clear();
  g.roundRect(0, 0, size, size, 4);
  g.fill({ color: 0x000000, alpha: 0.45 });

  // draw a |<< icon
  const cx = size / 2;
  const cy = size / 2;
  const arm = 5;
  // vertical bar
  g.moveTo(cx - arm + 1, cy - arm);
  g.lineTo(cx - arm + 1, cy + arm);
  g.stroke({ color: 0xffffff, width: 2, cap: "round" });
  // double chevron
  g.moveTo(cx + 2, cy - arm);
  g.lineTo(cx - arm + 4, cy);
  g.lineTo(cx + 2, cy + arm);
  g.stroke({ color: 0xffffff, width: 2, cap: "round", join: "round" });
}

// ---------------------------------------------------------------------------
// widget factory
// ---------------------------------------------------------------------------

export const peedeeeffWidget: WidgetFactory<typeof peedeeeffSchema> = {
  type: "peedeeeff",
  metadata: {
    name: "peedeeeff",
    description: "PDF page viewer — displays rendered document pages with navigation",
    version: "0.1.0",
    category: "media",
    defaultWidth: 480,
    defaultHeight: 640,
  },
  schema: peedeeeffSchema,
  editableProps: [
    {
      key: "pagesPerView",
      label: "pages per view",
      type: "number" as const,
      default: 1,
    },
    {
      key: "syncPage",
      label: "sync page position",
      type: "boolean" as const,
      default: true,
    },
    {
      key: "background",
      label: "background",
      type: "color" as const,
      default: 0x000000,
    },
  ],

  getCompactInfo: (state: PeedeeeffState): CompactInfo => ({
    label: state.filename || "document",
    blobId: state.blobId || undefined,
    mime: state.mime || undefined,
    filename: state.filename || undefined,
    blake3: state.blake3 || undefined,
    size: state.size || undefined,
    domain: "document",
  }),

  create(ctx: WidgetMountContext<typeof peedeeeffSchema>): WidgetController {
    const container = new Container();
    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // local page index — may diverge from doc.currentPage when syncPage is false
    let localPage = ctx.doc.current.currentPage;

    // texture cache: page index -> PageSlot
    const pageCache = new Map<number, PageSlot>();

    // nav hide timer
    let navHideTimer: ReturnType<typeof setTimeout> | null = null;
    let navVisible = true;

    // wheel cooldown
    let lastWheelTime = 0;
    const WHEEL_COOLDOWN = 400;

    // -----------------------------------------------------------------------
    // background
    // -----------------------------------------------------------------------

    const bg = new Graphics();
    bg.eventMode = "static";
    container.addChild(bg);

    const drawBg = (w: number, h: number) => {
      const state = ctx.doc.current;
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: state.background });
    };
    drawBg(currentWidth, currentHeight);

    // -----------------------------------------------------------------------
    // placeholder — shown when pageBlobIds is empty
    // -----------------------------------------------------------------------

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
      text: "click to upload PDF",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fill: 0x666680,
        align: "center",
      },
      resolution: 2,
    });
    placeholderText.anchor.set(0.5);
    placeholderText.eventMode = "static";
    placeholderText.cursor = "pointer";
    placeholderText.x = currentWidth / 2;
    placeholderText.y = currentHeight / 2;
    container.addChild(placeholderText);

    // -----------------------------------------------------------------------
    // loading text
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // page container — holds page sprites
    // -----------------------------------------------------------------------

    const pageContainer = new Container();
    container.addChild(pageContainer);

    // -----------------------------------------------------------------------
    // pagination text — "1 / 12" at bottom center
    // -----------------------------------------------------------------------

    const pageInfoText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fill: 0xffffff,
        align: "center",
      },
      resolution: 2,
    });
    pageInfoText.anchor.set(0.5, 1);
    pageInfoText.visible = false;
    container.addChild(pageInfoText);

    // pagination background pill
    const pageInfoBg = new Graphics();
    pageInfoBg.visible = false;
    container.addChild(pageInfoBg);
    // re-add text on top of bg
    container.removeChild(pageInfoText);
    container.addChild(pageInfoText);

    // -----------------------------------------------------------------------
    // nav buttons
    // -----------------------------------------------------------------------

    const prevBtn = new Graphics();
    drawChevron(prevBtn, "left", NAV_BTN_W, NAV_BTN_H);
    prevBtn.eventMode = "static";
    prevBtn.cursor = "pointer";
    prevBtn.visible = false;
    container.addChild(prevBtn);

    const nextBtn = new Graphics();
    drawChevron(nextBtn, "right", NAV_BTN_W, NAV_BTN_H);
    nextBtn.eventMode = "static";
    nextBtn.cursor = "pointer";
    nextBtn.visible = false;
    container.addChild(nextBtn);

    // go-to-start button
    const goStartBtn = new Graphics();
    const GO_START_SIZE = 26;
    drawGoToStartButton(goStartBtn, GO_START_SIZE);
    goStartBtn.eventMode = "static";
    goStartBtn.cursor = "pointer";
    goStartBtn.visible = false;
    container.addChild(goStartBtn);

    // -----------------------------------------------------------------------
    // helpers: total pages + clamping
    // -----------------------------------------------------------------------

    const totalPages = (): number => {
      const state = ctx.doc.current;
      return state.pageBlobIds.length || state.pageCount || 0;
    };

    const effectivePagesPerView = (): number => {
      const state = ctx.doc.current;
      return clamp(state.pagesPerView, 1, 2);
    };

    const clampPage = (page: number): number => {
      const total = totalPages();
      if (total <= 0) return 0;
      return clamp(page, 0, total - 1);
    };

    // -----------------------------------------------------------------------
    // page loading
    // -----------------------------------------------------------------------

    const destroyPageSlot = (slot: PageSlot) => {
      if (slot.abort) {
        slot.abort.abort();
        slot.abort = null;
      }
      if (slot.sprite) {
        pageContainer.removeChild(slot.sprite);
        slot.sprite.destroy();
        slot.sprite = null;
      }
      if (slot.assetKey) {
        Assets.unload(slot.assetKey);
        if (slot.assetKey.startsWith("blob:")) {
          URL.revokeObjectURL(slot.assetKey);
        }
        slot.assetKey = "";
      }
      slot.texture = null;
      slot.state = "empty";
    };

    const loadPageTexture = async (pageIndex: number): Promise<PageSlot> => {
      const state = ctx.doc.current;
      const blobId = state.pageBlobIds[pageIndex];

      // get or create the slot
      let slot = pageCache.get(pageIndex);
      if (slot && slot.state === "loaded" && slot.assetKey && slot.assetKey === `blob:${blobId}`) {
        return slot;
      }

      if (slot) {
        destroyPageSlot(slot);
      }

      slot = {
        state: "loading",
        texture: null,
        sprite: null,
        assetKey: "",
        abort: new AbortController(),
      };
      pageCache.set(pageIndex, slot);

      if (!blobId) {
        slot.state = "empty";
        return slot;
      }

      const abort = slot.abort!;

      try {
        // resolve blob ID to a loadable URL
        const { getLocalBlobUrl, getFullBlobDataUrl } = await import("../src/widgets/file-utils");

        let resolvedUrl = await getLocalBlobUrl(blobId);
        if (!resolvedUrl) {
          // fall back to full blob data URL (no peers — page blobs are local)
          resolvedUrl = await getFullBlobDataUrl(blobId);
        }

        if (!resolvedUrl || abort.signal.aborted) {
          slot.state = "error";
          return slot;
        }

        let texture: Texture;
        let assetKey: string;

        if (resolvedUrl.startsWith("data:") || resolvedUrl.startsWith("asset:")) {
          texture = await Assets.load<Texture>(resolvedUrl);
          assetKey = resolvedUrl;
        } else {
          const response = await fetch(resolvedUrl, { signal: abort.signal });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          texture = await Assets.load<Texture>(blobUrl);
          assetKey = blobUrl;
        }

        if (abort.signal.aborted) {
          Assets.unload(assetKey);
          if (assetKey.startsWith("blob:")) {
            URL.revokeObjectURL(assetKey);
          }
          return slot;
        }

        slot.texture = texture;
        slot.assetKey = assetKey;
        slot.sprite = new Sprite(texture);
        slot.state = "loaded";
        return slot;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return slot;
        }
        slot.state = "error";
        return slot;
      }
    };

    // -----------------------------------------------------------------------
    // fit a single page sprite into a region
    // -----------------------------------------------------------------------

    const fitSpriteToRegion = (
      sprite: Sprite,
      texture: Texture,
      regionX: number,
      regionY: number,
      regionW: number,
      regionH: number
    ) => {
      const imgW = texture.width;
      const imgH = texture.height;
      if (imgW === 0 || imgH === 0) return;

      const scale = Math.min(regionW / imgW, regionH / imgH);
      sprite.width = imgW * scale;
      sprite.height = imgH * scale;
      sprite.x = regionX + (regionW - sprite.width) / 2;
      sprite.y = regionY + (regionH - sprite.height) / 2;
    };

    // -----------------------------------------------------------------------
    // render the current page(s)
    // -----------------------------------------------------------------------

    let renderInFlight = false;

    const renderPages = async () => {
      if (renderInFlight) return;
      renderInFlight = true;

      const state = ctx.doc.current;
      const total = totalPages();
      const ppv = effectivePagesPerView();

      // clear existing sprites from page container
      while (pageContainer.children.length > 0) {
        pageContainer.removeChildAt(0);
      }

      // no pages
      if (total <= 0 || state.pageBlobIds.length === 0) {
        placeholderText.visible = true;
        placeholderBorder.visible = true;
        loadingText.visible = false;
        pageInfoText.visible = false;
        pageInfoBg.visible = false;
        renderInFlight = false;
        updateNavButtons();
        return;
      }

      placeholderText.visible = false;
      placeholderBorder.visible = false;
      loadingText.visible = true;

      // determine which pages to show
      const startPage = clampPage(localPage);
      const endPage = clampPage(startPage + ppv - 1);
      const pagesToShow: number[] = [];
      for (let i = startPage; i <= endPage; i++) {
        pagesToShow.push(i);
      }

      // load all visible pages
      const slots: PageSlot[] = [];
      for (const idx of pagesToShow) {
        const slot = await loadPageTexture(idx);
        slots.push(slot);
      }

      loadingText.visible = false;

      // add sprites to page container and fit them
      const regionW = ppv > 1 ? currentWidth / ppv : currentWidth;
      const regionH = currentHeight;

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.state === "loaded" && slot.sprite && slot.texture) {
          pageContainer.addChild(slot.sprite);
          fitSpriteToRegion(slot.sprite, slot.texture, i * regionW, 0, regionW, regionH);
        }
      }

      // pagination text
      updatePageInfoText(startPage, endPage, total);
      updateNavButtons();

      // preload adjacent pages
      preloadAdjacent(startPage, ppv, total);

      // show nav buttons when pages first become visible
      showNav();

      renderInFlight = false;
    };

    // -----------------------------------------------------------------------
    // preload adjacent pages for instant transitions
    // -----------------------------------------------------------------------

    const preloadAdjacent = (startPage: number, ppv: number, total: number) => {
      const before = startPage - ppv;
      const after = startPage + ppv;
      if (before >= 0) {
        loadPageTexture(before).catch(() => {});
      }
      if (after < total) {
        loadPageTexture(after).catch(() => {});
      }
    };

    // -----------------------------------------------------------------------
    // update pagination info text
    // -----------------------------------------------------------------------

    const updatePageInfoText = (startPage: number, endPage: number, total: number) => {
      if (total <= 0) {
        pageInfoText.visible = false;
        pageInfoBg.visible = false;
        return;
      }

      const display =
        startPage === endPage
          ? `${startPage + 1} / ${total}`
          : `${startPage + 1}-${endPage + 1} / ${total}`;

      pageInfoText.text = display;
      pageInfoText.x = currentWidth / 2;
      pageInfoText.y = currentHeight - 10;
      pageInfoText.visible = navVisible;

      // draw a small pill behind the text
      const tw = pageInfoText.width + 12;
      const th = pageInfoText.height + 6;
      pageInfoBg.clear();
      pageInfoBg.roundRect(currentWidth / 2 - tw / 2, currentHeight - 10 - th, tw, th, 4);
      pageInfoBg.fill({ color: 0x000000, alpha: 0.5 });
      pageInfoBg.visible = navVisible;
    };

    // -----------------------------------------------------------------------
    // update header actions with page info badge
    // -----------------------------------------------------------------------

    const updateHeaderActions = () => {
      if (!ctx.setHeaderActions) return;
      const total = totalPages();
      const page = localPage + 1;
      const label = total > 0 ? `${page}/${total}` : "no pages";
      const actions: HeaderAction[] = [
        {
          id: "page-info",
          label,
          isInfo: true,
        },
      ];
      ctx.setHeaderActions(actions);
    };

    // -----------------------------------------------------------------------
    // nav button positioning and visibility
    // -----------------------------------------------------------------------

    const updateNavButtons = () => {
      const total = totalPages();
      const ppv = effectivePagesPerView();
      const margin = 8;

      // position prev button on left edge, vertically centered
      prevBtn.x = margin;
      prevBtn.y = (currentHeight - NAV_BTN_H) / 2;
      prevBtn.visible = navVisible && localPage > 0 && total > 0;

      // position next button on right edge, vertically centered
      nextBtn.x = currentWidth - NAV_BTN_W - margin;
      nextBtn.y = (currentHeight - NAV_BTN_H) / 2;
      nextBtn.visible = navVisible && localPage + ppv < total && total > 0;

      // go-to-start button near bottom left
      goStartBtn.x = margin;
      goStartBtn.y = currentHeight - GO_START_SIZE - margin - 4;
      goStartBtn.visible = navVisible && localPage > 0 && total > 0;
    };

    // -----------------------------------------------------------------------
    // show/hide nav with auto-hide
    // -----------------------------------------------------------------------

    const showNav = () => {
      navVisible = true;
      updateNavButtons();
      pageInfoText.visible = true;
      pageInfoBg.visible = true;
      resetNavHideTimer();
    };

    const hideNav = () => {
      navVisible = false;
      prevBtn.visible = false;
      nextBtn.visible = false;
      goStartBtn.visible = false;
      pageInfoText.visible = false;
      pageInfoBg.visible = false;
    };

    const resetNavHideTimer = () => {
      if (navHideTimer !== null) {
        clearTimeout(navHideTimer);
      }
      navHideTimer = setTimeout(hideNav, NAV_HIDE_DELAY);
    };

    // -----------------------------------------------------------------------
    // navigation actions
    // -----------------------------------------------------------------------

    const navigateTo = (page: number) => {
      const clamped = clampPage(page);
      if (clamped === localPage) return;
      localPage = clamped;

      const state = ctx.doc.current;
      if (state.syncPage) {
        ctx.doc.change((draft) => {
          draft.currentPage = localPage;
        });
      }

      updateHeaderActions();
      renderPages();
    };

    const navigatePrev = () => {
      const ppv = effectivePagesPerView();
      navigateTo(localPage - ppv);
    };

    const navigateNext = () => {
      const ppv = effectivePagesPerView();
      navigateTo(localPage + ppv);
    };

    const navigateToStart = () => {
      navigateTo(0);
    };

    // -----------------------------------------------------------------------
    // event handlers
    // -----------------------------------------------------------------------

    // nav button clicks
    prevBtn.on("pointertap", (e) => {
      e.stopPropagation();
      navigatePrev();
      showNav();
    });

    nextBtn.on("pointertap", (e) => {
      e.stopPropagation();
      navigateNext();
      showNav();
    });

    goStartBtn.on("pointertap", (e) => {
      e.stopPropagation();
      navigateToStart();
      showNav();
    });

    // placeholder click — upload a PDF file
    const handleUpload = async () => {
      // only allow upload when no pages are loaded
      const state = ctx.doc.current;
      if (state.pageBlobIds.length > 0 || state.blobId) return;

      try {
        const { pickPdfFile, uploadFile, getDocumentPages } =
          await import("../src/widgets/file-utils");

        const picked = await pickPdfFile();
        if (!picked) return;

        // show uploading state
        placeholderText.text = "uploading...";
        placeholderBorder.eventMode = "none";
        placeholderText.eventMode = "none";

        const result = await uploadFile(picked, { waitForCompletion: true });

        // write the PDF blob info into the doc immediately
        ctx.doc.change((draft) => {
          draft.blobId = result.blobId;
          draft.filename = picked.filename;
          draft.mime = result.mime;
          draft.blake3 = result.blake3 ?? "";
          draft.size = result.size;
        });

        // now poll for rendered page images
        placeholderText.text = "processing pages...";

        const maxAttempts = 60; // poll for up to ~60 seconds
        const pollIntervalMs = 1000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));

          const pages = await getDocumentPages(result.blobId);
          if (pages.length > 0) {
            // pages are ready — populate the widget doc
            const blobIds = pages.map((p) => p.page_blob_id);
            const totalPages = pages[0]?.total_pages ?? pages.length;

            ctx.doc.change((draft) => {
              draft.pageBlobIds = blobIds;
              draft.pageCount = totalPages;
              draft.currentPage = 0;
            });

            // set widget title from filename (strip .pdf extension)
            const title = picked.filename.replace(/\.pdf$/i, "");
            ctx.canvasStore?.setWidgetTitle(ctx.widgetId, title);

            // the doc change subscription will trigger rendering
            return;
          }

          // update the placeholder with progress
          placeholderText.text = `processing pages... (${attempt + 1}s)`;
        }

        // timed out — pages may still be rendering
        placeholderText.text = "page rendering in progress...";
        placeholderBorder.eventMode = "static";
        placeholderText.eventMode = "static";
      } catch (err) {
        console.error("[peedeeeff] upload failed:", err);
        placeholderText.text = "upload failed — click to retry";
        placeholderBorder.eventMode = "static";
        placeholderText.eventMode = "static";
      }
    };

    placeholderText.on("pointertap", handleUpload);
    placeholderBorder.on("pointertap", handleUpload);

    // show nav on pointer move over the widget
    container.eventMode = "static";
    container.on("pointermove", () => {
      showNav();
    });

    // wheel navigation
    container.on("wheel", (e) => {
      const now = Date.now();
      if (now - lastWheelTime < WHEEL_COOLDOWN) return;
      lastWheelTime = now;

      // deltaY > 0 = scroll down = next, deltaY < 0 = scroll up = prev
      // also support horizontal: deltaX > 0 = right = next
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta > 0) {
        navigateNext();
      } else if (delta < 0) {
        navigatePrev();
      }
      showNav();
    });

    // -----------------------------------------------------------------------
    // subscribe to doc changes
    // -----------------------------------------------------------------------

    let prevBlobIds = ctx.doc.current.pageBlobIds;
    let prevPpv = ctx.doc.current.pagesPerView;

    const unsub = ctx.doc.on("change", (state) => {
      drawBg(currentWidth, currentHeight);

      // sync page from doc if syncPage is enabled and doc.currentPage differs
      if (state.syncPage && state.currentPage !== localPage) {
        localPage = clampPage(state.currentPage);
        updateHeaderActions();
        renderPages();
        return;
      }

      // check if pageBlobIds changed
      const blobIdsChanged =
        state.pageBlobIds.length !== prevBlobIds.length ||
        state.pageBlobIds.some((id, i) => id !== prevBlobIds[i]);

      if (blobIdsChanged) {
        prevBlobIds = [...state.pageBlobIds];
        // clear cache since blob IDs changed
        for (const [, slot] of pageCache) {
          destroyPageSlot(slot);
        }
        pageCache.clear();
        localPage = clampPage(localPage);
        updateHeaderActions();
        renderPages();
        return;
      }

      // check if pagesPerView changed
      if (state.pagesPerView !== prevPpv) {
        prevPpv = state.pagesPerView;
        renderPages();
        return;
      }
    });

    // -----------------------------------------------------------------------
    // center overlays helper
    // -----------------------------------------------------------------------

    const repositionOverlays = (w: number, h: number) => {
      placeholderText.x = w / 2;
      placeholderText.y = h / 2;
      loadingText.x = w / 2;
      loadingText.y = h / 2;
    };

    // -----------------------------------------------------------------------
    // re-fit all visible sprites after resize
    // -----------------------------------------------------------------------

    const refitVisibleSprites = () => {
      const ppv = effectivePagesPerView();
      const regionW = ppv > 1 ? currentWidth / ppv : currentWidth;
      const regionH = currentHeight;
      let slotIdx = 0;

      for (let i = localPage; i < localPage + ppv && i < totalPages(); i++) {
        const slot = pageCache.get(i);
        if (slot && slot.state === "loaded" && slot.sprite && slot.texture) {
          fitSpriteToRegion(slot.sprite, slot.texture, slotIdx * regionW, 0, regionW, regionH);
        }
        slotIdx++;
      }
    };

    // -----------------------------------------------------------------------
    // initial render
    // -----------------------------------------------------------------------

    updateHeaderActions();
    renderPages();

    // start the nav hide timer
    resetNavHideTimer();

    // -----------------------------------------------------------------------
    // controller
    // -----------------------------------------------------------------------

    return {
      container,

      headerActions: [
        {
          id: "page-info",
          label: totalPages() > 0 ? `${localPage + 1}/${totalPages()}` : "no pages",
          isInfo: true,
        },
      ],

      destroy() {
        if (navHideTimer !== null) {
          clearTimeout(navHideTimer);
          navHideTimer = null;
        }

        unsub();

        // destroy all cached page slots
        for (const [, slot] of pageCache) {
          destroyPageSlot(slot);
        }
        pageCache.clear();

        container.destroy({ children: true });
      },

      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        drawBg(width, height);
        drawPlaceholderBorder(width, height);
        repositionOverlays(width, height);
        refitVisibleSprites();
        updateNavButtons();

        // re-render pagination text position
        const total = totalPages();
        if (total > 0) {
          const ppv = effectivePagesPerView();
          const startPage = clampPage(localPage);
          const endPage = clampPage(startPage + ppv - 1);
          updatePageInfoText(startPage, endPage, total);
        }
      },
    };
  },
};
