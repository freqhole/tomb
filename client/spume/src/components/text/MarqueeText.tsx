// marquee text - scrolls long text on hover
// supports both internal hover tracking and external isHovering prop for virtualized lists

import {
  Accessor,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  onCleanup,
  onMount,
} from "solid-js";

interface MarqueeTextProps {
  /** text content to display. omit when using `children` for non-text
   *  content (e.g. a row of taxon chips) instead. */
  text?: string;
  /** arbitrary content to marquee instead of plain `text` (e.g. a row of
   *  taxon chip badges). when provided, this is rendered instead of
   *  `text`, but `text` (if given) is still used as the default tooltip. */
  children?: JSX.Element;
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
  /** externally controlled hover state - can be boolean or accessor for reactivity */
  isHovering?: boolean | Accessor<boolean>;
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
  // supports both boolean values and accessor functions for reactivity
  const isHovering = () => {
    const external = props.isHovering;
    if (external === undefined) return internalHover();
    const result = typeof external === "function" ? external() : external;
    return result;
  };

  // check if we should use internal hover tracking
  const useInternalHover = () => props.isHovering === undefined;

  // check overflow on mount and when text changes
  const checkOverflow = () => {
    if (!containerRef || !textRef) return;
    const containerWidth = containerRef.offsetWidth;
    const textWidth = textRef.scrollWidth;
    const doesOverflow = textWidth > containerWidth;
    // console.log(`[MarqueeText] "${props.text.slice(0, 30)}..." container=${containerWidth}, text=${textWidth}, overflow=${doesOverflow}`);
    setOverflows(doesOverflow);
    if (doesOverflow) {
      setOffset(containerWidth - textWidth - 8); // 8px end padding
    }
  };

  onMount(() => {
    injectStyles();
    requestAnimationFrame(checkOverflow);
  });

  // recheck when text or children change
  createEffect(() => {
    props.text;
    props.children;
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

  const shouldAnimate = createMemo(() => {
    const hovering = isHovering();
    const overflow = overflows();
    const hoverOnlyVal = hoverOnly();
    if (!overflow) return false;
    if (hoverOnlyVal) {
      // console.log(`[MarqueeText] "${props.text.slice(0, 20)}..." shouldAnimate check: hovering=${hovering}, overflow=${overflow}`);
      return hovering;
    }
    return true; // always animate if hoverOnly is false
  });

  // compute hover class reactively
  const hoverClassName = createMemo(() => {
    return props.hoverClass && isHovering() ? props.hoverClass : "";
  });

  // drives animation/transform/transition imperatively (not via a
  // declarative style={{}} binding) so "freeze the current mid-scroll
  // position, then transition back to start" can't race against some
  // other reactive consumer of the same signals clearing the animation
  // first - solid doesn't guarantee ordering between two independent
  // reactions to the same signal, and that race was exactly why the
  // previous version still snapped: by the time the freeze read
  // `getComputedStyle`, the animation had often already been removed by
  // the JSX render reacting to the same hover-ended change, so there was
  // nothing mid-flight left to capture.
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
    const dur = duration();
    if (!textRef) return;
    clearReturnTimers();

    if (animate) {
      textRef.style.transition = "";
      textRef.style.transform = "";
      textRef.style.animation = `marquee-scroll ${dur}s ease-in-out infinite`;
      return;
    }

    const wasPlaying = textRef.style.animation !== "" && textRef.style.animation !== "none";
    if (!wasPlaying) {
      textRef.style.animation = "none";
      textRef.style.transform = "";
      textRef.style.transition = "";
      return;
    }

    // capture the mid-flight position before touching anything else.
    const computed = getComputedStyle(textRef).transform;
    textRef.style.animation = "none";
    textRef.style.transition = "";
    textRef.style.transform = computed && computed !== "none" ? computed : "translateX(0)";

    // double rAF: the first guarantees the frozen transform above has
    // actually been painted before we change it again - a single rAF
    // can still land in the same style-recalc pass on some browsers,
    // which drops the transition instead of animating it.
    returnRaf = requestAnimationFrame(() => {
      returnRaf = requestAnimationFrame(() => {
        returnRaf = undefined;
        if (!textRef) return;
        textRef.style.transition = `transform ${RETURN_DURATION_MS}ms ease-out`;
        textRef.style.transform = "translateX(0)";
        returnTimer = setTimeout(() => {
          returnTimer = undefined;
          if (!textRef) return;
          textRef.style.transition = "";
          textRef.style.transform = "";
        }, RETURN_DURATION_MS);
      });
    });
  });
  onCleanup(clearReturnTimers);

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
        class={`block whitespace-nowrap ${props.padClass || ""} ${hoverClassName()}`}
        style={{
          "--marquee-offset": `${offset()}px`,
        }}
      >
        {props.children ?? props.text}
      </span>
    </div>
  );
}

export default MarqueeText;
