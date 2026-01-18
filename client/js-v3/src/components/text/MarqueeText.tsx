import { createSignal, JSX, onCleanup, onMount } from "solid-js";

interface MarqueeTextProps {
  /** text content to display */
  text: string;
  /** additional css classes */
  class?: string;
  /** tooltip text (defaults to the text content) */
  title?: string;
  /** only marquee on hover (default: false = always marquee when overflow) */
  hoverOnly?: boolean;
}

export function MarqueeText(props: MarqueeTextProps): JSX.Element {
  const [shouldMarquee, setShouldMarquee] = createSignal(false);
  const [animationDuration, setAnimationDuration] = createSignal(4);
  const [isHovering, setIsHovering] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  let textRef: HTMLSpanElement | undefined;

  const shouldAnimate = () => {
    if (!shouldMarquee()) return false;
    if (props.hoverOnly) return isHovering();
    return true;
  };

  onMount(() => {
    // add css keyframes for marquee animation if not exists
    if (!document.querySelector("#marquee-styles")) {
      const style = document.createElement("style");
      style.id = "marquee-styles";
      style.textContent = `
        @keyframes marquee-bounce {
          0%, 25% { transform: translateX(0%); }
          50%, 75% { transform: translateX(calc(-100% + var(--container-width))); }
          100% { transform: translateX(0%); }
        }
      `;
      document.head.appendChild(style);
    }

    if (!props.enableMarquee) {
      setShouldMarquee(false);
      return;
    }

    // check if text overflows and calculate timing
    const checkOverflow = () => {
      if (containerRef && textRef) {
        const containerWidth = containerRef.offsetWidth;
        const textWidth = textRef.scrollWidth;
        const shouldScroll = textWidth > containerWidth;
        setShouldMarquee(shouldScroll);

        if (shouldScroll) {
          containerRef.style.setProperty(
            "--container-width",
            `${containerWidth}px`,
          );

          // calculate duration based on text length for consistent speed
          const baseDuration = 2; // seconds for short text
          const extraTimePerChar = 0.03; // additional seconds per character
          const calculatedDuration =
            baseDuration + props.text.length * extraTimePerChar;
          setAnimationDuration(Math.max(calculatedDuration, 2)); // minimum 2 seconds
        }
      }
    };

    setTimeout(checkOverflow, 10);
    window.addEventListener("resize", checkOverflow);
    onCleanup(() => window.removeEventListener("resize", checkOverflow));
  });

  return (
    <div
      ref={containerRef!}
      class={`relative overflow-hidden ${props.class || ""}`}
      title={props.title || props.text}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <span
        ref={textRef!}
        class={
          shouldMarquee()
            ? "inline-block whitespace-nowrap pr-4"
            : "truncate block"
        }
        style={
          shouldAnimate()
            ? {
                animation: `marquee-bounce ${animationDuration()}s ease-in-out infinite`,
              }
            : {}
        }
      >
        {props.text}
      </span>
    </div>
  );
}

export default MarqueeText;
