// polyfill crypto.randomUUID() for old WebView (must run before any other imports)
import "./utils/uuid";

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
