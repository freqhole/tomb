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
  const [mounted, setMounted] = createSignal(false);

  // Configuration
  const apiBaseUrl = () => props.apiBaseUrl || window.location.origin;
  const theme = () => props.theme || "dark";
  const authToken = () => props.authToken;
  const debug = () => props.debug === true;

  // Initialize API client - TEMPORARILY DISABLED FOR TAILWIND DEBUG
  onMount(async () => {
    try {
      console.log("tailwind debug mode - data loading paused", {
        apiBaseUrl: apiBaseUrl(),
        theme: theme(),
        authToken: authToken() ? "***" : undefined,
        timestamp: Date.now(),
        note: "Staying in loading state to debug Tailwind CSS",
      });

      if (debug()) {
        console.log(
          "freqhole music admin: TAILWIND DEBUG - skipping initialization",
          {
            apiBaseUrl: apiBaseUrl(),
            theme: theme(),
            authToken: authToken() ? "***" : undefined,
          }
        );
      }

      // TEMPORARILY COMMENTED OUT FOR TAILWIND DEBUGGING
      // Uncomment these lines when ready to proceed with normal loading

      // const client = new ApiClient({
      //   baseUrl: apiBaseUrl(),
      //   timeout: 30000,
      //   defaultHeaders: authToken()
      //     ? { Authorization: `Bearer ${authToken()}` }
      //     : {},
      // });

      // setApiClient(client);
      // setMounted(true);
    } catch (err) {
      console.error("freqhole music admin: failed to initialize:", err);
      setError(err instanceof Error ? err.message : "Failed to initialize");
    }
  });

  onCleanup(() => {
    if (debug()) {
      console.log("freqhole music admin: cleaning up");
    }
  });

  // Error state
  if (error()) {
    return (
      <div class="freqhole-music-admin-error h-full flex items-center justify-center bg-red-50">
        <div class="text-center p-8">
          <div class="text-red-600 text-6xl mb-4">!</div>
          <h2 class="text-xl font-bold text-red-800 mb-2">
            Failed to Initialize Music Admin
          </h2>
          <p class="text-red-600 mb-4">{error()}</p>
          <button
            onClick={() => window.location.reload()}
            class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  // Main component - always render, but show different states
  return (
    <div
      class={`freqhole-music-admin h-full ${theme() === "dark" ? "dark" : ""}`}
    >
      <Show
        when={mounted() && apiClient()}
        fallback={
          <div class="freqhole-music-admin-loading h-full flex flex-col items-center justify-center bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
            {/* Simple Tailwind Debug */}
            <div class="fixed top-4 left-4 bg-black/80 text-white p-4 rounded-lg border border-magenta-500 shadow-2xl">
              <h3 class="text-magenta-400 font-bold text-sm mb-2">
                tailwind debug
              </h3>
              <div class="text-xs text-gray-300">testing magenta-500 color</div>
            </div>

            {/* Main Loading Content */}
            <div class="text-center p-8 max-w-md">
              {/* Animated Spinner */}
              <div class="relative mb-8">
                <div class="animate-spin rounded-full h-16 w-16 border-4 border-magenta-500/30 border-t-magenta-500 mx-auto"></div>
              </div>

              {/* Text */}
              <h2 class="text-2xl font-bold text-white mb-3 tracking-wide">
                loading music admin
              </h2>
              <p class="text-gray-300 mb-6 text-sm">
                testing tailwind colors...
              </p>

              {/* Simple Test Grid */}
              <div class="grid grid-cols-2 gap-4 mb-6">
                <div class="bg-magenta-500/20 border border-magenta-400 rounded-lg p-3">
                  <div class="text-magenta-300 text-xs font-semibold">
                    magenta
                  </div>
                  <div class="text-white text-sm">should be purple</div>
                </div>
                <div class="bg-cyan-500/20 border border-cyan-400 rounded-lg p-3">
                  <div class="text-cyan-300 text-xs font-semibold">cyan</div>
                  <div class="text-white text-sm">should be blue</div>
                </div>
              </div>

              {/* Test Button */}
              <button
                onClick={async () => {
                  console.log("re-enabling data loading...");
                  try {
                    const client = new ApiClient({
                      baseUrl: apiBaseUrl(),
                      timeout: 30000,
                      defaultHeaders: authToken()
                        ? { Authorization: `Bearer ${authToken()}` }
                        : {},
                    });
                    setApiClient(client);
                    setMounted(true);
                    console.log("data loading re-enabled");
                  } catch (err) {
                    console.error("failed to re-enable loading:", err);
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Failed to initialize"
                    );
                  }
                }}
                class="w-full bg-magenta-600 hover:bg-magenta-700 text-white font-medium py-2 px-4 rounded-lg transition-colors duration-200 transform hover:scale-105"
              >
                enable data loading (exit debug)
              </button>

              {/* Debug Info */}
              <div class="mt-6 text-xs text-gray-500 space-y-1">
                <div>theme: {theme()}</div>
                <div>api: {apiBaseUrl()}</div>
                <div>mounted: {mounted() ? "true" : "false"}</div>
                <div>client: {apiClient() ? "ready" : "pending"}</div>
              </div>
            </div>

            {/* Bottom Test Strip */}
            <div class="fixed bottom-4 left-4 right-4 bg-black/60 backdrop-blur-sm rounded-lg p-2 border border-magenta-500/30">
              <div class="flex justify-center space-x-2 text-xs">
                <span class="text-magenta-400">magenta</span>
                <span class="text-cyan-400">cyan</span>
                <span class="text-yellow-400">yellow</span>
                <span class="text-green-400">green</span>
              </div>
              <div class="text-center text-gray-400 text-xs mt-1">
                color test strip
              </div>
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
    </div>
  );
}
