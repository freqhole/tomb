import { Show } from "solid-js";

export function ThreeColumnLayout(props: any) {
  // TODO: Add store/state management
  const queueOpen = false; // Temporary - will come from store
  const breakpoint: "desktop" | "tablet" | "mobile" = "desktop"; // Temporary - will come from responsive hook

  const columnClasses = () => {
    if (breakpoint === "mobile") return "grid-cols-1";
    if (breakpoint === "tablet")
      return "grid-cols-12 [&>*:nth-child(1)]:col-span-4 [&>*:nth-child(2)]:col-span-8";

    return queueOpen
      ? "grid-cols-12 [&>*:nth-child(1)]:col-span-3 [&>*:nth-child(2)]:col-span-6 [&>*:nth-child(3)]:col-span-3"
      : "grid-cols-12 [&>*:nth-child(1)]:col-span-4 [&>*:nth-child(2)]:col-span-8";
  };

  return (
    <div class="h-screen flex flex-col bg-black text-white font-sans">
      <div class={`grid flex-1 ${columnClasses()}`}>
        {/* Navigation Column */}
        <div class="bg-black/80">
          <div class="p-4">
            <div class="mb-4">
              <h1 class="text-xl font-bold">freqhole</h1>
            </div>
            <div class="space-y-2">
              <div class="p-2 rounded-lg hover:bg-magenta-500/20 cursor-pointer">
                songs
              </div>
              <div class="p-2 rounded-lg hover:bg-magenta-500/20 cursor-pointer">
                artists
              </div>
              <div class="p-2 rounded-lg hover:bg-magenta-500/20 cursor-pointer">
                albums
              </div>
              <div class="p-2 rounded-lg hover:bg-magenta-500/20 cursor-pointer">
                playlists
              </div>
            </div>
          </div>
        </div>

        {/* Content Column */}
        <div class="bg-black flex flex-col">
          <div class="flex-1 overflow-y-auto">{props.children}</div>
        </div>

        {/* Queue Column (conditional) */}
        <Show when={queueOpen}>
          <div class="bg-black/80">
            <div class="p-4">
              <h2 class="text-lg font-semibold mb-4">queue</h2>
              <div class="text-gray-400 text-sm">queue is empty</div>
            </div>
          </div>
        </Show>
      </div>

      {/* Footer Player */}
      <div class="min-h-16 bg-black">
        <div class="p-4 text-center text-gray-400 text-sm">
          player will go here
        </div>
      </div>
    </div>
  );
}
