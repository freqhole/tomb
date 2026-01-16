/* @jsxImportSource solid-js */
import { Show, createSignal } from "solid-js";
import type {
  TrendingSong,
  PopularSong,
} from "../../../lib/analytics/analytics-api.js";
import { formatDuration } from "../../../lib/analytics/analytics-api.js";
import { apiClient } from "../../../lib/api-client.js";
import type { Song } from "../../../lib/music/schemas/song.js";
import { useSongInteractions } from "../../freqhole/services/songInteractions.js";

interface SongRowProps {
  song: TrendingSong | PopularSong;
  rank?: number;
  showTrendInfo?: boolean;
  showPlayCount?: boolean;
  showCompletionRate?: boolean;
  showMomentum?: boolean;
}

/**
 * Song row component for analytics dashboard
 * Displays song information with analytics metrics and playback controls
 */
export function SongRow(props: SongRowProps) {
  const [isHovered, setIsHovered] = createSignal(false);
  const songInteractions = useSongInteractions();

  const getThumbnailUrl = (blobId: string | null) => {
    if (!blobId) return null;
    return `${apiClient.getBaseUrl()}/api/blobs/${blobId}`;
  };

  const formatArtistAlbum = (artist: string | null, album: string | null) => {
    if (artist && album) return `${artist} • ${album}`;
    if (artist) return artist;
    if (album) return album;
    return "unknown artist";
  };

  const getTrendIcon = (song: TrendingSong | PopularSong) => {
    if ("trend_score" in song) {
      if (song.trend_score > 2) return "🔥";
      if (song.trend_score > 1.5) return "📈";
      if (song.trend_score > 1) return "↗️";
    }
    return "";
  };

  // Convert analytics song to Song type for playback
  const convertToSong = (
    analyticsSong: TrendingSong | PopularSong
  ): Song | null => {
    if (!analyticsSong.song_id) return null;

    return {
      id: analyticsSong.song_id,
      media_blob_id: analyticsSong.media_blob_id,
      title: analyticsSong.title || "unknown title",
      artist: analyticsSong.artist || "unknown artist",
      album: analyticsSong.album || null,
      album_artist: analyticsSong.album_artist || null,
      track_number: analyticsSong.track_number || null,
      disc_number: analyticsSong.disc_number || null,
      duration_seconds: analyticsSong.duration_seconds,
      genre: analyticsSong.genre || null,
      year: analyticsSong.year || null,
      bpm: analyticsSong.bpm || null,
      key_signature: analyticsSong.key_signature || null,
      thumbnail_blob_id: analyticsSong.thumbnail_blob_id || null,
      waveform_blob_id: analyticsSong.waveform_blob_id || null,
      display_title: analyticsSong.title || "unknown title",
      detailed_display_title: analyticsSong.title || "unknown title",
      user_is_favorite: false,
      user_rating: null,
      tags: [],
      sub_genres: null,
      thumbnail_blob_ids: [],
      preference_updated_at: null,
      created_at: analyticsSong.song_created_at || new Date().toISOString(),
    };
  };

  const handleThumbnailClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const song = convertToSong(props.song);
    if (song) {
      songInteractions.playSong(song, true);
    }
  };

  const handleDoubleClick = () => {
    const song = convertToSong(props.song);
    if (song) {
      songInteractions.playSong(song, true);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const song = convertToSong(props.song);
    if (song) {
      songInteractions.handleRightClick(e, song);
    }
  };

  const handleMoreClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleContextMenu(e);
  };

  return (
    <div
      class="flex items-center py-2 px-3 bg-gray-800 hover:bg-gray-700 transition-colors cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDblClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Rank */}
      <Show when={props.rank !== undefined}>
        <span class="text-gray-400 text-sm font-mono w-6 flex-shrink-0">
          #{props.rank}
        </span>
      </Show>

      {/* Thumbnail with play overlay */}
      <div
        class="w-10 h-10 flex-shrink-0 bg-gray-700 relative cursor-pointer"
        onClick={handleThumbnailClick}
        title="play song"
      >
        <Show
          when={props.song.thumbnail_blob_id}
          fallback={
            <div class="w-full h-full bg-gray-600 flex items-center justify-center">
              <span class="text-gray-400 text-xs">♪</span>
            </div>
          }
        >
          <img
            src={getThumbnailUrl(props.song.thumbnail_blob_id)!}
            alt=""
            class="w-full h-full object-cover"
            loading="lazy"
          />
        </Show>
        {/* Play overlay on hover */}
        <Show when={isHovered()}>
          <div class="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span class="text-white text-sm">▶</span>
          </div>
        </Show>
      </div>

      {/* Song Info - expanded to use more space */}
      <div class="flex-1 min-w-0 mx-3">
        <div class="flex items-center space-x-2">
          <h3 class="text-white text-sm font-medium truncate">
            {props.song.title || "unknown title"}
          </h3>
          <Show when={"trend_score" in props.song && getTrendIcon(props.song)}>
            <span class="text-xs">{getTrendIcon(props.song)}</span>
          </Show>
        </div>
        <div class="flex items-center space-x-2 text-xs text-gray-400">
          <span class="truncate">
            {formatArtistAlbum(props.song.artist, props.song.album)}
          </span>
          <Show when={props.song.duration_seconds}>
            <span>•</span>
            <span>{formatDuration(props.song.duration_seconds!)}</span>
          </Show>
          <Show when={props.song.year}>
            <span>•</span>
            <span>{props.song.year}</span>
          </Show>
        </div>
      </div>

      {/* Analytics metrics - compact layout */}
      <div class="flex items-center space-x-4 text-sm mr-3">
        <Show when={props.showPlayCount && "play_count" in props.song}>
          <div class="text-center min-w-0">
            <div class="text-white font-medium text-xs">
              {(props.song as PopularSong).play_count}
            </div>
            <div class="text-gray-400 text-xs">plays</div>
          </div>
        </Show>

        <Show
          when={props.showTrendInfo && "current_period_plays" in props.song}
        >
          <div class="text-center min-w-0">
            <div class="text-white font-medium flex items-center space-x-1 text-xs">
              <span>{(props.song as TrendingSong).current_period_plays}</span>
              <span class="text-green-400">
                ↗{(props.song as TrendingSong).trend_score.toFixed(1)}x
              </span>
            </div>
            <div class="text-gray-400 text-xs">trending</div>
          </div>
        </Show>

        <div class="text-center min-w-0">
          <div class="text-white font-medium text-xs">
            {props.song.unique_users}
          </div>
          <div class="text-gray-400 text-xs">users</div>
        </div>

        <Show when={props.showCompletionRate}>
          <div class="text-center min-w-0">
            <div class="text-white font-medium text-xs">
              {Math.round(props.song.completion_rate * 100)}%
            </div>
            <div class="text-gray-400 text-xs">done</div>
          </div>
        </Show>

        <Show when={props.showMomentum && "momentum_score" in props.song}>
          <div class="text-center min-w-0">
            <div class="text-white font-medium text-xs">
              {(props.song as PopularSong).momentum_score.toFixed(1)}
            </div>
            <div class="text-gray-400 text-xs">momentum</div>
          </div>
        </Show>
      </div>

      {/* More options button - always visible */}
      <button
        onClick={handleMoreClick}
        class="w-6 h-6 bg-gray-600 hover:bg-gray-500 text-white flex items-center justify-center transition-colors flex-shrink-0"
        title="more options"
      >
        <span class="text-xs">⋯</span>
      </button>
    </div>
  );
}
