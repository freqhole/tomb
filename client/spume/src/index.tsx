// polyfill crypto.randomUUID() for old WebView (must run before any other imports)
import "./utils/uuid";
// polyfill MediaQueryList.addEventListener for old WebView (must run before any other imports)
import "./utils/mediaQueryListPolyfill";
// polyfill CanvasRenderingContext2D/Path2D.roundRect for old WebView (must run before any other imports)
import "./utils/roundRectPolyfill";

// install console capture as early as possible so we don't miss
// startup errors. safe to call before any other module logs.
import { install as installLogCapture } from "./app/services/logCapture";
installLogCapture();

import { QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { createResource, Show } from "solid-js";
import { App } from "./app/App";
import { isCharnelMode } from "./app/services/charnel";
import { acquireSingleInstanceLock } from "./app/services/singleInstance";
import { queryClient } from "./queryClient";

export { queryClient };

const root = document.getElementById("root");

if (!root) {
  throw new Error("root element not found");
}

// activate real safe-area inset only on mobile tauri (android or ios),
// where the webview draws edge-to-edge behind the system status bar/notch -
// confirmed for ios by reading tauri's underlying wry/tao source directly:
// the root UIView tao creates is sized to the full screen bounds (not a
// safe-area-constrained region - `inner_size()`'s own safe-area adjustment
// is just a reported/logical size for resize events, not the view's actual
// frame), and wry's WKWebView is added as a subview with an autoresizing
// mask that fills that same full-screen superview - so ios tauri needs the
// identical activation android tauri already gets here (previously
// android-only - ios was never excluded on purpose, just not yet
// considered when this was written, before ios tauri work began).
//
// uses the compile-time `__TAURI_TARGET_OS__` constant (see
// vite.config.ts), not `navigator.userAgent` sniffing - this runs at the
// very top of boot, before `App.tsx` even mounts, so the runtime
// `isAndroidTauri()`/`isIosTauri()` signal (populated later, async, via a
// `get_build_info` invoke) isn't available yet here; the build-time
// constant has no such race and needs no invoke round-trip at all.
//
// deliberately NOT extended to plain ios safari/PWA (outside tauri) even
// though it also reports a nonzero env(safe-area-inset-top) without
// viewport-fit=cover (this app's `apple-mobile-web-app-status-bar-style:
// black-translucent` meta tag already extends PWA content under the
// status bar on its own) - that's an existing, separate gap, unrelated to
// this tauri-specific fix.
if (isCharnelMode() && (__TAURI_TARGET_OS__ === "android" || __TAURI_TARGET_OS__ === "ios")) {
  document.documentElement.style.setProperty("--safe-area-top", "env(safe-area-inset-top, 0px)");
}

// tauri/charnel is a single native window, no multi-tab concern - only a
// plain browser needs the single-instance lock (see singleInstance.ts).
function Root() {
  if (isCharnelMode()) return <App />;

  const [isPrimaryTab] = createResource(acquireSingleInstanceLock);

  return (
    <Show when={!isPrimaryTab.loading}>
      <Show
        when={isPrimaryTab()}
        fallback={
          <div class="flex items-center justify-center h-screen bg-[var(--color-bg-primary)]">
            <p class="text-[var(--color-text-secondary)]">freqhole is running in another tab.</p>
          </div>
        }
      >
        <App />
      </Show>
    </Show>
  );
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  ),
  root
);

// reaching this point means the module script (and, by document order,
// the stylesheet before it) both loaded and parsed fine - clear the
// one-shot stale-asset reload guard set in index.html so a genuinely new
// failure later in this session can still trigger a retry.
sessionStorage.removeItem("freqhole-stale-asset-reload");
