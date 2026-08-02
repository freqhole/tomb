// image carousel modal - display a slideshow of images
import { createEffect, createSignal, Show, For, onCleanup, onMount } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import { pushModal, popModal, type CarouselSlide } from "../../music/hooks/modals";
import { toast } from "../feedback/Toast";

// the thumbnail strip used to point every `<img>` straight at the same
// full-resolution url as the main viewer. that's fine for one image at
// a time (the main viewer), but the strip mounts one `<img>` per slide
// simultaneously — with real-world libraries this can mean dozens of
// ~4500x4500px originals all decoded and held resident at once (tens of
// MB *per image* of raw bitmap data), which is what actually caused the
// "carousel eats RAM and the UI gets sluggish" reports rather than
// anything about how many images are open at once in the main view.
//
// fix: draw each thumbnail into a small `<canvas>` instead of an `<img>`.
// the source image is still decoded once to draw it, but we do that with
// a plain (non-DOM, unreferenced) `Image()` that goes out of scope right
// after drawing — nothing keeps the full-res decode alive afterward, so
// only the small canvas backing-store persists. we deliberately draw
// only (never read pixels back via `getContext("2d").getImageData` /
// `canvas.toBlob`) — cross-origin images (remote/p2p thumbnails without
// CORS headers) taint the canvas for readback but drawing is always
// allowed, matching the same "draw-only, no crossOrigin" approach the
// graph view's canvas image cache already relies on (see
// `components/graph/imageCache.ts`).
//
// generation is also gated behind an `IntersectionObserver` per
// thumbnail button plus a small concurrency cap, so opening a carousel
// with a lot of images doesn't kick off dozens of simultaneous decodes
// — only the ones actually scrolled into view get drawn, a few at a
// time.
const STRIP_THUMB_MAX_CONCURRENT = 3;
let stripThumbInFlight = 0;
const stripThumbQueue: Array<() => void> = [];

function acquireStripThumbSlot(start: () => void): void {
  if (stripThumbInFlight < STRIP_THUMB_MAX_CONCURRENT) {
    stripThumbInFlight++;
    start();
  } else {
    stripThumbQueue.push(start);
  }
}

function releaseStripThumbSlot(): void {
  stripThumbInFlight--;
  const next = stripThumbQueue.shift();
  if (next) {
    stripThumbInFlight++;
    next();
  }
}

/** draw `url` into `canvas`, cover-fit cropped to the canvas's own
 *  (already device-pixel-ratio-scaled) backing-store size. returns
 *  false if the image failed to load/decode. */
async function drawCoverThumbnail(canvas: HTMLCanvasElement, url: string): Promise<boolean> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return false;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const cw = canvas.width;
  const ch = canvas.height;
  const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight) || 1;
  const dw = Math.max(1, img.naturalWidth * scale);
  const dh = Math.max(1, img.naturalHeight * scale);
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  return true;
}

export interface ImageCarouselModalProps {
  images: CarouselSlide[]; // one slot per slide — url is null while still resolving
  initialIndex?: number;
  title?: string;
  onClose: () => void;
}

