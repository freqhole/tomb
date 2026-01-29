// optimized marquee text for virtualized lists with hover-only mode
// key difference: caller controls hover state, avoiding per-component mouse listeners

import { createEffect, createSignal, JSX, onMount } from "solid-js";

interface MarqueeText2Props {
  /** text content to display */
  text: string;
  /** additional css classes for the container */
  class?: string;
  /** padding class applied inside the overflow container (e.g. 'px-2') */
  padClass?: string;
  /** externally controlled hover state - when true and text overflows, animates */
  isHovering?: boolean;
  /** title tooltip (defaults to text) */
  title?: string;
}

// inject styles once
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "marquee2-styles";
  style.textContent = `
    @keyframes marquee2-scroll {
      0%, 5% { transform: translateX(0); }
      45%, 55% { transform: translateX(var(--marquee-offset)); }
      95%, 100% { transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
}

export function MarqueeText2(props: MarqueeText2Props): JSX.Element {
  const [overflows, setOverflows] = createSignal(false);
  const [offset, setOffset] = createSignal(0);
  let containerRef: HTMLDivElement | undefined;
  let textRef: HTMLSpanElement | undefined;

  // check overflow on mount and when text changes
  const checkOverflow = () => {
    if (!containerRef || !textRef) return;
    const containerWidth = containerRef.offsetWidth;
    const textWidth = textRef.scrollWidth;
    const doesOverflow = textWidth > containerWidth;
    setOverflows(doesOverflow);
    if (doesOverflow) {
      setOffset(containerWidth - textWidth - 8); // 8px padding
    }
  };

  onMount(() => {
    injectStyles();
    // defer to ensure layout is complete
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

  const shouldAnimate = () => overflows() && props.isHovering;

  return (
    <div
      ref={containerRef!}
      class={`overflow-hidden ${props.class || ""}`}
      title={props.title || props.text}
    >
      <span
        ref={textRef!}
        class={`block whitespace-nowrap ${props.padClass || ""}`}
        style={{
          "--marquee-offset": `${offset()}px`,
          animation: shouldAnimate()
            ? `marquee2-scroll ${duration()}s ease-in-out infinite`
            : "none",
        }}
      >
        {props.text}
      </span>
    </div>
  );
}

export default MarqueeText2;
