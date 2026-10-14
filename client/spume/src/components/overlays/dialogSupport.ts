// shared setup for every hand-rolled `<dialog>` element in the app - both
// the polyfill registration AND the inline style reset below. extracted
// after fixing the exact same "modal shows a big white box" bug
// separately in Modal.tsx and (again) in ConnectionProgressModal.tsx -
// each had its own copy-pasted (and incomplete/stale) `<dialog>` setup,
// so the fix kept needing to be re-applied one file at a time. any future
// `<dialog>` usage should import from here instead of re-deriving this.
import dialogPolyfill from "dialog-polyfill";
import type { JSX } from "solid-js";

// dialog-polyfill's stylesheet restyles EVERY <dialog> (white background,
// 1em padding, solid border, absolute positioning) with unlayered css,
// which beats tailwind v4's layered utilities (bg-transparent, p-0, ...) -
// loaded unconditionally it gave every browser-implemented-dialog modal a
// white box around its card. only load it where <dialog> isn't already
// built into the webview and the polyfill is actually doing the work.
export const hasBuiltInDialog =
  typeof HTMLDialogElement === "function" &&
  typeof HTMLDialogElement.prototype.showModal === "function";
if (!hasBuiltInDialog) {
  // eslint-disable-next-line no-restricted-syntax
  void import("dialog-polyfill/dist/dialog-polyfill.css");
}

// essential dialog resets applied via inline `style`, not tailwind
// classes - this is the actual fix for a reported "modal shows a big
// white area" bug: the `hasBuiltInDialog` check above only avoids
// loading the polyfill's own stylesheet on devices that DON'T need it,
// but if a webview's own dialog *feature detection* is itself unreliable
// (reports a method exists but some part of the behavior it implies
// doesn't, or simply differs from this host's assumptions),
// `hasBuiltInDialog` can end up true-when-it-shouldn't-be - and once
// that happens, tailwind's own unlayered rules (e.g. media/plugin css
// that isn't itself inside tailwind's `@layer`) can equally lose a
// specificity tie against the browser's own default `dialog` stylesheet
// (which `dialog-polyfill`'s css simply mirrors) in less-common
// cascade-layer edge cases. inline styles always win over ANY stylesheet
// rule - author or browser-default, layered or not - so this is airtight
// regardless of which of those is actually happening on a given device,
// with no per-device diagnosis required.
export const DIALOG_RESET_STYLE: JSX.CSSProperties = {
  background: "transparent",
  padding: "0",
  border: "none",
  margin: "auto",
  "max-width": "none",
  "max-height": "none",
};

// old WebKit (e.g. macOS Catalina's system WebKit, <Safari 15.4) has no
// `<dialog>`/showModal() support built in at all - registerDialog no-ops
// if that support already exists, so this is safe to call
// unconditionally. must run (via onMount, before the first showModal()
// call) for every `<dialog>` element in the app.
export function registerDialogPolyfill(dialogEl: HTMLDialogElement | undefined): void {
  if (dialogEl) dialogPolyfill.registerDialog(dialogEl);
}