export function ImageCarouselModal(props: ImageCarouselModalProps) {
  const images = () => props.images;

  // slides that resolved to a url just fine but then failed to actually
  // load/decode in the browser (404, corrupt file, network drop) — kept
  // separate from `CarouselSlide.failed` (a resolver-level failure, set
  // by the caller before the slide ever had a url) so a broken thumbnail
  // fetch can't be confused with a broken full-resolution fetch.
  const [browserFailed, setBrowserFailed] = createSignal<Set<number>>(new Set());
  const markBrowserFailed = (index: number) => {
    setBrowserFailed((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };
  const isFailed = (index: number) => !!images()[index]?.failed || browserFailed().has(index);
  const isPending = (index: number) => images()[index]?.url == null && !isFailed(index);

  const [currentIndex, setCurrentIndex] = createSignal(
    Math.min(Math.max(props.initialIndex ?? 0, 0), Math.max(0, images().length - 1))
  );

  // close (with a toast) only once every slide has settled — no longer
  // pending — and none of them ended up usable. while any slide is still
  // resolving, some may yet succeed, so we never judge early; and total
  // resolver failure is already handled (closed + toasted) by
  // `openImageCarouselFromResolvers` before the modal ever shows anything
  // usable, so in practice this effect mainly catches "resolved fine but
  // every image then failed to load/decode in-browser".
  let toastedAllFailed = false;
  createEffect(() => {
    const total = images().length;
    if (total === 0) return;
    const anyPending = images().some((_, i) => isPending(i));
    if (anyPending) return;
    const anyUsable = images().some((_, i) => !isFailed(i));
    if (anyUsable) {
      if (currentIndex() >= total) setCurrentIndex(total - 1);
      return;
    }
    if (!toastedAllFailed) {
      toastedAllFailed = true;
      toast.error(
        props.title ? `images for ${props.title} failed to load` : "images failed to load",
        { title: "image carousel" }
      );
    }
    props.onClose();
  });

  const canGoPrev = () => currentIndex() > 0;
  const canGoNext = () => currentIndex() < images().length - 1;

  const handlePrev = () => {
    if (canGoPrev()) {
      setCurrentIndex((i) => i - 1);
    }
  };

  const handleNext = () => {
    if (canGoNext()) {
      setCurrentIndex((i) => i + 1);
    }
  };

  // advance to next image, looping back to start
  const handleAdvance = () => {
    setCurrentIndex((i) => (i + 1) % images().length);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      handlePrev();
    } else if (e.key === "ArrowRight") {
      handleNext();
    } else if (e.key === "Escape") {
      props.onClose();
    }
  };

  // prevent body scroll when modal open
  document.body.style.overflow = "hidden";
  onCleanup(() => {
    document.body.style.overflow = "";
  });

  // register with the global modal stack so view-level esc handlers
  // (e.g. the graph subview's "clear selection on esc") know to stand
  // down while this carousel is open. otherwise pressing esc to close
  // the carousel ALSO clears the graph selection underneath it.
  const modalId = `image-carousel-${Math.random().toString(36).slice(2)}`;
  onMount(() => pushModal(modalId, props.onClose));
  onCleanup(() => popModal(modalId));

  let containerRef!: HTMLDivElement;
  onMount(() => containerRef?.focus());
  let stripContainerRef: HTMLDivElement | undefined;

  return (
    <div
      ref={containerRef}
      class="flex items-center justify-center bg-black/90 outline-none"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 1100 }}
      onClick={props.onClose}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* close button — offset below android/ios status bar via safe-area inset */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onClose();
        }}
        class="absolute right-4 p-2 text-white hover:text-gray-300 transition-colors z-10 bg-black/50 rounded-full"
        style={{ top: "calc(var(--safe-area-top, 0px) + 1rem)" }}
        title="close (esc)"
      >
        <Icon name={IconNames.close} size={24} />
      </button>

      {/* title */}
      <Show when={props.title}>
        <div
          class="absolute left-4 text-white text-lg font-medium z-10"
          style={{ top: "calc(var(--safe-area-top, 0px) + 1rem)" }}
        >
          {props.title}
        </div>
      </Show>

      {/* image counter — hidden when there's only one (or zero)
          images, since "1 / 1" is just noise. */}
      <Show when={images().length > 1}>
        <div
          class="absolute left-1/2 transform -translate-x-1/2 text-white text-sm z-10"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
        >
          {currentIndex() + 1} / {images().length}
        </div>
      </Show>

      {/* main content - click image to advance */}
      <div
        class="relative flex items-center justify-center w-full h-full p-16 mb-10 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          handleAdvance();
        }}
      >
        {/* prev button */}
        <Show when={canGoPrev()}>
          <button
            onClick={handlePrev}
            class="absolute left-4 p-4 text-white hover:text-gray-300 transition-colors z-10 bg-black/50 rounded-full"
            title="previous (←)"
          >
            <Icon name={IconNames.chevronLeft} size={32} />
          </button>
        </Show>

        {/* current image — `loading="lazy"` + `decoding="async"` so the
            browser can stagger fetching and decode work off the main
            thread; matters most when the carousel holds 20+ images. a
            slide that hasn't resolved (or failed to resolve/load) yet
            shows a spinner/error placeholder instead of a broken `<img>`. */}
        <div class="relative w-full h-full flex items-center justify-center">
          <Show
            when={!isPending(currentIndex()) && !isFailed(currentIndex())}
            fallback={
              <div class="flex flex-col items-center gap-2 text-white/70">
                <Show
                  when={isFailed(currentIndex())}
                  fallback={<Icon name={IconNames.loader} size={40} className="animate-spin" />}
                >
                  <Icon name={IconNames.alertTriangle} size={40} />
                  <span class="text-sm">failed to load</span>
                </Show>
              </div>
            }
          >
            <img
              src={images()[currentIndex()]?.url ?? undefined}
              alt={`image ${currentIndex() + 1}`}
              class="max-w-full max-h-full object-contain"
              loading="lazy"
              decoding="async"
              onError={() => markBrowserFailed(currentIndex())}
              style={{
                "max-height":
                  "calc(100dvh - 8rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
              }}
            />
          </Show>
        </div>

        {/* next button */}
        <Show when={canGoNext()}>
          <button
            onClick={handleNext}
            class="absolute right-4 p-4 text-white hover:text-gray-300 transition-colors z-10 bg-black/50 rounded-full"
            title="next (→)"
          >
            <Icon name={IconNames.chevronRight} size={32} />
          </button>
        </Show>
      </div>

      {/* thumbnail strip at bottom — offset above ios home indicator / android nav bar */}
      <div
        ref={stripContainerRef}
        class="absolute left-1/2 transform -translate-x-1/2 flex gap-2 max-w-screen-lg overflow-x-auto overflow-y-hidden px-4 z-10"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <For each={images()}>
          {(slide, idx) => {
            let btnRef: HTMLButtonElement | undefined;
            let canvasRef: HTMLCanvasElement | undefined;
            // when a real small thumbnail url fails to load (e.g. the
            // server hasn't generated it yet), fall back to the
            // client-side canvas downscale of the full-res url instead
            // of just showing a broken-image placeholder.
            const [thumbBroken, setThumbBroken] = createSignal(false);

            // keep the currently-selected thumbnail visible when the
            // user pages through the carousel (arrow keys, prev/next,
            // click-to-advance). without this the strip stays parked
            // at scroll position 0 and the active thumbnail can be
            // fully offscreen once the selection moves past ~screen
            // width worth of thumbs.
            createEffect(() => {
              if (idx() !== currentIndex()) return;
              if (!btnRef) return;
              btnRef.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "nearest",
              });
            });

            // draw the canvas fallback lazily — only once this button
            // actually scrolls into view — and only a few at a time
            // (see `acquireStripThumbSlot`), instead of decoding every
            // full-res image in the carousel up front. only runs when
            // there's no real (small, server-generated) thumbnail url
            // to use directly.
            onMount(() => {
              const usesCanvasFallback = () => {
                const s = images()[idx()];
                return !!s?.url && (!s.thumbnailUrl || thumbBroken());
              };
              if (!canvasRef) return;
              const canvas = canvasRef;
              const dpr = window.devicePixelRatio || 1;
              const cssSize = 64;
              canvas.width = Math.round(cssSize * dpr);
              canvas.height = Math.round(cssSize * dpr);

              let started = false;
              const observer = new IntersectionObserver(
                (entries) => {
                  if (started || !entries.some((e) => e.isIntersecting)) return;
                  if (!usesCanvasFallback()) return;
                  started = true;
                  observer.disconnect();
                  const url = images()[idx()]?.url;
                  if (!url) return;
                  acquireStripThumbSlot(() => {
                    void drawCoverThumbnail(canvas, url)
                      .then((ok) => {
                        if (!ok) markBrowserFailed(idx());
                      })
                      .finally(releaseStripThumbSlot);
                  });
                },
                { root: stripContainerRef ?? null, rootMargin: "200px" }
              );
              observer.observe(canvas);
              onCleanup(() => observer.disconnect());
            });

            return (
              <button
                ref={btnRef}
                onClick={() => setCurrentIndex(idx())}
                class={`flex-shrink-0 w-16 h-16 overflow-hidden transition-all ${
                  idx() === currentIndex() ? "scale-110" : "opacity-60 hover:opacity-100"
                }`}
              >
                <Show
                  when={!isPending(idx()) && !isFailed(idx())}
                  fallback={
                    <div class="w-full h-full flex items-center justify-center bg-white/10 text-white/70">
                      <Show
                        when={isFailed(idx())}
                        fallback={
                          <Icon name={IconNames.loader} size={18} className="animate-spin" />
                        }
                      >
                        <Icon name={IconNames.alertTriangle} size={18} />
                      </Show>
                    </div>
                  }
                >
                  <Show
                    when={slide.thumbnailUrl && !thumbBroken()}
                    fallback={
                      <canvas
                        ref={canvasRef}
                        aria-label={`thumbnail ${idx() + 1}`}
                        class="w-full h-full object-cover"
                      />
                    }
                  >
                    <img
                      src={slide.thumbnailUrl ?? undefined}
                      alt={`thumbnail ${idx() + 1}`}
                      class="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={() => setThumbBroken(true)}
                    />
                  </Show>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
