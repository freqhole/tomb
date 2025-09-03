import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { AdminView } from "./components/AdminView.js";
import { ApiClient } from "../../lib/api-client.js";
import "./styles.css";

console.log("freqhole music admin view loading");

// List all important API endpoints for debugging
const API_ENDPOINTS = {
  search: "/api/music/search",
  filterOptions: "/api/music/filter-options",
  suggestions: "/api/music/suggestions",
};

export interface FreqHoleMusicAdminProps {
  apiBaseUrl?: string;
  theme?: "light" | "dark";
  authToken?: string;
  debug?: boolean;
}

export default function FreqHoleMusicAdmin(
  props: FreqHoleMusicAdminProps = {}
) {
  const [apiClient, setApiClient] = createSignal<ApiClient | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

  // configuration
  const apiBaseUrl = () => props.apiBaseUrl || window.location.origin;
  const theme = () => props.theme || "dark";
  const authToken = () => props.authToken;
  const debug = () => props.debug === true;

  // initialize API client
  onMount(async () => {
    try {
      console.log("freqhole music admin: initializing", {
        apiBaseUrl: apiBaseUrl(),
        theme: theme(),
        authToken: authToken() ? "***" : undefined,
      });

      const client = new ApiClient({
        baseUrl: apiBaseUrl(),
        timeout: 30000,
        defaultHeaders: authToken()
          ? { Authorization: `Bearer ${authToken()}` }
          : {},
      });

      // test connection and API endpoints
      try {
        await client.health();
        console.log("freqhole music admin: health check successful");

        // Log all API endpoints for debugging
        console.log(
          "freqhole music admin: expected API endpoints",
          API_ENDPOINTS
        );

        // Try to fetch from search endpoint directly to validate it exists
        const testSearchResponse = await client
          .makeRequest("GET", API_ENDPOINTS.search, {
            params: { page: 1, page_size: 1 },
          })
          .catch((err) => {
            console.warn(
              `freqhole music admin: ${API_ENDPOINTS.search} endpoint test failed`,
              err
            );
            return null;
          });

        if (testSearchResponse) {
          console.log(
            `freqhole music admin: ${API_ENDPOINTS.search} endpoint confirmed working`
          );
        }
      } catch (err) {
        console.warn("freqhole music admin: api tests encountered issues", err);
        // Continue anyway since health check may be enough
      }

      setApiClient(client);
      setLoading(false);

      console.log("freqhole music admin: initialization complete");
    } catch (err) {
      console.error("freqhole music admin: failed to initialize:", err);
      setError(err instanceof Error ? err.message : "failed to initialize");
      setLoading(false);
    }
  });

  onCleanup(() => {
    if (debug()) {
      console.log("freqhole music admin: cleaning up");
    }
  });

  // Error handling helper
  const formatErrorMessage = (err: unknown): string => {
    if (err instanceof Error) {
      return err.message;
    } else if (typeof err === "string") {
      return err;
    } else if (err && typeof err === "object" && "statusText" in err) {
      return `API Error: ${(err as any).statusText || "Unknown"}`;
    } else {
      return "unknown error occurred";
    }
  };

  // main component - use Show for reactive rendering
  return (
    <div
      class={`freqhole-music-admin h-full ${theme() === "dark" ? "dark" : ""}`}
    >
      <Show
        when={error()}
        fallback={
          <Show
            when={loading()}
            fallback={
              <Show
                when={apiClient()}
                fallback={
                  <div class="freqhole-music-admin-error h-full flex items-center justify-center bg-red-900">
                    <div class="text-center p-8">
                      <div class="text-red-400 text-6xl mb-4">!</div>
                      <h2 class="text-xl font-bold text-red-300 mb-2">
                        api client initialization failed
                      </h2>
                      <p class="text-red-400 mb-4">
                        could not create api client
                      </p>
                    </div>
                  </div>
                }
              >
                <AdminView
                  apiClient={apiClient()!}
                  theme={theme()}
                  className="h-full"
                />
              </Show>
            }
          >
            <div class="freqhole-music-admin-loading h-full flex items-center justify-center bg-gray-900">
              <div class="text-center">
                <div class="animate-spin h-12 w-12 border-2 border-magenta-500 border-t-transparent mx-auto mb-4"></div>
                <h2 class="text-xl font-bold text-white mb-2">
                  loading music admin
                </h2>
                <p class="text-gray-300">connecting to server...</p>
              </div>
            </div>
          </Show>
        }
      >
        <div class="freqhole-music-admin-error h-full flex items-center justify-center bg-red-900">
          <div class="text-center p-8">
            <div class="text-red-400 text-6xl mb-4">!</div>
            <h2 class="text-xl font-bold text-red-300 mb-2">
              failed to initialize music admin
            </h2>
            <p class="text-red-400 mb-4">{error()}</p>
            <div class="space-y-4">
              <button
                onClick={() => window.location.reload()}
                class="px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                reload page
              </button>
              <div class="text-sm text-gray-300 mt-4">
                <p>expected api endpoints:</p>
                <ul class="text-gray-400 mt-2 text-xs text-left pl-4">
                  <li>
                    • {apiBaseUrl()}
                    {API_ENDPOINTS.search}
                  </li>
                  <li>
                    • {apiBaseUrl()}
                    {API_ENDPOINTS.filterOptions}
                  </li>
                  <li>
                    • {apiBaseUrl()}
                    {API_ENDPOINTS.suggestions}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
