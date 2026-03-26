import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

export interface MessageReactionOverlayProps {
  messageId: string;
  /** anchor element to position the overlay relative to */
  anchorRef: HTMLElement;
  onReact: (messageId: string, emoji: string) => void;
  onClose: () => void;
}

// quick-react emojis — most commonly used reactions
const QUICK_EMOJIS = [
  "\u{1F525}",
  "\u{2764}\u{FE0F}",
  "\u{1F44D}",
  "\u{1F602}",
  "\u{1F62D}",
  "\u{2728}",
];

export function MessageReactionOverlay(props: MessageReactionOverlayProps) {
  const [showFullPicker, setShowFullPicker] = createSignal(false);
  let overlayRef: HTMLDivElement | undefined;
  let pickerContainerRef: HTMLDivElement | undefined;

  // position the overlay below the message, centered
  const [pos, setPos] = createSignal({ top: 0, left: 0 });
  // animate in from bottom
  const [visible, setVisible] = createSignal(false);

  const updatePosition = () => {
    if (!props.anchorRef) return;
    const rect = props.anchorRef.getBoundingClientRect();
    // place below the message, horizontally centered
    const overlayWidth = showFullPicker() ? 340 : 260;
    let left = rect.left + rect.width / 2 - overlayWidth / 2;
    // clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - overlayWidth - 8));
    // align bottom edge of overlay with bottom edge of message
    const overlayHeight = showFullPicker() ? 380 : 50;
    let top = rect.bottom - overlayHeight;
    // if too close to top of viewport, place below instead
    if (top < 8) {
      top = rect.bottom + 4;
    }
    setPos({ top, left });
  };

  onMount(() => {
    updatePosition();
    // trigger enter animation on next frame
    requestAnimationFrame(() => setVisible(true));
    // close on scroll (important for virtualizer — user scrolling = cancel)
    // but ignore scrolls inside the overlay (e.g. emoji picker internal scrolling)
    const handleScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (overlayRef?.contains(target)) return;
      // shadow DOM: check composedPath for events originating inside the picker
      const path = e.composedPath?.() ?? [];
      if (overlayRef && path.includes(overlayRef)) return;
      animateClose();
    };
    // capture phase so we catch scrolls on any ancestor
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    // close on escape
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") animateClose();
    };
    window.addEventListener("keydown", handleKey);

    onCleanup(() => {
      window.removeEventListener("scroll", handleScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("keydown", handleKey);
    });
  });

  // animate out then close
  const animateClose = () => {
    setVisible(false);
    setTimeout(() => props.onClose(), 100);
  };

  const handleQuickReact = (emoji: string) => {
    navigator.vibrate?.(10);
    props.onReact(props.messageId, emoji);
    props.onClose();
  };

  const openFullPicker = () => {
    // animate out the quick bar, then swap to full picker and animate in
    setVisible(false);
    setTimeout(() => {
      setShowFullPicker(true);
      // re-measure position for the larger picker
      requestAnimationFrame(() => {
        updatePosition();
        requestAnimationFrame(() => setVisible(true));
      });
      // lazy-load and mount emoji-picker-element
      requestAnimationFrame(() => {
        if (!pickerContainerRef) return;
        import("emoji-picker-element/picker").then(({ default: Picker }) => {
          if (!pickerContainerRef) return;
          const picker = new Picker();
          // style the picker to match our dark theme
          picker.classList.add("dark");
          picker.style.setProperty("--background", "var(--color-bg-elevated)");
          picker.style.setProperty("--border-color", "var(--color-border-default)");
          picker.style.setProperty("--text-color", "var(--color-text-primary)");
          picker.style.setProperty("--indicator-color", "var(--color-accent-500)");
          picker.style.setProperty("--input-border-color", "var(--color-border-subtle)");
          picker.style.setProperty("--input-font-color", "var(--color-text-primary)");
          picker.style.setProperty("--category-font-color", "var(--color-text-secondary)");
          picker.style.setProperty("--num-columns", "8");
          picker.style.setProperty("--emoji-size", "1.4rem");
          picker.style.setProperty("--border-size", "0");
          picker.style.width = "100%";
          picker.style.height = "100%";
          // fix: make the category nav horizontally scrollable inside shadow DOM
          requestAnimationFrame(() => {
            const sr = picker.shadowRoot;
            if (sr) {
              // inject style to enable horizontal scrolling on the category nav
              const style = document.createElement("style");
              style.textContent = `
              .nav, nav, [role="tablist"] {
                overflow-x: auto !important;
                -webkit-overflow-scrolling: touch;
                scrollbar-width: none;
              }
              .nav::-webkit-scrollbar, nav::-webkit-scrollbar, [role="tablist"]::-webkit-scrollbar {
                display: none;
              }
            `;
              sr.appendChild(style);
            }
          });
          picker.addEventListener("emoji-click", (e: any) => {
            const unicode = e.detail?.unicode;
            if (unicode) {
              navigator.vibrate?.(10);
              props.onReact(props.messageId, unicode);
              props.onClose();
            }
          });
          pickerContainerRef.appendChild(picker);
        });
      });
    }, 100); // matches exit animation duration
  };

  return (
    <>
      {/* click-away backdrop — out of layout flow */}
      <div class="fixed inset-0 z-[100]" onClick={animateClose} />

      {/* overlay — fixed positioned, animates up from bottom */}
      <div
        ref={overlayRef}
        class="fixed z-[101]"
        style={{
          top: `${pos().top}px`,
          left: `${pos().left}px`,
          opacity: visible() ? 1 : 0,
          transform: visible() ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 100ms ease-out, transform 100ms ease-out",
        }}
      >
        <Show when={!showFullPicker()}>
          {/* quick-react bar */}
          <div class="flex items-center gap-1 bg-[var(--color-bg-elevated)] rounded-full shadow-xl border border-[var(--color-border-default)]/30 px-2 py-1.5">
            <For each={QUICK_EMOJIS}>
              {(emoji) => (
                <button
                  class="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-bg-tertiary)] active:scale-110 transition-all text-lg cursor-pointer"
                  onClick={() => handleQuickReact(emoji)}
                >
                  {emoji}
                </button>
              )}
            </For>
            {/* "more" button to open full picker */}
            <button
              class="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-bg-tertiary)] transition-colors text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer"
              onClick={openFullPicker}
              title="more emojis"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="8" stroke="currentColor" stroke-width="1.5" />
                <circle cx="6" cy="7.5" r="1" fill="currentColor" />
                <circle cx="12" cy="7.5" r="1" fill="currentColor" />
                <path
                  d="M5.5 11.5C6.5 13 11.5 13 12.5 11.5"
                  stroke="currentColor"
                  stroke-width="1.2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
        </Show>

        <Show when={showFullPicker()}>
          {/* full emoji picker */}
          <div
            ref={pickerContainerRef}
            class="bg-[var(--color-bg-elevated)] rounded-xl shadow-xl border border-[var(--color-border-default)]/30"
            style={{ width: "320px", height: "360px" }}
          />
        </Show>
      </div>
    </>
  );
}

