import { createSignal, onMount, For } from "solid-js";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";

interface PlaylistsNavigationProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function PlaylistsNavigation(props: PlaylistsNavigationProps) {
  const [playlists, setPlaylists] = createSignal<any[]>([]);
  const [, setLoading] = createSignal(false);
  const events = useGlobalEvents();

  // TODO: Replace with actual API call
  const loadRecentPlaylists = async () => {
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setPlaylists([
        { id: "1", name: "my favorites", song_count: 42 },
        { id: "2", name: "chill vibes", song_count: 28 },
        { id: "3", name: "workout hits", song_count: 35 },
      ] as any[]);
      setLoading(false);
    }, 500);
  };

  onMount(() => {
    loadRecentPlaylists();
  });

  const handleCreatePlaylist = () => {
    events.emit("modal:open", { modal: "createPlaylist" });
  };

  const handlePlaylistClick = (playlist: any) => {
    props.onNavigate(`/playlist/${playlist.id}`);
    events.emit("playlist:selected", { playlist });
  };

  return (
    <div class="p-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-medium text-white">playlists</h3>
        <button
          onClick={() => props.onNavigate("/playlists")}
          class="text-xs text-gray-400 hover:text-magenta-400 transition-colors duration-200"
        >
          view all
        </button>
      </div>

      <div class="space-y-1">
        <For each={playlists()}>
          {(playlist) => (
            <button
              class={`w-full text-left p-2 rounded-lg text-sm transition-all duration-200 ${
                props.currentPath === `/playlist/${playlist.id}`
                  ? "bg-magenta-600/30 text-white"
                  : "text-white hover:bg-magenta-600/20"
              }`}
              onClick={() => handlePlaylistClick(playlist)}
            >
              <div class="truncate">{playlist.name}</div>
              <div class="text-xs text-gray-400">
                {playlist.song_count} songs
              </div>
            </button>
          )}
        </For>
      </div>

      <button
        onClick={handleCreatePlaylist}
        class="w-full mt-2 p-2 bg-magenta-600 rounded-lg text-sm text-black font-medium hover:bg-magenta-500 hover:border hover:border-magenta-400 transition-all duration-200"
      >
        + create playlist
      </button>
    </div>
  );
}
