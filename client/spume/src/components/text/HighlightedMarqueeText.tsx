// highlighted marquee text component - supports HTML highlights with marquee on hover
import { createEffect, createSignal, For, JSX, onCleanup, onMount, Show } from "solid-js";

interface HighlightedMarqueeTextProps {
  /** text content to display */
  text: string;
  /** optional highlighted version with <mark> tags */
  highlight?: string;
  /** additional css classes */
  class?: string;
  /** whether currently hovering (controlled by parent) */
  isHovering?: boolean;
  /** optional title attribute override (defaults to text) */
  title?: string;
}

// parse html string to extract text and mark segments
function parseHighlight(html: string): Array<{ text: string; marked: boolean }> {
  const parts: Array<{ text: string; marked: boolean }> = [];
  const markRegex = /<mark>(.*?)<\/mark>/g;
  let lastIndex = 0;
  let match;

  while ((match = markRegex.exec(html)) !== null) {
    // add text before mark
    if (match.index > lastIndex) {
      parts.push({ text: html.slice(lastIndex, match.index), marked: false });
    }
    // add marked text
    parts.push({ text: match[1], marked: true });
    lastIndex = markRegex.lastIndex;
  }

  // add remaining text
  if (lastIndex < html.length) {
    parts.push({ text: html.slice(lastIndex), marked: false });
  }

  return parts;
}

export function HighlightedMarqueeText(props: HighlightedMarqueeTextProps): JSX.Element {
  const [needsMarquee, setNeedsMarquee] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  let measureRef: HTMLDivElement | undefined;
  let animatedRef: HTMLDivElement | undefined;

  const textToDisplay = () => props.highlight || props.text;
  const hasHighlight = () => props.highlight && props.highlight.includes("<mark>");
  const parts = () => (hasHighlight() ? parseHighlight(textToDisplay()) : []);

  // render text content with highlights
  const renderText = () => (
    <Show when={hasHighlight()} fallback={props.text}>
      <For each={parts()}>
        {(part) => (
          <Show when={part.marked} fallback={<span>{part.text}</span>}>
            <mark class="text-[var(--color-accent-500)] font-medium bg-transparent">
              {part.text}
            </mark>
          </Show>
        )}
      </For>
    </Show>
  );

  onMount(() => {
    // measure if text overflows
    const checkOverflow = () => {
      if (!containerRef || !measureRef) return;

      const containerWidth = containerRef.clientWidth;
      const textWidth = measureRef.scrollWidth;
      const overflows = textWidth > containerWidth;

      setNeedsMarquee(overflows);

      if (overflows) {
        // calculate how far to scroll (negative to move left)
        const distance = containerWidth - textWidth;
        containerRef.style.setProperty("--marquee-distance", `${distance}px`);

        // duration based on text length for consistent speed
        const duration = Math.min(3 + textWidth / 100, 10);
        containerRef.style.setProperty("--marquee-duration", `${duration}s`);
      }
    };

    // initial check after render
    setTimeout(checkOverflow, 0);

    // recheck when text changes
    createEffect(() => {
      props.text;
      props.highlight;
      setTimeout(checkOverflow, 0);
    });

    // recheck on resize
    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
    });

    if (containerRef) {
      resizeObserver.observe(containerRef);
    }

    onCleanup(() => {
      resizeObserver.disconnect();
    });
  });

  const shouldAnimate = () => needsMarquee() && props.isHovering;
  // true while the return-to-start transition (below) is in flight, so
  // the overlay stays visible (opacity 1) long enough to actually show
  // it - otherwise it'd fade out the instant hover ends, before anyone
  // could see it animate back.
  const [isReturning, setIsReturning] = createSignal(false);
  const overlayVisible = () => shouldAnimate() || isReturning();

  // same imperative freeze-then-transition-back technique as
  // MarqueeText.tsx (see its comment for why this must be imperative,
  // not a declarative style={{}} reacting to the same signal) - stopping
  // the keyframe animation outright snapped straight back with no
  // transition at all.
  const RETURN_DURATION_MS = 300;
  let returnRaf: number | undefined;
  let returnTimer: ReturnType<typeof setTimeout> | undefined;
  function clearReturnTimers() {
    if (returnRaf !== undefined) {
      cancelAnimationFrame(returnRaf);
      returnRaf = undefined;
    }
    if (returnTimer !== undefined) {
      clearTimeout(returnTimer);
      returnTimer = undefined;
    }
  }

  createEffect(() => {
    const animate = shouldAnimate();
    if (!animatedRef) return;
    clearReturnTimers();

    if (animate) {
      setIsReturning(false);
      animatedRef.style.transition = "";
      animatedRef.style.transform = "";
      animatedRef.style.animation = "text-marquee var(--marquee-duration, 4s) ease-in-out infinite";
      return;
    }

    const wasPlaying = animatedRef.style.animation !== "" && animatedRef.style.animation !== "none";
    if (!wasPlaying) {
      animatedRef.style.animation = "none";
      animatedRef.style.transform = "";
      animatedRef.style.transition = "";
      return;
    }

    const computed = getComputedStyle(animatedRef).transform;
    animatedRef.style.animation = "none";
    animatedRef.style.transition = "";
    animatedRef.style.transform = computed && computed !== "none" ? computed : "translateX(0)";
    setIsReturning(true);

    returnRaf = requestAnimationFrame(() => {
      returnRaf = requestAnimationFrame(() => {
        returnRaf = undefined;
        if (!animatedRef) return;
        animatedRef.style.transition = `transform ${RETURN_DURATION_MS}ms ease-out`;
        animatedRef.style.transform = "translateX(0)";
        returnTimer = setTimeout(() => {
          returnTimer = undefined;
          setIsReturning(false);
          if (!animatedRef) return;
          animatedRef.style.transition = "";
          animatedRef.style.transform = "";
        }, RETURN_DURATION_MS);
      });
    });
  });
  onCleanup(clearReturnTimers);

  return (
    <div
      ref={containerRef}
      class={`relative overflow-hidden ${props.class || ""}`}
      title={props.title ?? props.text}
    >
      {/* measurement element - invisible but rendered for accurate scrollWidth */}
      <div
        ref={measureRef}
        class="absolute top-0 left-0 whitespace-nowrap pointer-events-none"
        style={{ opacity: 0, visibility: "visible" }}
        aria-hidden="true"
      >
        {renderText()}
      </div>

      {/* visible truncated text */}
      <div
        class="truncate"
        style={{
          opacity: overlayVisible() ? 0 : 1,
        }}
      >
        {renderText()}
      </div>

      {/* animated text - overlays truncated text when hovering (and
          briefly after, while animating back to the start) */}
      <div
        ref={animatedRef}
        class="absolute top-0 left-0 whitespace-nowrap"
        style={{
          opacity: overlayVisible() ? 1 : 0,
          "pointer-events": "none",
        }}
        aria-hidden="true"
      >
        {renderText()}
      </div>
    </div>
  );
}