// --- long-press / hover detection hook ---

export interface UseMessageReactionOptions {
  /** how long to hold before showing quick-react (ms) */
  longPressMs?: number;
  /** how far finger can move before cancelling long-press (px) */
  moveTolerance?: number;
}

/** returns handlers to attach to a message element + state for overlay */
export function createMessageReaction(opts?: UseMessageReactionOptions) {
  const longPressMs = opts?.longPressMs ?? 400;
  const moveTolerance = opts?.moveTolerance ?? 10;

  const [activeMessageId, setActiveMessageId] = createSignal<string | null>(null);
  const [anchorEl, setAnchorEl] = createSignal<HTMLElement | null>(null);

  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;

  const clearPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const activate = (messageId: string, el: HTMLElement) => {
    navigator.vibrate?.(10);
    setActiveMessageId(messageId);
    setAnchorEl(el);
  };

  const close = () => {
    setActiveMessageId(null);
    setAnchorEl(null);
  };

  // touch handlers — long press
  const onTouchStart = (messageId: string, el: HTMLElement, e: TouchEvent) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    clearPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      activate(messageId, el);
    }, longPressMs);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!pressTimer) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) > moveTolerance || Math.abs(dy) > moveTolerance) {
      clearPress(); // cancel — user is scrolling
    }
  };

  const onTouchEnd = () => {
    clearPress();
  };

  return {
    activeMessageId,
    anchorEl,
    close,
    /** call from the message wrapper's touch/mouse events */
    handlers: (messageId: string, el: HTMLElement) => ({
      onTouchStart: (e: TouchEvent) => onTouchStart(messageId, el, e),
      onTouchMove,
      onTouchEnd,
      onContextMenu: (e: Event) => {
        // prevent native context menu on long-press
        if (activeMessageId()) e.preventDefault();
      },
    }),
    /** programmatic open (e.g. from "+" button click) */
    open: activate,
  };
}
