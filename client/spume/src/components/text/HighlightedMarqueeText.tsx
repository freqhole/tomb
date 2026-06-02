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
          opacity: shouldAnimate() ? 0 : 1,
        }}
      >
        {renderText()}
      </div>

      {/* animated text - overlays truncated text when hovering */}
      <div
        class="absolute top-0 left-0 whitespace-nowrap"
        style={{
          opacity: shouldAnimate() ? 1 : 0,
          animation: shouldAnimate()
            ? `text-marquee var(--marquee-duration, 4s) ease-in-out infinite`
            : "none",
          "pointer-events": "none",
        }}
        aria-hidden="true"
      >
        {renderText()}
      </div>
    </div>
  );
}
