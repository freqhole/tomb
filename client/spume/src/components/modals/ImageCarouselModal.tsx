// image carousel modal - display a slideshow of images
import { createEffect, createMemo, createSignal, Show, For, onCleanup, onMount } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import { pushModal, popModal } from "../../music/hooks/modals";

export interface ImageCarouselModalProps {
  images: string[]; // array of image URLs
  initialIndex?: number;
  title?: string;
  onClose: () => void;
}

export function ImageCarouselModal(props: ImageCarouselModalProps) {
  // defensively dedupe input urls. callers usually do this themselves
  // (handlePlayerImageClick / popovers), but a second pass here means
  // any future caller that forgets won't end up with duplicate slides.
  // also filter out any url that we've previously seen fail to load
  // (tracked in `failedUrls`) so flaky/404 thumbnails don't take up
  // a slide once they've errored out at least once.
  const [failedUrls, setFailedUrls] = createSignal<Set<string>>(new Set<string>());
  const images = createMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const failed = failedUrls();
    for (const u of props.images) {
      if (!u || seen.has(u) || failed.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  });
  const markFailed = (url: string) => {
    if (!url) return;
    setFailedUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };
  const [currentIndex, setCurrentIndex] = createSignal(
    Math.min(Math.max(props.initialIndex ?? 0, 0), Math.max(0, images().length - 1))
  );

  // when an image is filtered out (failed to load), clamp the
  // current index back into the visible range so we don't end up
  // pointing past the end of the list. close the modal if every
  // image has failed.
  createEffect(() => {
    const total = images().length;
    if (total === 0) {
      props.onClose();
      return;
    }
    if (currentIndex() >= total) {
      setCurrentIndex(total - 1);
    }
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
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
        title="close (esc)"
      >
        <Icon name={IconNames.close} size={24} />
      </button>

      {/* title */}
      <Show when={props.title}>
        <div
          class="absolute left-4 text-white text-lg font-medium z-10"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
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
            thread; matters most when the carousel holds 20+ images. */}
        <div class="relative w-full h-full flex items-center justify-center">
          <img
            src={images()[currentIndex()]}
            alt={`image ${currentIndex() + 1}`}
            class="max-w-full max-h-full object-contain"
            loading="lazy"
            decoding="async"
            onError={() => markFailed(images()[currentIndex()])}
            style={{
              "max-height":
                "calc(100dvh - 8rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
            }}
          />
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
        class="absolute left-1/2 transform -translate-x-1/2 flex gap-2 max-w-screen-lg overflow-x-auto overflow-y-hidden px-4 z-10"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <For each={images()}>
          {(img, idx) => {
            let btnRef: HTMLButtonElement | undefined;
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
            return (
              <button
                ref={btnRef}
                onClick={() => setCurrentIndex(idx())}
                class={`flex-shrink-0 w-16 h-16 overflow-hidden transition-all ${
                  idx() === currentIndex() ? "scale-110" : "opacity-60 hover:opacity-100"
                }`}
              >
                <img
                  src={img}
                  alt={`thumbnail ${idx() + 1}`}
                  class="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                  onError={() => markFailed(img)}
                />
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
