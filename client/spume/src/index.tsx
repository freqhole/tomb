// polyfill crypto.randomUUID() for old WebView (must run before any other imports)
import "./utils/uuid";

// install console capture as early as possible so we don't miss
// startup errors. safe to call before any other module logs.
import { install as installLogCapture } from "./app/services/logCapture";
installLogCapture();

import { QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { App } from "./app/App";
import { queryClient } from "./queryClient";

export { queryClient };

const root = document.getElementById("root");

if (!root) {
  throw new Error("root element not found");
}

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  ),
  root
);
