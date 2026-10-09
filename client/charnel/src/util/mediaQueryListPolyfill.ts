// polyfills MediaQueryList.addEventListener/removeEventListener for old
// WebView (Safari/WebKit < 14, e.g. macOS Catalina's system WebKit) which
// never implemented EventTarget on MediaQueryList - only the legacy
// addListener/removeListener. without this, any `mql.addEventListener`
// call throws "addEventListener is not a function" and kills the whole
// script (confirmed real-world on macOS 10.15.7, in this wizard app).
//
// patching MediaQueryList.prototype directly (the obvious approach) turned
// out to be unreliable here: confirmed real 2026-10-06, paused in the
// debugger showed `e` genuinely typed as MediaQueryList with an
// addEventListener entry visible on its own prototype, yet calling
// `e.addEventListener(...)` still threw "not a function" - something
// (monaco-editor's vscodeMediaEnvironment hook, used for vscode's
// multi-window support) can hand back an object whose effective prototype
// isn't the exact MediaQueryList.prototype this module patches. wrapping
// `matchMedia` itself and patching each RETURNED INSTANCE directly sidesteps
// prototype-identity entirely - the methods always exist as own-properties
// on whatever object any caller gets back, regardless of realm/prototype.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const nativeMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = function (query: string): MediaQueryList {
    const mql = nativeMatchMedia(query);
    if (!mql.addEventListener) {
      (mql as any).addEventListener = function (
        this: MediaQueryList,
        type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) {
        if (type === "change") this.addListener(listener);
      };
      (mql as any).removeEventListener = function (
        this: MediaQueryList,
        type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) {
        if (type === "change") this.removeListener(listener);
      };
    }
    return mql;
  };
}

// keep the prototype patch too, as a cheap no-op-if-already-fine fallback
// for any direct MediaQueryList instances not obtained via window.matchMedia.
if (typeof MediaQueryList !== "undefined" && !MediaQueryList.prototype.addEventListener) {
  (MediaQueryList.prototype as any).addEventListener = function (
    this: MediaQueryList,
    type: string,
    listener: (event: MediaQueryListEvent) => void,
  ) {
    if (type === "change") this.addListener(listener);
  };
  (MediaQueryList.prototype as any).removeEventListener = function (
    this: MediaQueryList,
    type: string,
    listener: (event: MediaQueryListEvent) => void,
  ) {
    if (type === "change") this.removeListener(listener);
  };
}
