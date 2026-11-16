import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { currentMenuViewport } from "./dropdownPosition";

export function useVisualViewportStyle() {
  const [style, setStyle] = createSignal<JSX.CSSProperties>({});
  onMount(() => {
    const update = () => {
      const viewport = currentMenuViewport();
      setStyle({
        position: "fixed",
        left: `${viewport.left}px`,
        top: `${viewport.top}px`,
        right: "auto",
        bottom: "auto",
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    onCleanup(() => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    });
  });
  return style;
}

// keep existing anchors and hover containment while clamping the rendered box.
export function constrainToVisualViewport(element: HTMLElement) {
  onMount(() => {
    const original = {
      position: element.style.position,
      left: element.style.left,
      right: element.style.right,
      top: element.style.top,
      bottom: element.style.bottom,
    };
    const initialComputed = getComputedStyle(element);
    const minimumWidth = initialComputed.minWidth;
    const maximumWidth = initialComputed.maxWidth;
    const maximumHeight = initialComputed.maxHeight;
    const update = () => {
      Object.assign(element.style, original);
      const viewport = currentMenuViewport();
      const width = Math.max(0, viewport.width - 16);
      const height = Math.max(0, viewport.height - 16);
      element.style.boxSizing = "border-box";
      element.style.minWidth = `min(${minimumWidth}, ${width}px)`;
      element.style.maxWidth =
        maximumWidth === "none" ? `${width}px` : `min(${maximumWidth}, ${width}px)`;
      element.style.maxHeight =
        maximumHeight === "none" ? `${height}px` : `min(${maximumHeight}, ${height}px)`;
      element.style.overflowY = "auto";
      element.style.overflowX = "hidden";
      const rect = element.getBoundingClientRect();
      const dx = Math.max(
        viewport.left + 8 - rect.left,
        Math.min(0, viewport.left + viewport.width - 8 - rect.right)
      );
      const dy = Math.max(
        viewport.top + 8 - rect.top,
        Math.min(0, viewport.top + viewport.height - 8 - rect.bottom)
      );
      const computed = getComputedStyle(element);
      if (computed.position === "absolute" || computed.position === "fixed") {
        element.style.left = `${element.offsetLeft - parseFloat(computed.marginLeft) + dx}px`;
        element.style.top = `${element.offsetTop - parseFloat(computed.marginTop) + dy}px`;
        element.style.right = "auto";
        element.style.bottom = "auto";
      } else {
        element.style.position = "relative";
        element.style.left = `${dx}px`;
        element.style.top = `${dy}px`;
      }
    };
    update();
    const frame = requestAnimationFrame(update);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
    observer?.observe(element);
    if (element.parentElement) observer?.observe(element.parentElement);
    const positionObserver = new MutationObserver(update);
    if (element.parentElement) {
      positionObserver.observe(element.parentElement, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      positionObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    });
  });
}
