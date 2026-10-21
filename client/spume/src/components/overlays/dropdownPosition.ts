import type { JSX } from "solid-js";

export function dropdownPosition(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  viewport: { width: number; height: number; left: number; top: number },
  align: "left" | "right" = "right"
): JSX.CSSProperties {
  const pad = 8;
  const gutter = 4;
  const left = viewport.left + pad;
  const right = viewport.left + viewport.width - pad;
  const top = viewport.top + pad;
  const bottom = viewport.top + viewport.height - pad;
  const minimumWidth = Math.min(192, Math.max(0, right - left));
  const edge =
    align === "left"
      ? Math.max(left, Math.min(anchor.left, right - minimumWidth))
      : Math.min(right, Math.max(anchor.right, left + minimumWidth));
  const below = Math.min(bottom, Math.max(top, anchor.bottom + gutter));
  const above = Math.max(top, Math.min(bottom, anchor.top - gutter));
  const opensBelow = bottom - below >= above - top;
  const height = Math.max(0, opensBelow ? bottom - below : above - top);
  return {
    position: "fixed",
    left: align === "left" ? `${edge}px` : undefined,
    right: align === "right" ? `calc(100% - ${edge}px)` : undefined,
    top: opensBelow ? `${below}px` : undefined,
    bottom: opensBelow ? undefined : `calc(100% - ${above}px)`,
    "max-height": `${height}px`,
    "max-width": `${Math.max(0, align === "left" ? right - edge : edge - left)}px`,
    "min-width": `${minimumWidth}px`,
  };
}

export function currentMenuViewport() {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
  };
}
