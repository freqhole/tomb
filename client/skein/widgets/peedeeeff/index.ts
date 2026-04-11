/**
 * peedeeeff widget — PDF page viewer with navigation, snatch, and save/reveal.
 *
 * this is the orchestrator module. it wires together:
 * - types.ts — schema, types, constants
 * - drawing.ts — pure PixiJS drawing (chevrons, pills, sprite fitting)
 * - pages.ts — page texture cache
 * - snatch.ts — locality checking, batch snatch, save/reveal
 */

import { Container, Graphics, Text } from "pixi.js";
import { isTauriMode } from "../../src/p2p/tauri-transport";
import {
  getDocumentPages,
  getLocalNodeId,
  pickPdfFile,
  uploadFile,
  type PeersMap,
} from "../../src/widgets/file-utils";
import type {
  CompactInfo,
  HeaderAction,
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";
import { createPillButton, drawChevron, drawGoToStartButton, fitSpriteToRegion } from "./drawing";
import { createPageCache } from "./pages";
import { checkPdfLocality, revealPdfInFinder, savePdfToDisk, snatchPdfContent } from "./snatch";
import {
  clamp,
  GO_START_SIZE,
  NAV_BTN_H,
  NAV_BTN_W,
  NAV_HIDE_DELAY,
  peedeeeffSchema,
  type ActionState,
  type PeedeeeffState,
} from "./types";

// ---------------------------------------------------------------------------
// re-exports for the widget registry and other consumers
// ---------------------------------------------------------------------------

export { peedeeeffSchema } from "./types";
export type { PeedeeeffState } from "./types";

// ---------------------------------------------------------------------------
// widget factory
// ---------------------------------------------------------------------------

export const peedeeeffWidget: WidgetFactory<typeof peedeeeffSchema> = {
  type: "peedeeeff",
  metadata: {
    name: "peedeeeff",
    description: "PDF page viewer — displays rendered document pages with navigation",
    version: "0.3.0",
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
      default: 0xffffff,
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

    // page texture cache (extracted module)
    const pageCache = createPageCache();

    // nav hide timer
    let navHideTimer: ReturnType<typeof setTimeout> | null = null;
    let navVisible = true;

    // action / snatch state
    let actionState: ActionState = "checking";
    let snatchAbort: AbortController | null = null;
    let snatchCancelled = false;
    let snatchProgressText = "";
    let snatchHovered = false;

    // hover tracking (for keyboard nav)
    let isHovering = false;
    let destroyed = false;

    // render queue — ensures the last render request always runs
    let renderInFlight = false;
    let needsRerender = false;

    // -----------------------------------------------------------------------
    // background — white when pages loaded, black when empty/remote
    // -----------------------------------------------------------------------

    const bg = new Graphics();
    bg.eventMode = "static";
    container.addChild(bg);

    const drawBg = (w: number, h: number) => {
      const state = ctx.doc.current;
      const hasPages = state.pageBlobIds.length > 0;
      const isLocal = actionState === "local" || actionState === "snatched";
      bg.clear();
      bg.rect(0, 0, w, h);
      // use configured background when pages exist and local, black otherwise
      bg.fill({ color: hasPages && isLocal ? state.background : 0x000000 });
    };
    drawBg(currentWidth, currentHeight);

    // -----------------------------------------------------------------------
    // placeholder — shown when no blobId and no pageBlobIds (upload prompt)
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
    placeholderBorder.visible = false;
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
    placeholderText.visible = false;
    container.addChild(placeholderText);

    // -----------------------------------------------------------------------
    // status text — shown for remote/snatching/empty-pages states
    // -----------------------------------------------------------------------

    const statusText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fill: 0x999999,
        align: "center",
      },
      resolution: 2,
    });
    statusText.anchor.set(0.5);
    statusText.x = currentWidth / 2;
    statusText.y = currentHeight / 2 - 16;
    statusText.visible = false;
    container.addChild(statusText);

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
    // snatch button — positioned below status text, centered
    // -----------------------------------------------------------------------

    const snatchBtn = createPillButton("snatch", 0x2d5a27, () => {
      if (actionState === "snatching") {
        cancelSnatch();
      } else {
        handleSnatch();
      }
    });
    snatchBtn.container.visible = false;
    container.addChild(snatchBtn.container);

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
    // sync the empty / remote / upload overlay visibility
    // -----------------------------------------------------------------------

    const positionSnatchBtn = () => {
      if (snatchBtn.container.visible) {
        snatchBtn.container.x = currentWidth / 2 - snatchBtn.getWidth() / 2;
        snatchBtn.container.y = currentHeight / 2 + 14;
      }
    };

    const syncOverlayVisibility = () => {
      const state = ctx.doc.current;
      const hasBlob = !!state.blobId;
      const hasPages = state.pageBlobIds.length > 0;

      if (!hasBlob && !hasPages) {
        // no blob, no pages — show upload prompt
        placeholderBorder.visible = true;
        placeholderText.visible = true;
        statusText.visible = false;
        snatchBtn.setVisible(false);
        loadingText.visible = false;
      } else if (hasBlob && !hasPages) {
        // blob exists but no pages rendered
        placeholderBorder.visible = false;
        placeholderText.visible = false;
        if (actionState === "remote" || actionState === "checking") {
          statusText.text = "PDF pages not available\nsnatch to download";
          statusText.visible = true;
          snatchBtn.setVisible(actionState === "remote");
        } else if (actionState === "snatching") {
          statusText.visible = true;
          snatchBtn.setVisible(true);
        } else {
          statusText.text = "waiting for page rendering...";
          statusText.visible = true;
          snatchBtn.setVisible(false);
        }
        loadingText.visible = false;
      } else if (hasPages && (actionState === "remote" || actionState === "checking")) {
        // pages exist but blobs may be remote
        placeholderBorder.visible = false;
        placeholderText.visible = false;
        statusText.text = "page images not local\nsnatch to download";
        statusText.visible = true;
        snatchBtn.setVisible(actionState === "remote");
        loadingText.visible = false;
      } else {
        // pages exist and are local (or snatching in progress with some loaded)
        placeholderBorder.visible = false;
        placeholderText.visible = false;
        statusText.visible = false;
        snatchBtn.setVisible(false);
      }

      positionSnatchBtn();
    };

    // -----------------------------------------------------------------------
    // render the current page(s)
    // -----------------------------------------------------------------------

    const renderPages = async () => {
      if (renderInFlight) {
        needsRerender = true;
        return;
      }
      renderInFlight = true;
      needsRerender = false;

      try {
        await doRenderPages();
      } finally {
        renderInFlight = false;
        if (needsRerender && !destroyed) {
          needsRerender = false;
          renderPages();
        }
      }
    };

    const doRenderPages = async () => {
      const state = ctx.doc.current;
      const total = totalPages();
      const ppv = effectivePagesPerView();

      // clear existing sprites from page container
      while (pageContainer.children.length > 0) {
        pageContainer.removeChildAt(0);
      }

      // redraw background (may switch between white/black)
      drawBg(currentWidth, currentHeight);

      // no pages — show overlay
      if (total <= 0 || state.pageBlobIds.length === 0) {
        syncOverlayVisibility();
        pageInfoText.visible = false;
        pageInfoBg.visible = false;
        updateNavButtons();
        return;
      }

      // if blobs are remote, show the remote overlay instead of trying to load
      if (actionState === "remote" || actionState === "checking") {
        syncOverlayVisibility();
        pageInfoText.visible = false;
        pageInfoBg.visible = false;
        updateNavButtons();
        return;
      }

      // hide overlays — we're loading pages
      placeholderText.visible = false;
      placeholderBorder.visible = false;
      statusText.visible = false;
      snatchBtn.setVisible(false);
      loadingText.visible = true;

      // determine which pages to show
      const startPage = clampPage(localPage);
      const endPage = clampPage(startPage + ppv - 1);
      const pagesToShow: number[] = [];
      for (let i = startPage; i <= endPage; i++) {
        pagesToShow.push(i);
      }

      // load all visible pages
      const slots = [];
      for (const idx of pagesToShow) {
        const blobId = state.pageBlobIds[idx];
        const blake3 = state.pageBlake3s?.[idx] || undefined;
        const slot = await pageCache.loadPageTexture(idx, blobId, blake3);
        slots.push(slot);
      }

      loadingText.visible = false;

      // check if any page loaded — if none, might indicate remote blobs
      const anyLoaded = slots.some((s) => s.state === "loaded");
      if (!anyLoaded && slots.length > 0) {
        // all pages failed to load — might be remote
        if (actionState !== "snatching") {
          statusText.text = "page images not available\nsnatch to download";
          statusText.visible = true;
          actionState = "remote";
          snatchBtn.setVisible(true);
          positionSnatchBtn();
          drawBg(currentWidth, currentHeight);
          updateHeaderActions();
        }
        updateNavButtons();
        return;
      }

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
    };

    // -----------------------------------------------------------------------
    // show a single page progressively (called during snatch)
    // -----------------------------------------------------------------------

    const showSinglePage = async (pageIndex: number) => {
      const state = ctx.doc.current;
      const ppv = effectivePagesPerView();

      // only render if this page is currently visible
      if (pageIndex < localPage || pageIndex >= localPage + ppv) return;

      const blobId = state.pageBlobIds[pageIndex];
      const blake3 = state.pageBlake3s?.[pageIndex] || undefined;
      if (!blobId) return;

      const slot = await pageCache.loadPageTexture(pageIndex, blobId, blake3);
      if (slot.state !== "loaded" || !slot.sprite || !slot.texture) return;

      // add sprite to page container if not already there
      if (!slot.sprite.parent) {
        pageContainer.addChild(slot.sprite);
      }

      // position it
      const visibleIndex = pageIndex - localPage;
      const regionW = ppv > 1 ? currentWidth / ppv : currentWidth;
      const regionH = currentHeight;
      fitSpriteToRegion(slot.sprite, slot.texture, visibleIndex * regionW, 0, regionW, regionH);

      // hide status overlays since we have at least one visible page
      statusText.visible = false;
      snatchBtn.setVisible(false);
      loadingText.visible = false;

      // redraw background as white now that pages are showing
      drawBg(currentWidth, currentHeight);

      // update pagination
      const total = totalPages();
      const startPage = clampPage(localPage);
      const endPage = clampPage(startPage + ppv - 1);
      updatePageInfoText(startPage, endPage, total);
      showNav();
    };

    // -----------------------------------------------------------------------
    // preload adjacent pages for instant transitions
    // -----------------------------------------------------------------------

    const preloadAdjacent = (startPage: number, ppv: number, total: number) => {
      const state = ctx.doc.current;
      const before = startPage - ppv;
      const after = startPage + ppv;
      if (before >= 0) {
        const blobId = state.pageBlobIds[before];
        const blake3 = state.pageBlake3s?.[before] || undefined;
        if (blobId) pageCache.loadPageTexture(before, blobId, blake3).catch(() => {});
      }
      if (after < total) {
        const blobId = state.pageBlobIds[after];
        const blake3 = state.pageBlake3s?.[after] || undefined;
        if (blobId) pageCache.loadPageTexture(after, blobId, blake3).catch(() => {});
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
    // update header actions — page info badge + snatch + save/reveal
    // -----------------------------------------------------------------------

    const updateHeaderActions = () => {
      if (!ctx.setHeaderActions) return;
      const total = totalPages();
      const page = localPage + 1;
      const state = ctx.doc.current;

      const actions: HeaderAction[] = [];

      // page info badge
      const pageLabel = total > 0 ? `${page}/${total}` : "no pages";
      actions.push({
        id: "page-info",
        label: pageLabel,
        isInfo: true,
      });

      // snatch button in header (when remote)
      if (actionState === "remote") {
        actions.push({
          id: "snatch",
          label: "snatch",
          onClick: handleSnatch,
        });
      }

      // snatch progress in header (when snatching)
      if (actionState === "snatching" && snatchProgressText) {
        actions.push({
          id: "snatch-progress",
          label: snatchProgressText,
          isInfo: true,
        });
      }

      // save / reveal button (when blob is local or snatched)
      if (state.blobId && (actionState === "local" || actionState === "snatched")) {
        if (isTauriMode()) {
          actions.push({
            id: "reveal",
            label: "reveal",
            onClick: () => {
              revealPdfInFinder(state.blobId, state.filename);
            },
          });
        }
        actions.push({
          id: "save",
          label: "save",
          onClick: () => {
            savePdfToDisk(state.blobId, state.filename || "document.pdf");
          },
        });
      }

      ctx.setHeaderActions(actions);
    };

    // -----------------------------------------------------------------------
    // nav button positioning and visibility
    // -----------------------------------------------------------------------

    const updateNavButtons = () => {
      const total = totalPages();
      const ppv = effectivePagesPerView();
      const margin = 8;
      const pagesVisible = actionState !== "remote" && actionState !== "checking" && total > 0;

      // position prev button on left edge, vertically centered
      prevBtn.x = margin;
      prevBtn.y = (currentHeight - NAV_BTN_H) / 2;
      prevBtn.visible = navVisible && localPage > 0 && pagesVisible;

      // position next button on right edge, vertically centered
      nextBtn.x = currentWidth - NAV_BTN_W - margin;
      nextBtn.y = (currentHeight - NAV_BTN_H) / 2;
      nextBtn.visible = navVisible && localPage + ppv < total && pagesVisible;

      // go-to-start button near bottom left
      goStartBtn.x = margin;
      goStartBtn.y = currentHeight - GO_START_SIZE - margin - 4;
      goStartBtn.visible = navVisible && localPage > 0 && pagesVisible;
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
    // locality check (delegates to snatch module)
    // -----------------------------------------------------------------------

    const doLocalityCheck = async () => {
      if (destroyed) return;
      const state = ctx.doc.current;

      if (!state.blobId && state.pageBlobIds.length === 0) {
        actionState = "checking";
        syncOverlayVisibility();
        updateHeaderActions();
        return;
      }

      actionState = "checking";
      syncOverlayVisibility();

      const result = await checkPdfLocality(state);
      if (destroyed) return;

      actionState = result;
      syncOverlayVisibility();
      updateHeaderActions();
      drawBg(currentWidth, currentHeight);
      renderPages();
    };

    // -----------------------------------------------------------------------
    // snatch handlers
    // -----------------------------------------------------------------------

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
      syncOverlayVisibility();
      updateHeaderActions();
      console.log("[peedeeeff] snatch cancelled by user");
    }

    async function handleSnatch() {
      if (actionState !== "remote") return;

      const state = ctx.doc.current;
      const allPeers = ctx.canvasStore?.peers();
      if (!allPeers || Object.keys(allPeers).length === 0) {
        console.warn("[peedeeeff] no peers available for snatch");
        return;
      }

      const peers = allPeers as PeersMap;

      snatchCancelled = false;
      snatchAbort = new AbortController();
      actionState = "snatching";
      snatchProgressText = "probing...";
      snatchBtn.setLabel("probing...");
      snatchBtn.setColor(0x555555);
      statusText.text = "probing peers...";
      statusText.visible = true;
      syncOverlayVisibility();
      updateHeaderActions();

      try {
        const result = await snatchPdfContent(
          state,
          peers,
          snatchAbort.signal,
          {
            onStatusText: (text) => {
              if (snatchCancelled || destroyed) return;
              statusText.text = text;
              statusText.visible = true;
            },
            onProgressText: (text) => {
              if (snatchCancelled || destroyed) return;
              snatchProgressText = text;
              if (!snatchHovered) {
                snatchBtn.setLabel(text);
              }
              updateHeaderActions();
            },
            onPageComplete: (pageIndex, pageResult) => {
              if (snatchCancelled || destroyed) return;

              // only update blake3 if missing — blake3 is the cross-peer content identifier.
              // do NOT update pageBlobIds — those are the creator's local storage keys
              // and must stay as-is for the creator peer to resolve.
              const currentBlake3s = ctx.doc.current.pageBlake3s || [];
              if (pageResult.blake3 && !currentBlake3s[pageIndex]) {
                ctx.doc.change((draft) => {
                  if (!draft.pageBlake3s) draft.pageBlake3s = [];
                  draft.pageBlake3s[pageIndex] = pageResult.blake3!;
                });
              }

              // progressive rendering — show this page immediately if visible
              showSinglePage(pageIndex);
            },
          },
          ctx.canvasStore ? (nodeId: string) => ctx.canvasStore!.isPeerOnline(nodeId) : undefined
        );

        if (snatchCancelled || destroyed) return;

        // only update blake3 if it was missing — blake3 is the shared content identifier.
        // do NOT update blobId/mime/size — those are the creator's local values.
        if (result.pdfResult?.blake3 && !ctx.doc.current.blake3) {
          ctx.doc.change((draft) => {
            draft.blake3 = result.pdfResult!.blake3 ?? "";
          });
        }

        // record this node as having the blobs
        const localNodeId = await getLocalNodeId();
        if (localNodeId) {
          console.log("[peedeeeff] snatch complete, local node:", localNodeId.slice(0, 16));
        }

        actionState = "snatched";
        snatchProgressText = "";
        statusText.visible = false;
        snatchBtn.setVisible(false);

        syncOverlayVisibility();
        updateHeaderActions();
        drawBg(currentWidth, currentHeight);

        // full re-render (pages should all be local now)
        pageCache.clear();
        renderPages();
      } catch (err) {
        if (snatchCancelled || destroyed) {
          console.log("[peedeeeff] snatch aborted (cancelled)");
          return;
        }
        console.error("[peedeeeff] snatch failed:", err);
        actionState = "remote";
        snatchProgressText = "";
        snatchBtn.setLabel("snatch");
        snatchBtn.setColor(0x2d5a27);
        syncOverlayVisibility();
        updateHeaderActions();
      } finally {
        snatchAbort = null;
      }
    }

    // -----------------------------------------------------------------------
    // upload handler (placeholder click)
    // -----------------------------------------------------------------------

    const handleUpload = async () => {
      const state = ctx.doc.current;
      if (state.pageBlobIds.length > 0 || state.blobId) return;

      try {
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
        placeholderText.visible = false;
        statusText.text = "processing pages...";
        statusText.visible = true;

        const maxAttempts = 60;
        const pollIntervalMs = 1000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));

          const pages = await getDocumentPages(result.blobId);
          if (pages.length > 0) {
            // pages are ready — populate the widget doc (including blake3)
            const blobIds = pages.map((p) => p.page_blob_id);
            const blake3s = pages.map((p) => p.blake3 || "");
            const totalPagesCount = pages[0]?.total_pages ?? pages.length;

            ctx.doc.change((draft) => {
              draft.pageBlobIds = blobIds;
              draft.pageBlake3s = blake3s;
              draft.pageCount = totalPagesCount;
              draft.currentPage = 0;
            });

            // set widget title from filename (strip .pdf extension)
            const title = picked.filename.replace(/\.pdf$/i, "");
            ctx.canvasStore?.setWidgetTitle(ctx.widgetId, title);

            // mark as local since we just uploaded
            actionState = "local";
            updateHeaderActions();
            return;
          }

          statusText.text = `processing pages... (${attempt + 1}s)`;
        }

        // timed out
        statusText.text = "page rendering in progress...";
        placeholderBorder.eventMode = "static";
        placeholderText.eventMode = "static";
      } catch (err) {
        console.error("[peedeeeff] upload failed:", err);
        placeholderText.text = "upload failed — click to retry";
        placeholderText.visible = true;
        placeholderBorder.visible = true;
        placeholderBorder.eventMode = "static";
        placeholderText.eventMode = "static";
      }
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

    // placeholder click — upload
    placeholderText.on("pointertap", handleUpload);
    placeholderBorder.on("pointertap", handleUpload);

    // show nav on pointer move
    container.eventMode = "static";
    container.on("pointermove", () => {
      showNav();
    });

    // hover tracking for keyboard navigation
    container.on("pointerenter", () => {
      isHovering = true;
    });

    container.on("pointerleave", () => {
      isHovering = false;
    });

    // keyboard navigation — only when hovering
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isHovering || destroyed) return;
      if (totalPages() <= 0) return;

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        navigatePrev();
        showNav();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        navigateNext();
        showNav();
      } else if (e.key === "Home") {
        e.preventDefault();
        navigateToStart();
        showNav();
      } else if (e.key === "End") {
        e.preventDefault();
        navigateTo(totalPages() - 1);
        showNav();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // -----------------------------------------------------------------------
    // subscribe to doc changes
    // -----------------------------------------------------------------------

    let prevBlobIds = ctx.doc.current.pageBlobIds;
    let prevPpv = ctx.doc.current.pagesPerView;
    let prevBlobId = ctx.doc.current.blobId;

    const unsub = ctx.doc.on("change", (state) => {
      drawBg(currentWidth, currentHeight);

      // check if main blobId changed
      if (state.blobId !== prevBlobId) {
        prevBlobId = state.blobId;
        // don't re-check locality during snatching — the snatch flow manages state
        if (actionState !== "snatching") {
          doLocalityCheck();
        }
        return;
      }

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
        pageCache.clear();
        localPage = clampPage(localPage);
        updateHeaderActions();

        // during snatching, don't re-check locality or re-render —
        // the snatch flow handles progressive rendering via onPageComplete
        if (actionState !== "snatching") {
          doLocalityCheck();
        }
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
      statusText.x = w / 2;
      statusText.y = h / 2 - 16;
      positionSnatchBtn();
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
    // initial render + locality check
    // -----------------------------------------------------------------------

    updateHeaderActions();

    // determine initial visibility state
    const initState = ctx.doc.current;
    if (!initState.blobId && initState.pageBlobIds.length === 0) {
      // no blob at all — show upload prompt
      placeholderBorder.visible = true;
      placeholderText.visible = true;
    } else {
      // have a blob or pages — check locality
      doLocalityCheck();
    }

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
        destroyed = true;

        if (navHideTimer !== null) {
          clearTimeout(navHideTimer);
          navHideTimer = null;
        }

        if (snatchAbort) {
          snatchAbort.abort();
          snatchAbort = null;
        }

        window.removeEventListener("keydown", handleKeyDown);

        unsub();

        // destroy page cache
        pageCache.destroy();

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
