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

// real safe-area insets are now resolved unconditionally by CSS itself
// (theme.css's `--safe-area-top: env(safe-area-inset-top, 0px)`) - no
// platform detection needed here at all anymore. this used to be a
// tauri-android/ios-only JS gate (see theme.css's own comment on
// --safe-area-top for the full history of why that was removed).

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
