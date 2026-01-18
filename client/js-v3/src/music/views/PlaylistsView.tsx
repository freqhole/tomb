// playlists view - displays all playlists in a grid
import { createResource, Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import { getDataSource } from "../data";
import { songsVersion } from "../services/storage/db";

export interface PlaylistsViewProps {
  onAddMusic: () => void;
  onPlaylistClick?: (playlistId: string) => void;
}

export function PlaylistsView(props: PlaylistsViewProps) {
  // fetch playlists from data source - refetch when songsVersion changes
  const [playlistsData] = createResource(songsVersion, async () => {
    const source = getDataSource();
    // TODO: implement getPlaylists in data source
    // for now, return empty
    return { items: [], total: 0, offset: 0, limit: 50, has_more: false };
  });

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            playlists
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {playlistsData()?.total ?? 0}{" "}
            {playlistsData()?.total === 1 ? "playlist" : "playlists"}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* playlist grid */}
      <div class="flex-1 overflow-auto p-4">
        <Show
          when={(playlistsData()?.total ?? 0) > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
              <div class="text-center max-w-md">
                <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                  no playlists in your library yet
                </p>
                <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                  playlists let you organize your music into custom collections
                </p>
                <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                  (playlist creation coming soon)
                </p>
              </div>
            </div>
          }
        >
          <div class="text-[var(--color-text-secondary)]">
            playlist grid coming soon
          </div>
        </Show>
      </div>
    </div>
  );
}
