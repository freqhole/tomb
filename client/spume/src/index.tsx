// polyfill crypto.randomUUID() for old WebView (must run before any other imports)
import "./utils/uuid";

// install console capture as early as possible so we don't miss
// startup errors. safe to call before any other module logs.
import { install as installLogCapture } from "./app/services/logCapture";
installLogCapture();

import { QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { App } from "./app/App";
import { isCharnelMode } from "./app/services/charnel";
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

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  ),
  root
);
