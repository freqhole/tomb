// image carousel modal - display a slideshow of images
import { createSignal, Show, For, onCleanup } from "solid-js";
import { Icon, IconNames } from "../icons/registry";

export interface ImageCarouselModalProps {
  images: string[]; // array of image URLs
  initialIndex?: number;
  title?: string;
  onClose: () => void;
}

export function ImageCarouselModal(props: ImageCarouselModalProps) {
  const [currentIndex, setCurrentIndex] = createSignal(
    props.initialIndex ?? 0,
  );

  const canGoPrev = () => currentIndex() > 0;
  const canGoNext = () => currentIndex() < props.images.length - 1;

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

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={props.onClose}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* close button */}
      <button
        onClick={props.onClose}
        class="absolute top-4 right-4 p-2 text-white hover:text-gray-300 transition-colors z-10"
        title="close (esc)"
      >
        <Icon name={IconNames.close} size={24} />
      </button>

      {/* title */}
      <Show when={props.title}>
        <div class="absolute top-4 left-4 text-white text-lg font-medium z-10">
          {props.title}
        </div>
      </Show>

      {/* image counter */}
      <div class="absolute top-4 left-1/2 transform -translate-x-1/2 text-white text-sm z-10">
        {currentIndex() + 1} / {props.images.length}
      </div>

      {/* main content - prevent close when clicking image */}
      <div
        class="relative flex items-center justify-center w-full h-full p-16"
        onClick={(e) => e.stopPropagation()}
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

        {/* current image */}
        <div class="relative w-full h-full flex items-center justify-center">
          <img
            src={props.images[currentIndex()]}
            alt={`image ${currentIndex() + 1}`}
            class="max-w-full max-h-full object-contain"
            style={{ "max-height": "calc(100vh - 8rem)" }}
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

      {/* thumbnail strip at bottom */}
      <div class="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2 max-w-screen-lg overflow-x-auto px-4 z-10">
        <For each={props.images}>
          {(img, idx) => (
            <button
              onClick={() => setCurrentIndex(idx())}
              class={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                idx() === currentIndex()
                  ? "border-white scale-110"
                  : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              <img
                src={img}
                alt={`thumbnail ${idx() + 1}`}
                class="w-full h-full object-cover"
              />
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
