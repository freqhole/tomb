import { For, Show, createSignal } from "solid-js";
import { useStore } from "../../../store";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import type { RouteSectionProps } from "@solidjs/router";

interface ArtistSplitViewProps {
  class?: string;
}

export function ArtistSplitView(
  props: RouteSectionProps<unknown> & ArtistSplitViewProps = {} as any
) {
  const [] = useStore();
  const events = useGlobalEvents();

  // Mock data for now
  const [artists] = createSignal([
    { name: "Arctic Monkeys", songCount: 64, albumCount: 6 },
    { name: "The Strokes", songCount: 52, albumCount: 6 },
    { name: "Tame Impala", songCount: 43, albumCount: 4 },
    { name: "Mac DeMarco", songCount: 38, albumCount: 5 },
    { name: "MGMT", songCount: 29, albumCount: 4 },
    { name: "Phoenix", songCount: 31, albumCount: 5 },
    { name: "Foster the People", songCount: 26, albumCount: 3 },
    { name: "Two Door Cinema Club", songCount: 34, albumCount: 4 },
  ]);

  const [selectedArtist, setSelectedArtist] = createSignal<string | null>(null);

  const handleArtistClick = (artistName: string) => {
    setSelectedArtist(artistName);
    events.emit("artist:selected", { artist: { name: artistName } });
  };

  return (
    <div class={`flex h-full bg-black text-white ${props.class || ""}`}>
      {/* Left Panel - Artist List */}
      <div class="w-1/3 flex flex-col">
        {/* Header */}
        <div class="flex-shrink-0 p-6">
          <h1 class="text-2xl font-semibold text-white mb-2">artists</h1>
          <p class="text-magenta-300 text-sm">{artists().length} artists</p>
        </div>

        {/* Artist List - Scrollable */}
        <div class="flex-1 overflow-y-auto">
          <For each={artists()}>
            {(artist) => (
              <div
                class={`px-6 py-4 hover:bg-magenta-600/20 transition-colors cursor-pointer ${
                  selectedArtist() === artist.name ? "bg-magenta-600/30" : ""
                }`}
                onClick={() => handleArtistClick(artist.name)}
              >
                <div class="text-white font-medium mb-1">{artist.name}</div>
                <div class="text-magenta-400 text-sm">
                  {artist.songCount} songs · {artist.albumCount} albums
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Right Panel - Artist Detail */}
      <div class="flex-1 flex flex-col">
        <Show
          when={selectedArtist()}
          fallback={
            <div class="flex-1 flex items-center justify-center">
              <div class="text-center">
                <div class="text-6xl mb-4">👤</div>
                <div class="text-white text-xl mb-2">select an artist</div>
                <div class="text-magenta-400">
                  choose an artist from the list to view details
                </div>
              </div>
            </div>
          }
        >
          <div class="flex-1 overflow-y-auto p-6">
            <h2 class="text-3xl font-bold text-white mb-4">
              {selectedArtist()}
            </h2>

            {/* Artist Info */}
            <div class="grid grid-cols-3 gap-6 mb-8">
              <div class="bg-magenta-950/30 rounded-lg p-4">
                <div class="text-magenta-300 text-sm mb-1">songs</div>
                <div class="text-white text-2xl font-semibold">
                  {artists().find((a) => a.name === selectedArtist())
                    ?.songCount || 0}
                </div>
              </div>
              <div class="bg-magenta-950/30 rounded-lg p-4">
                <div class="text-magenta-300 text-sm mb-1">albums</div>
                <div class="text-white text-2xl font-semibold">
                  {artists().find((a) => a.name === selectedArtist())
                    ?.albumCount || 0}
                </div>
              </div>
              <div class="bg-magenta-950/30 rounded-lg p-4">
                <div class="text-magenta-300 text-sm mb-1">genres</div>
                <div class="text-white text-2xl font-semibold">indie rock</div>
              </div>
            </div>

            {/* Quick Actions */}
            <div class="flex space-x-3 mb-8">
              <button class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 hover:border hover:border-magenta-400 rounded text-black font-medium transition-all">
                play all
              </button>
              <button class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 hover:border hover:border-magenta-400 rounded text-white font-medium transition-all">
                shuffle
              </button>
              <button class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 hover:border hover:border-magenta-400 rounded text-white font-medium transition-all">
                add to queue
              </button>
            </div>

            {/* Placeholder for albums/songs */}
            <div class="space-y-6">
              <div>
                <h3 class="text-xl font-semibold text-white mb-4">
                  popular songs
                </h3>
                <div class="space-y-2">
                  <div class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer">
                    <div class="text-white font-medium">song title</div>
                    <div class="text-magenta-400 text-sm">
                      album name · 3:42
                    </div>
                  </div>
                  <div class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer">
                    <div class="text-white font-medium">another song</div>
                    <div class="text-magenta-400 text-sm">
                      album name · 4:15
                    </div>
                  </div>
                  <div class="p-3 rounded hover:bg-magenta-600/20 transition-colors cursor-pointer">
                    <div class="text-white font-medium">third song</div>
                    <div class="text-magenta-400 text-sm">
                      album name · 2:58
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 class="text-xl font-semibold text-white mb-4">albums</h3>
                <div class="grid grid-cols-2 gap-4">
                  <div class="rounded-lg p-4 hover:bg-magenta-600/20 transition-colors cursor-pointer">
                    <div class="w-full aspect-square bg-magenta-800/30 rounded mb-3 flex items-center justify-center">
                      <svg
                        class="w-8 h-8 text-magenta-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                      </svg>
                    </div>
                    <div class="text-white font-medium mb-1">album title</div>
                    <div class="text-magenta-400 text-sm">2023 · 12 songs</div>
                  </div>
                  <div class="rounded-lg p-4 hover:bg-magenta-600/20 transition-colors cursor-pointer">
                    <div class="w-full aspect-square bg-magenta-800/30 rounded mb-3 flex items-center justify-center">
                      <svg
                        class="w-8 h-8 text-magenta-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                      </svg>
                    </div>
                    <div class="text-white font-medium mb-1">another album</div>
                    <div class="text-magenta-400 text-sm">2021 · 10 songs</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
