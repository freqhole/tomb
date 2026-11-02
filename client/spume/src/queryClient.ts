// shared query client instance for tanstack-query
// isolated from app entry point to avoid circular dependencies

import { QueryClient } from "@tanstack/solid-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    // local IDB/IPC reads and writes must run even when navigator.onLine is false.
    // remote failures still pause retries until connectivity returns.
    queries: { networkMode: "offlineFirst" },
    mutations: { networkMode: "offlineFirst" },
  },
});
