// albums view - displays all albums in a grid
import { createResource, Show } from "solid-js";
import { Button } from "../../components/buttons/Button";
import type { CollectionCardData } from "../../components/cards/CollectionCard";
import { VirtualAlbumGrid } from "../../components/virtualized/VirtualAlbumGrid";
import { getDataSource } from "../data";
import { songsVersion } from "../services/storage/db";

export interface AlbumsViewProps {
  onAddMusic: () => void;
  onAlbumClick?: (albumId: string) => void;
}

export function AlbumsView(props: AlbumsViewProps) {
  // fetch albums from data source - refetch when songsVersion changes
  const [albumsData] = createResource(songsVersion, async () => {
    const source = getDataSource();
    if (!source.getAlbums) {
      return { items: [], total: 0, offset: 0, limit: 50, has_more: false };
    }
    return source.getAlbums({ limit: 100 });
  });

  // format duration as mm:ss or hh:mm:ss
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const albums = (): CollectionCardData[] => {
    const data = albumsData();
    if (!data || !data.items.length) return [];

    // map AlbumSummary to CollectionCardData format
    return data.items.map((album) => ({
      id: album.album_id,
      title: album.title,
      subtitle: album.artist_name,
      domainType: "album" as const,
      artist: album.artist_name,
      year: album.year,
      trackCount: album.song_count,
      totalDuration: formatDuration(album.total_duration),
      imageUrl: null, // TODO: implement album artwork
    }));
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            albums
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {albumsData()?.total ?? 0}{" "}
            {albumsData()?.total === 1 ? "album" : "albums"}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* album grid */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={albums().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
              <div class="text-center max-w-md">
                <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                  no albums in your library yet
                </p>
                <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                  click "add music" above to import local audio files or
                  download from urls
                </p>
                <Button variant="primary" onClick={props.onAddMusic}>
                  add music
                </Button>
              </div>
            </div>
          }
        >
          <VirtualAlbumGrid
            albums={albums()}
            onAlbumClick={(album) => props.onAlbumClick?.(album.id)}
            showYear={true}
            cardSize="medium"
            height={undefined}
          />
        </Show>
      </div>
    </div>
  );
}
