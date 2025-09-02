/* @jsxImportSource solid-js */
import { createSignal, Show } from "solid-js";
import { ApiClient } from "../../../lib/api-client.js";

export interface AdminViewProps {
  apiClient: ApiClient;
  className?: string;
  theme?: "light" | "dark";
}

/**
 * Simplified admin view component for initial development
 */
export function AdminView(props: AdminViewProps) {
  console.log("admin view: starting initialization", {
    apiClient: !!props.apiClient,
    theme: props.theme,
  });

  const [loading, setLoading] = createSignal(true);
  const [songCount, setSongCount] = createSignal(0);

  // Simulate loading some data
  setTimeout(() => {
    setLoading(false);
    setSongCount(150); // placeholder
  }, 1000);

  return (
    <div class={`admin-view h-full flex flex-col ${props.className || ""}`}>
      {/* Header */}
      <div class="bg-black px-6 py-4">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-white">music library admin</h1>
            <p class="text-sm text-gray-300 mt-1">{songCount()} songs total</p>
          </div>
          <div class="flex items-center space-x-4">
            <button class="px-4 py-2 bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors">
              refresh
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div class="flex-1 flex items-center justify-center bg-gray-900">
        <Show
          when={!loading()}
          fallback={
            <div class="text-center">
              <div class="animate-spin rounded-full h-12 w-12 border-2 border-magenta-500 border-t-transparent mx-auto mb-4"></div>
              <p class="text-white">loading admin interface...</p>
            </div>
          }
        >
          <div class="text-center">
            <h2 class="text-xl font-bold text-white mb-2">
              admin interface ready
            </h2>
            <p class="text-gray-300 mb-4">
              found {songCount()} songs in library
            </p>
            <div class="bg-magenta-500/20 border border-magenta-400 rounded-lg p-4">
              <p class="text-magenta-300 text-sm">
                admin grid component will be integrated here
              </p>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
