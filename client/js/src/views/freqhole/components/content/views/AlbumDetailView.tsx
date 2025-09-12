import { Show, createResource, createEffect } from "solid-js";
import { useParams } from "@solidjs/router";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { storeActions } from "../../../store";
import type { RouteSectionProps } from "@solidjs/router";
import type { Album } from "../../../../../lib/music/schemas";
import { AlbumTrackList } from "./albums/AlbumTrackList";
import {
  getAlbumImageUrl,
  formatAlbumDuration,
  useAlbumPlayback,
  useAlbumNavigation,
  useAlbumLoader,
} from "./albums/albumUtils";

interface AlbumDetailViewProps {
  class?: string;
}

export function AlbumDetailView(
  props: RouteSectionProps<unknown> & AlbumDetailViewProps = {} as any
) {
  const params = useParams();
  const events = useGlobalEvents();

  // Get album info from params - handle both single and dual parameter routes
  const albumName = () => {
    // New format: /album/:artist/:album
    if (params.album) {
      return decodeURIComponent(params.album);
    }
    // Legacy format: /album/:id
    if (params.id) {
      return decodeURIComponent(params.id);
    }
    return null;
  };

  const artistName = () => {
    const name = params.artist;
    if (!name || name === "unknown-artist") return null;
    return decodeURIComponent(name);
  };

  // Shared utilities
  const { playAlbum, shuffleAlbum, addAlbumToQueue } = useAlbumPlayback();
  const { navigateToArtist } = useAlbumNavigation();
  const { loadingTracks, findAlbumByName, loadAlbumTracks } = useAlbumLoader();

  // Fetch album summary info
  const [albumSummaryResource] = createResource(
    () => ({ album: albumName(), artist: artistName() }),
    async (params) => {
      if (!params.album) return null;
      return await findAlbumByName(params.album, params.artist);
    }
  );

  // Fetch tracks for the album
  const [albumTracksResource] = createResource(
    () => albumSummaryResource(),
    async (album: Album | null) => {
      if (!album) return [];
      return await loadAlbumTracks(album);
    }
  );

  const handleBack = () => {
    window.location.hash = "#/albums";
  };

  const handleArtistClick = (artistName: string) => {
    navigateToArtist(artistName);
  };

  const handlePlayAll = () => {
    const tracks = albumTracksResource() || [];
    const album = albumSummaryResource();
    playAlbum(tracks, album?.album || undefined);
  };

  const handleShuffle = () => {
    const tracks = albumTracksResource() || [];
    const album = albumSummaryResource();
    shuffleAlbum(tracks, album?.album || undefined);
  };

  const handleAddToQueue = () => {
    const tracks = albumTracksResource() || [];
    addAlbumToQueue(tracks);
  };

  // Update store and emit events when album changes
  createEffect(() => {
    const album = albumSummaryResource();
    if (album) {
      storeActions.selectAlbum(album);
      events.emit("album:selected", { album });
    }
  });

  return (
    <div
      class={`flex flex-col h-full bg-black text-white w-full max-w-full ${props.class || ""}`}
    >
      <Show
        when={albumName()}
        fallback={
          <div class="flex-1 flex items-center justify-center">
            <div class="text-gray-400">No album selected</div>
          </div>
        }
      >
        {/* Sticky Header */}
        <div class="sticky top-0 z-10 bg-black/95 backdrop-blur-sm p-6 border-b border-magenta-800/30">
          <div class="flex items-center gap-3 mb-4">
            <button
              class="p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-magenta-600/20"
              onClick={handleBack}
              title="Back to albums"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div class="flex-1 min-w-0">
              <h1 class="text-3xl font-bold text-white truncate">
                {albumName()}
              </h1>
              <Show when={albumSummaryResource()?.artist}>
                <button
                  class="text-lg text-magenta-400 hover:text-magenta-300 transition-colors truncate block mt-1"
                  onClick={() =>
                    albumSummaryResource()?.artist &&
                    handleArtistClick(albumSummaryResource()!.artist!)
                  }
                  title="View artist"
                >
                  {albumSummaryResource()?.artist}
                </button>
              </Show>
            </div>
          </div>

          {/* Album Artwork and Info */}
          <Show when={albumSummaryResource()}>
            {(album) => (
              <div class="flex gap-6 mb-6">
                {/* Album Artwork */}
                <div class="w-32 h-32 bg-magenta-950/50 rounded-lg flex-shrink-0 overflow-hidden">
                  <Show
                    when={album().album_thumbnail_id}
                    fallback={
                      <div class="w-full h-full flex items-center justify-center text-magenta-400">
                        <svg
                          class="w-16 h-16"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                        </svg>
                      </div>
                    }
                  >
                    <img
                      src={getAlbumImageUrl(album().album_thumbnail_id)!}
                      alt={`${album().album} cover`}
                      class="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </Show>
                </div>

                {/* Album Stats */}
                <div class="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div class="bg-magenta-950/30 rounded-lg p-3">
                    <div class="text-magenta-300 text-sm mb-1">tracks</div>
                    <div class="text-white text-xl font-semibold">
                      {album().track_count || 0}
                    </div>
                  </div>
                  <div class="bg-magenta-950/30 rounded-lg p-3">
                    <div class="text-magenta-300 text-sm mb-1">duration</div>
                    <div class="text-white text-xl font-semibold">
                      {formatAlbumDuration(album().total_duration)}
                    </div>
                  </div>
                  <div class="bg-magenta-950/30 rounded-lg p-3">
                    <div class="text-magenta-300 text-sm mb-1">year</div>
                    <div class="text-white text-xl font-semibold">
                      {album().year || "—"}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Show>

          {/* Quick Actions */}
          <div class="flex flex-wrap gap-3">
            <button
              class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 border border-transparent hover:border-magenta-400 rounded text-black font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handlePlayAll}
              disabled={loadingTracks() || !albumTracksResource()?.length}
            >
              play all
            </button>
            <button
              class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleShuffle}
              disabled={loadingTracks() || !albumTracksResource()?.length}
            >
              shuffle
            </button>
            <button
              class="px-6 py-2 bg-magenta-950/50 hover:bg-magenta-600/30 border border-transparent hover:border-magenta-400 rounded text-white font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleAddToQueue}
              disabled={loadingTracks() || !albumTracksResource()?.length}
            >
              add to queue
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div class="flex-1 overflow-y-auto p-6">
          <AlbumTrackList
            tracks={albumTracksResource() || []}
            loading={loadingTracks()}
            selectedAlbumArtist={albumSummaryResource()?.artist}
            onArtistClick={handleArtistClick}
          />
        </div>
      </Show>
    </div>
  );
}
