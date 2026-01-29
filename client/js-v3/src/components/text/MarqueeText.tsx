// marquee text - scrolls long text on hover
// supports both internal hover tracking and external isHovering prop for virtualized lists

import { createEffect, createSignal, JSX, onMount } from "solid-js";

interface MarqueeTextProps {
  /** text content to display */
  text: string;
  /** additional css classes */
  class?: string;
  /** padding class applied inside the overflow container (e.g. 'px-2') for virtualized lists */
  padClass?: string;
  /** hover-specific css classes (applied to inner span on hover) */
  hoverClass?: string;
  /** tooltip text (defaults to the text content) */
  title?: string;
  /** only marquee on hover (default: true) - when false, always animates if overflow */
  hoverOnly?: boolean;
  /** externally controlled hover state - when provided, skips internal mouse listeners */
  isHovering?: boolean;
}

// inject styles once globally
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "marquee-styles";
  style.textContent = `
    @keyframes marquee-scroll {
      0%, 5% { transform: translateX(0); }
      45%, 55% { transform: translateX(var(--marquee-offset)); }
      95%, 100% { transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
}

export function MarqueeText(props: MarqueeTextProps): JSX.Element {
  const [overflows, setOverflows] = createSignal(false);
  const [offset, setOffset] = createSignal(0);
  const [internalHover, setInternalHover] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  let textRef: HTMLSpanElement | undefined;

  // use external isHovering if provided, otherwise internal
  const isHovering = () => props.isHovering ?? internalHover();
  
  // check if we should use internal hover tracking
  const useInternalHover = () => props.isHovering === undefined;

  // check overflow on mount and when text changes
  const checkOverflow = () => {
    if (!containerRef || !textRef) return;
    const containerWidth = containerRef.offsetWidth;
    const textWidth = textRef.scrollWidth;
    const doesOverflow = textWidth > containerWidth;
    setOverflows(doesOverflow);
    if (doesOverflow) {
      setOffset(containerWidth - textWidth - 8); // 8px end padding
    }
  };

  onMount(() => {
    injectStyles();
    requestAnimationFrame(checkOverflow);
  });

  // recheck when text changes
  createEffect(() => {
    props.text;
    requestAnimationFrame(checkOverflow);
  });

  // calculate duration based on scroll distance
  const duration = () => {
    const distance = Math.abs(offset());
    // base 2s + 0.02s per pixel of scroll distance
    return Math.max(2, 2 + distance * 0.02);
  };

  // default hoverOnly to true (most common use case)
  const hoverOnly = () => props.hoverOnly !== false;
  
  const shouldAnimate = () => {
    if (!overflows()) return false;
    if (hoverOnly()) return isHovering();
    return true; // always animate if hoverOnly is false
  };

  return (
    <div
      ref={containerRef!}
      class={`overflow-hidden ${props.class || ""}`}
      title={props.title || props.text}
      onMouseEnter={useInternalHover() ? () => setInternalHover(true) : undefined}
      onMouseLeave={useInternalHover() ? () => setInternalHover(false) : undefined}
    >
      <span
        ref={textRef!}
        class={`block whitespace-nowrap ${props.padClass || ""} ${props.hoverClass && isHovering() ? props.hoverClass : ""}`}
        style={{
          "--marquee-offset": `${offset()}px`,
          animation: shouldAnimate()
            ? `marquee-scroll ${duration()}s ease-in-out infinite`
            : "none",
        }}
      >
        {props.text}
      </span>
    </div>
  );
}

export default MarqueeText;
