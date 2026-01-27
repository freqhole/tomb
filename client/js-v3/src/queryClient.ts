// shared query client instance for tanstack-query
// isolated from app entry point to avoid circular dependencies

import { QueryClient } from "@tanstack/solid-query";

export const queryClient = new QueryClient();
