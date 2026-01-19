// albums view - displays all albums in a grid
import { useNavigate } from "@solidjs/router";
import { Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import { Button } from "../../components/buttons/Button";
import type { CollectionCardData } from "../../components/cards/CollectionCard";
import { VirtualAlbumGrid } from "../../components/virtualized/VirtualAlbumGrid";
import { getDataSource } from "../data";
import { useAlbumsQuery } from "../queries/songs";
import { playSong } from "../services/audio/player";
import { sortSongsCanonical } from "../utils/songSort";

export interface AlbumsViewProps {
  onAddMusic: () => void;
  onAlbumClick?: (albumId: string) => void;
}

export function AlbumsView(props: AlbumsViewProps) {
  const navigate = useNavigate();

  // fetch albums using query hook
  const albumsQuery = useAlbumsQuery(100);

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

  // flatten all pages into albums list
  const albums = (): CollectionCardData[] => {
    const pages = albumsQuery.data?.pages ?? [];
    const allAlbums = pages.flatMap((page) => page.items);

    // map AlbumSummary to CollectionCardData format
    return allAlbums.map((album) => ({
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

  // play album: load all songs and start playing
  const handleAlbumPlay = async (album: CollectionCardData) => {
    try {
      const dataSource = getDataSource();
      if (!dataSource.getAlbumSongs) {
        console.error("album songs not supported by current data source");
        return;
      }

      // load all songs for this album
      const response = await dataSource.getAlbumSongs(album.id, {
        limit: 1000,
      });
      const songs = response.items;

      if (songs.length === 0) return;

      // sort canonically (disc -> track)
      const sortedSongs = sortSongsCanonical(songs);

      // set queue and play first song
      await setQueue(sortedSongs);
      await playSong(sortedSongs[0].song_id);
    } catch (error) {
      console.error("failed to play album:", error);
    }
  };

  const handleAlbumClick = (album: CollectionCardData) => {
    navigate(`/albums/${album.id}`);
  };

  return (
    <div class="flex flex-col h-full">
      {/* header */}
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)] ml-[150px]">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            albums
          </h1>
          <p class="text-sm text-[var(--color-text-secondary)]">
            {albumsQuery.isLoading
              ? "loading..."
              : `${albums().length} ${albums().length === 1 ? "album" : "albums"}`}
          </p>
        </div>
        <Button variant="primary" onClick={props.onAddMusic}>
          add music
        </Button>
      </div>

      {/* album grid */}
      <div class="flex-1 overflow-hidden">
        <Show
          when={albums().length > 0 || albumsQuery.isLoading}
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
            onAlbumClick={handleAlbumClick}
            onAlbumPlay={handleAlbumPlay}
            showYear={true}
            cardSize="medium"
            height={undefined}
          />
        </Show>
      </div>
    </div>
  );
}
