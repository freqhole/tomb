// centralized breakpoint definitions for responsive layouts
//
// small mode: 0-640px (phone, very compact layouts)
// narrow mode: 0-800px (mobile/tablet, single-column layouts)
// wide mode: 801px+ (desktop, multi-column layouts)
//
// these values should stay in sync with the `--breakpoint-wide` CSS variable
// defined in design-system/theme.css

/** max width for small/phone layouts (inclusive) */
export const SM_MAX_WIDTH = 500;

/** 
 * max width for narrow/mobile layouts (inclusive) 
 * mostly used for top nav search 
 */
export const NARROW_MAX_WIDTH = 800;

/** min width for wide/desktop layouts (inclusive) */
export const WIDE_MIN_WIDTH = 801;

/**
 * check if current viewport is small (phone mode)
 * returns true for viewport widths <= 640px
 */
export function isSmallViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= SM_MAX_WIDTH;
}

/**
 * check if current viewport is narrow (mobile/tablet mode)
 * returns true for viewport widths <= 800px
 */
export function isNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= NARROW_MAX_WIDTH;
}

/**
 * check if current viewport is wide (desktop mode)
 * returns true for viewport widths >= 801px
 */
export function isWideViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= WIDE_MIN_WIDTH;
}
