import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { AdminView } from "./components/AdminView.js";
import { ApiClient } from "../../lib/api-client.js";
import "./styles.css";

console.log("freqhole music admin view loading");

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

      // test connection
      await client.health();

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
              <Show when={apiClient()}>
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
            <button
              onClick={() => window.location.reload()}
              class="px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              reload page
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
