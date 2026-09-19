// polyfill crypto.randomUUID() for old WebView (must run before any other imports)
import "./utils/uuid";

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

// activate real safe-area inset only on android tauri, where the webview
// draws edge-to-edge behind the system status bar. ios safari reports a
// nonzero env(safe-area-inset-top) even without viewport-fit=cover, so we
// can't rely on css env() directly — we gate it here instead.
if (isCharnelMode() && /android/i.test(navigator.userAgent)) {
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
