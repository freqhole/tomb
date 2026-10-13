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

/** tailwind lg breakpoint (1024px) */
export const LG_MIN_WIDTH = 1024;

/** tailwind xl breakpoint (1280px) */
export const XL_MIN_WIDTH = 1280;

/**
 * check if viewport is lg or larger (>= 1024px)
 */
export function isLgViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= LG_MIN_WIDTH;
}

/**
 * check if viewport is xl or larger (>= 1280px)
 */
export function isXlViewport(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= XL_MIN_WIDTH;
}

/**
 * resolved `env(safe-area-inset-bottom)` in px, measured once and cached.
 *
 * NOT read via `getComputedStyle(document.documentElement).getPropertyValue
 * ("--safe-area-bottom")` - that returns a *custom* property's declared text
 * as-authored (`"env(safe-area-inset-bottom, 0px)"`), not a resolved pixel
 * value (custom properties are textual substitution, not computed like
 * normal properties - this bit both this function's previous implementation
 * and `getPlayerBarHeightPx()` below, which `parseFloat()`-ed that same
 * unparseable text and silently always fell back to its flat constant).
 * `getComputedStyle` DOES correctly resolve `env()`/`calc()` for a *regular*
 * property though, so a throwaway element using `padding-bottom` (a normal
 * property) is the standard, reliable way to read this value in JS.
 */
let cachedSafeAreaBottomPx: number | null = null;
function measureSafeAreaBottomPx(): number {
  if (cachedSafeAreaBottomPx !== null) return cachedSafeAreaBottomPx;
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  document.body.appendChild(probe);
  const resolved = parseFloat(getComputedStyle(probe).paddingBottom);
  probe.remove();
  cachedSafeAreaBottomPx = Number.isFinite(resolved) ? resolved : 0;
  return cachedSafeAreaBottomPx;
}

/**
 * playerbar height in px, matching theme.css's `--player-height` exactly
 * (80px narrow / 72px wide, both plus `--safe-area-bottom`). used wherever
 * a view computes an explicit list height in JS (virtualized lists, etc) -
 * views that just render the css var directly don't need this. computed
 * analytically (flat base + measured safe-area-bottom) rather than by
 * reading `--player-height` itself, since that's a `calc()`-based custom
 * property with no JS-resolved override anywhere (unlike `--nav-height`,
 * which `TopNav.tsx`'s own `ResizeObserver` sync keeps as an always-
 * resolved inline px value) - see `measureSafeAreaBottomPx()`'s doc
 * comment for why reading it directly never actually worked. a device
 * with a nonzero safe-area-bottom (iOS home indicator, android edge-to-
 * edge) has a REAL playerbar taller than the flat 80/72px constant, which
 * under-reserved space and let a virtualized list's last row(s) render
 * partly behind the actual (taller) playerbar.
 */
export function getPlayerBarHeightPx(isNarrow: boolean, visible: boolean): number {
  if (!visible) return 0;
  const base = isNarrow ? 80 : 72;
  return base + measureSafeAreaBottomPx();
}
