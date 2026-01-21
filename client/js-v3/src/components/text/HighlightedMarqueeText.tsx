// highlighted marquee text component - supports HTML highlights with marquee on hover
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

interface HighlightedMarqueeTextProps {
  /** text content to display */
  text: string;
  /** optional highlighted version with <mark> tags */
  highlight?: string;
  /** additional css classes */
  class?: string;
  /** whether currently hovering (controlled by parent) */
  isHovering?: boolean;
}

// parse html string to extract text and mark segments
function parseHighlight(
  html: string,
): Array<{ text: string; marked: boolean }> {
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

export function HighlightedMarqueeText(
  props: HighlightedMarqueeTextProps,
): JSX.Element {
  const [shouldMarquee, setShouldMarquee] = createSignal(false);
  const [animationDuration, setAnimationDuration] = createSignal(4);
  let containerRef: HTMLDivElement | undefined;
  let fullTextRef: HTMLSpanElement | undefined;

  const textToDisplay = () => props.highlight || props.text;
  const hasHighlight = () =>
    props.highlight && props.highlight.includes("<mark>");
  const parts = () => (hasHighlight() ? parseHighlight(textToDisplay()) : []);

  // use createMemo to ensure reactivity
  const isAnimating = createMemo(() => {
    return shouldMarquee() && props.isHovering;
  });

  onMount(() => {
    // add css keyframes for marquee animation if not exists
    if (!document.querySelector("#marquee-styles")) {
      const style = document.createElement("style");
      style.id = "marquee-styles";
      style.textContent = `
        @keyframes marquee-scroll {
          0%, 15% {
            transform: translateX(0%);
          }
          50% {
            transform: translateX(calc(-100% + var(--container-width)));
          }
          85%, 100% {
            transform: translateX(0%);
          }
        }
      `;
      document.head.appendChild(style);
    }

    // check if text overflows
    const checkOverflow = () => {
      if (containerRef && fullTextRef) {
        const containerWidth = containerRef.offsetWidth;
        const textWidth = fullTextRef.offsetWidth;
        const shouldScroll = textWidth > containerWidth;

        setShouldMarquee(shouldScroll);

        if (shouldScroll) {
          const containerWidthPx = `${containerWidth}px`;
          containerRef.style.setProperty("--container-width", containerWidthPx);

          // calculate duration based on text length for consistent speed
          const baseDuration = 3;
          const extraTimePerChar = 0.02;
          const calculatedDuration =
            baseDuration + props.text.length * extraTimePerChar;
          setAnimationDuration(Math.min(calculatedDuration, 12));
        }
      }
    };

    // check on mount and when text changes
    setTimeout(checkOverflow, 50); // delay to ensure DOM is rendered
    createEffect(() => {
      props.text;
      props.highlight;
      setTimeout(checkOverflow, 50);
    });

    // re-check on window resize
    const handleResize = () => checkOverflow();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

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

  return (
    <div
      ref={containerRef}
      class={`relative overflow-hidden ${props.class || ""}`}
      title={props.text}
    >
      {/* visible text - shows ellipsis when not hovering */}
      <span
        class="block truncate"
        style={{
          visibility: isAnimating() ? "hidden" : "visible",
        }}
      >
        {renderText()}
      </span>

      {/* full text for marquee - always rendered for measurement */}
      <span
        ref={fullTextRef}
        class="absolute top-0 left-0 whitespace-nowrap"
        style={{
          visibility: isAnimating() ? "visible" : "hidden",
          animation: isAnimating()
            ? `marquee-scroll ${animationDuration()}s ease-in-out infinite`
            : "none",
        }}
      >
        {renderText()}
      </span>
    </div>
  );
}
