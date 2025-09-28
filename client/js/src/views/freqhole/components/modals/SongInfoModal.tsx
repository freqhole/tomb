import { createSignal, Show, onMount, createEffect, For } from "solid-js";
import { Modal } from "../ui/Modal";
import type { Song } from "../../../../lib/music/schemas/song";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useAuth } from "../../../../hooks/auth";
import { apiClient } from "../../../../lib/api-client";
import { SongMetadataView } from "../songs/SongMetadataView";
import { SongEditForm } from "../songs/SongEditForm";
import { SongBulkEditForm } from "../songs/SongBulkEditForm";
import type { EditableSongFields } from "../../../../lib/music/schemas/form-schemas";
import { FileUploadHandler } from "../../../../lib/file-upload";
import { useMusicBrainz } from "../../hooks/useMusicBrainz";
import type {
  MusicBrainzMatch,
  MusicBrainzSearchRequest,
  AlbumMatch,
  AlbumSearchRequest,
} from "../../../../lib/musicbrainz/api-methods";
import { MusicBrainzImagePreview } from "../musicbrainz/MusicBrainzImagePreview";
import { ImageCarousel } from "../songs/ImageCarousel";

interface SongInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  songs: Song[];
}

export function SongInfoModal(props: SongInfoModalProps) {
  const events = useGlobalEvents();
  const auth = useAuth();
  const [currentSongIndex, setCurrentSongIndex] = createSignal(0);
  const [isBulkMode, setIsBulkMode] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [formChanges, setFormChanges] = createSignal<
    Partial<EditableSongFields>
  >({});

  // Tab state and MusicBrainz functionality
  const [activeTab, setActiveTab] = createSignal<
    "metadata" | "images" | "matches" | "search"
  >("metadata");
  const [matches, setMatches] = createSignal<MusicBrainzMatch[]>([]);
  const [searchResults, setSearchResults] = createSignal<MusicBrainzMatch[]>(
    []
  );
  const [albumSearchResults, setAlbumSearchResults] = createSignal<
    AlbumMatch[]
  >([]);
  const [searchQuery, setSearchQuery] = createSignal<MusicBrainzSearchRequest>({
    limit: 50,
  });
  const [formKey, setFormKey] = createSignal(0);
  const [appliedImageUrl, setAppliedImageUrl] = createSignal<string | null>(
    null
  );

  // MusicBrainz hook with event integration
  const musicBrainz = useMusicBrainz({
    onError: (error) => {
      setError(error);
      events.emit("notification:show", {
        message: error,
        type: "error",
      });
    },
    onSuccess: (message) => {
      events.emit("notification:show", {
        message,
        type: "success",
      });
      events.emit("data:reload", { type: "songs" });
    },
  });

  const totalSongs = () => props.songs.length;
  const currentSong = () => props.songs[currentSongIndex()];
  const isEditing = () => auth.isAdmin;
  const hasChanges = () => Object.keys(formChanges()).length > 0;

  // initialize bulk mode for multi-song selections (admin only)
  onMount(() => {
    if (totalSongs() > 1 && auth.isAdmin) {
      setIsBulkMode(true);
    }
  });

  // reset when modal opens/closes or songs change
  createEffect(() => {
    if (props.isOpen && props.songs.length > 0) {
      setCurrentSongIndex(0);
      setError(null);
      setFormChanges({});
      if (totalSongs() > 1 && auth.isAdmin) {
        setIsBulkMode(true);
      } else {
        setIsBulkMode(false);
      }
    }
  });

  // navigation handlers
  const goToPrevious = () => {
    setCurrentSongIndex((prev) => (prev > 0 ? prev - 1 : totalSongs() - 1));
  };

  const goToNext = () => {
    setCurrentSongIndex((prev) => (prev < totalSongs() - 1 ? prev + 1 : 0));
  };

  // form change handler
  const handleFormChange = (changes: Partial<EditableSongFields>) => {
    setFormChanges(changes);
  };

  // schema-driven save handler
  const handleSave = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const changes = formChanges();
      if (Object.keys(changes).length === 0) {
        console.log("no changes to save");
        props.onClose();
        return;
      }

      const songIds = isBulkMode()
        ? props.songs.map((s) => s.id)
        : [currentSong()!.id];

      // Handle file uploads first
      let processedChanges = { ...changes };

      if (
        changes.thumbnail_blob_id &&
        typeof changes.thumbnail_blob_id === "object" &&
        "name" in changes.thumbnail_blob_id &&
        "size" in changes.thumbnail_blob_id
      ) {
        const fileUploader = new FileUploadHandler({
          baseUrl: apiClient.getBaseUrl(),
          minFileSize: 0,
          maxFileSize: 10 * 1024 * 1024, // 10MB
        });

        const uploadResult = await fileUploader.uploadMediaBlob(
          changes.thumbnail_blob_id as File,
          {
            type: "song-thumbnail",
            songIds: songIds,
          }
        );

        processedChanges.thumbnail_blob_id = uploadResult.id;
      }

      const promises = [];

      // schema-driven API calls - the methods automatically handle field categorization
      if (auth.isAdmin) {
        // metadata updates (handled automatically by schema-driven method)
        promises.push(
          apiClient
            .bulkUpdateSongsFromChanges({
              song_ids: songIds,
              updates: processedChanges,
            })

            .catch((err) => {
              // if no metadata fields, this is expected and ok
              if (err.message?.includes("no metadata updates")) {
                return null;
              }
              throw err;
            })
        );
      }

      // user preference updates (handled automatically by schema-driven method)
      promises.push(
        apiClient
          .bulkUpdateUserPreferencesFromChanges({
            song_ids: songIds,
            updates: processedChanges,
          })
          .catch((err) => {
            // if no user preference fields, this is expected and ok
            if (err.message?.includes("no user preference updates")) {
              return null;
            }
            throw err;
          })
      );

      const results = await Promise.all(promises);
      const validResults = results.filter(Boolean);

      if (validResults.length > 0) {
        // collect updated songs from all API responses
        const updatedSongs = validResults.flatMap((result) => {
          if (
            result &&
            typeof result === "object" &&
            "updated_songs" in result
          ) {
            return result.updated_songs;
          }
          return [];
        });

        if (updatedSongs.length > 0) {
          // emit targeted update with actual server response data
          events.emit("songs:updated", {
            songs: updatedSongs,
            operation: isBulkMode() ? "bulk-update" : "single-update",
          });
        } else {
          // fallback to full reload if no updated songs in response

          events.emit("data:reload", { type: "songs" });
        }
      }

      // success feedback
      const songCount = isBulkMode() ? totalSongs() : 1;
      events.emit("notification:show", {
        message: `updated ${songCount} song${songCount === 1 ? "" : "s"}`,
        type: "success",
      });

      // handle post-save navigation
      if (isBulkMode() || totalSongs() === 1) {
        // close modal for bulk mode or single song
        props.onClose();
      } else {
        // single edit mode with multiple songs - advance to next or close if last
        const isLastSong = currentSongIndex() >= totalSongs() - 1;
        if (isLastSong) {
          props.onClose();
        } else {
          goToNext();
        }
      }
    } catch (err) {
      console.error("failed to save song changes:", err);
      setError(err instanceof Error ? err.message : "failed to save changes");
    } finally {
      setIsLoading(false);
    }
  };

  // MusicBrainz helper functions
  const getSearchPreFillValues = (
    songs: Song[]
  ): Partial<MusicBrainzSearchRequest> => {
    if (songs.length === 0) return {};

    // for single song, use all values
    if (songs.length === 1) {
      const song = songs[0];
      return {
        title: song?.title || undefined,
        artist: song?.artist || undefined,
        album: song?.album || undefined,
      };
    }

    // for bulk mode, only use values that are consistent across all songs
    const firstSong = songs[0];
    if (!firstSong) return {};

    const titles = new Set(songs.map((s) => s.title));
    const artists = new Set(songs.map((s) => s.artist).filter(Boolean));
    const albums = new Set(songs.map((s) => s.album).filter(Boolean));

    return {
      // only pre-fill title if all songs have the same title (rare but possible)
      title: titles.size === 1 ? firstSong.title : undefined,
      // pre-fill artist if all songs have the same artist
      artist:
        artists.size === 1 ? Array.from(artists)[0] || undefined : undefined,
      // pre-fill album if all songs have the same album
      album: albums.size === 1 ? Array.from(albums)[0] || undefined : undefined,
    };
  };

  const loadMatches = async () => {
    if (!auth.isAdmin) return;

    try {
      setError(null);
      const songsToProcess = isBulkMode() ? props.songs : [currentSong()!];
      const songMatches = await musicBrainz.getMatches(songsToProcess);

      // extract all matches from all songs
      const allMatches = songMatches.flatMap(
        (songWithMatches) => songWithMatches.matches
      );
      setMatches(allMatches);

      // matches loaded - stay on current tab (don't auto-switch)
    } catch (err) {
      console.error("failed to load matches:", err);
      setError(err instanceof Error ? err.message : "failed to load matches");
    }
  };

  const searchMusicBrainz = async () => {
    try {
      setError(null);
      musicBrainz.clearError();

      const query = searchQuery();

      // Use album search if we have multiple songs selected
      if (totalSongs() > 1) {
        const albumQuery: AlbumSearchRequest = {
          artist: query.artist,
          album: query.album,
          limit: query.limit,
        };
        const albumResults = await musicBrainz.searchAlbums(albumQuery);
        setAlbumSearchResults(albumResults);
        setSearchResults([]); // Clear individual song results
      } else {
        const results = await musicBrainz.search(query);
        setSearchResults(results);
        setAlbumSearchResults([]); // Clear album results
      }
    } catch (err) {
      console.error("search failed:", err);
      setError(err instanceof Error ? err.message : "search failed");
      setSearchResults([]);
      setAlbumSearchResults([]);
    }
  };

  const matchToFormChanges = (
    match: MusicBrainzMatch
  ): Partial<EditableSongFields> => {
    const changes: Partial<EditableSongFields> = {
      artist: match.artist,
      album: match.album || undefined,
      year: match.year || undefined,
    };

    // only include genre if it has a value (skip for album matches in bulk mode)
    if (match.genre) {
      changes.genre = match.genre;
    }

    // only include title and track/disc numbers in single mode (not bulk mode)
    if (!isBulkMode()) {
      changes.title = match.title;
      changes.track_number = match.track_number || undefined;
      changes.disc_number = match.disc_number || undefined;
    }

    return changes;
  };

  const applyMatch = (match: MusicBrainzMatch) => {
    try {
      setError(null);

      // convert match data to form changes and switch to edit tab
      const changes = matchToFormChanges(match);
      setFormChanges(changes);
      setFormKey((prev) => prev + 1); // force form remount

      // store cover art url for image preview
      setAppliedImageUrl(match.cover_art_url ?? null);

      setActiveTab("metadata");

      // show success message
      events.emit("notification:show", {
        message: "match applied to form - review and save to apply changes",
        type: "success",
      });
    } catch (err) {
      console.error("failed to apply match:", err);
      setError(err instanceof Error ? err.message : "failed to apply metadata");
    }
  };

  const applyAlbumMatch = (album: AlbumMatch) => {
    // Convert album data to match format (album-level metadata only)
    const match: MusicBrainzMatch = {
      id: album.id,
      title: "", // Don't apply album title to songs
      artist: album.artist,
      album: album.title,
      year: album.year || null,
      track_number: null, // Don't apply track numbers from album search
      disc_number: null,
      duration_seconds: null,
      genre: null, // Don't override existing genre values for albums
      confidence: 100,
      mbid: album.mbid,
      recording_id: null,
      release_id: album.release_id,
      cover_art_url: null, // Albums don't include cover art URLs in current implementation
    };

    applyMatch(match);
  };

  // handle thumbnail click - switch to images tab and apply image
  const handleThumbnailClick = (coverArtUrl: string) => {
    setAppliedImageUrl(coverArtUrl);
    setActiveTab("images");
  };

  // handle image applied from musicbrainz
  const handleImageApplied = () => {
    // clear the applied image url since it's now been processed
    setAppliedImageUrl(null);

    // emit events to reload song data
    events.emit("data:reload", { type: "songs" });
    events.emit("notification:show", {
      message: "cover art applied and saved to songs",
      type: "success",
    });
  };

  // handle image reset
  const handleImageReset = () => {
    setAppliedImageUrl(null);

    // remove thumbnail from form changes if it was set
    const currentChanges = formChanges();
    const { thumbnail_blob_id, ...otherChanges } = currentChanges;
    setFormChanges(otherChanges);
  };

  // Initialize MusicBrainz data when modal opens
  createEffect(() => {
    if (props.isOpen && props.songs.length > 0) {
      // Reset MusicBrainz state
      setMatches([]);
      setSearchResults([]);
      setAlbumSearchResults([]);

      // Pre-fill search form with song data
      const preFillValues = getSearchPreFillValues(props.songs);
      setSearchQuery({
        limit: 50,
        ...preFillValues,
      });

      // Load matches if admin
      if (auth.isAdmin) {
        loadMatches();
      }
    }
  });

  // keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.isOpen || isEditing()) return;

    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        goToPrevious();
        break;
      case "ArrowRight":
        e.preventDefault();
        goToNext();
        break;
      case "Escape":
        e.preventDefault();
        props.onClose();
        break;
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  return (
    <Show when={props.isOpen}>
      <Modal
        isOpen={props.isOpen}
        onClose={() => props.onClose()}
        size="lg"
        showCloseButton={false}
      >
        <div class="space-y-6">
          {/* header */}
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold text-white">
              {isBulkMode() ? "bulk song info" : "song info"}
            </h2>
            <div class="flex items-center gap-2">
              {totalSongs() > 1 && auth.isAdmin && (
                <button
                  onClick={() => setIsBulkMode(!isBulkMode())}
                  class="px-3 py-1 text-sm bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                  disabled={isLoading()}
                >
                  {isBulkMode() ? "single edit" : "bulk edit"}
                </button>
              )}
              <button
                onClick={() => props.onClose()}
                class="text-gray-400 hover:text-white transition-colors"
                disabled={isLoading()}
              >
                ✕
              </button>
            </div>
          </div>

          {/* error display */}
          <Show when={error()}>
            <div class="p-4 bg-red-900/20 border border-red-600 text-red-200">
              {error()}
            </div>
          </Show>

          {/* persistent header info */}
          <div class="bg-gray-800/50 p-4 border border-gray-700 space-y-2">
            {isBulkMode() ? (
              <>
                <div class="text-sm text-gray-400">
                  editing {totalSongs()} songs
                </div>
                <div class="font-medium text-white">
                  bulk editing: {totalSongs()} songs
                </div>
                <div class="text-xs text-gray-400">
                  fields showing "mixed values" contain different values across
                  selected songs
                </div>
              </>
            ) : (
              <>
                <div class="text-sm text-gray-400">
                  editing: {currentSong()?.title} - {currentSong()?.artist}
                </div>
                <div class="text-sm text-gray-300">
                  {currentSong()?.artist}
                  {currentSong()?.album && (
                    <span class="ml-2">• {currentSong()?.album}</span>
                  )}
                  {currentSong()?.track_number && (
                    <span class="ml-2">({currentSong()?.track_number})</span>
                  )}
                  {currentSong()?.year && (
                    <span class="ml-2">• {currentSong()?.year}</span>
                  )}
                </div>
              </>
            )}

            {/* changes indicator */}
            {hasChanges() && (
              <div class="text-xs text-magenta-400 flex items-center gap-2">
                <div class="w-2 h-2 bg-magenta-500"></div>
                {Object.keys(formChanges()).length} field(s) will be updated
                {isBulkMode() ? ` across ${totalSongs()} songs` : ""}
              </div>
            )}
          </div>

          {/* pagination for single edit mode with multiple songs */}
          <Show when={!isBulkMode() && totalSongs() > 1 && isEditing()}>
            <div class="flex items-center justify-between bg-gray-800/30 p-3 border border-gray-700">
              <button
                onClick={goToPrevious}
                class="px-3 py-1 bg-gray-700 text-white hover:bg-gray-600 transition-colors disabled:opacity-50"
                disabled={isLoading()}
              >
                ← previous
              </button>
              <span class="text-sm text-gray-400">
                {currentSongIndex() + 1} of {totalSongs()}
              </span>
              <button
                onClick={goToNext}
                class="px-3 py-1 bg-gray-700 text-white hover:bg-gray-600 transition-colors disabled:opacity-50"
                disabled={isLoading()}
              >
                next →
              </button>
            </div>
          </Show>

          {/* tabs */}
          <Show when={isEditing()}>
            <div class="flex border-b border-gray-700">
              <button
                onClick={() => setActiveTab("metadata")}
                class={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab() === "metadata"
                    ? "text-magenta-400 border-b-2 border-magenta-400"
                    : "text-gray-400 hover:text-white"
                }`}
                disabled={isLoading()}
              >
                metadata
              </button>
              <button
                onClick={() => setActiveTab("images")}
                class={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab() === "images"
                    ? "text-magenta-400 border-b-2 border-magenta-400"
                    : "text-gray-400 hover:text-white"
                }`}
                disabled={isLoading()}
              >
                images
              </button>
              <Show when={matches().length > 0}>
                <button
                  onClick={() => setActiveTab("matches")}
                  class={`px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab() === "matches"
                      ? "text-magenta-400 border-b-2 border-magenta-400"
                      : "text-gray-400 hover:text-white"
                  }`}
                  disabled={isLoading()}
                >
                  musicbrainz matches ({matches().length})
                </button>
              </Show>
              <button
                onClick={() => setActiveTab("search")}
                class={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab() === "search"
                    ? "text-magenta-400 border-b-2 border-magenta-400"
                    : "text-gray-400 hover:text-white"
                }`}
                disabled={isLoading()}
              >
                search
              </button>
            </div>
          </Show>

          {/* content */}
          <div class="min-h-64">
            {/* matches tab */}
            <Show when={activeTab() === "matches" && isEditing()}>
              <div class="space-y-4 py-4">
                <Show when={matches().length === 0 && !isLoading()}>
                  <div class="text-center text-gray-400 py-8">
                    no musicbrainz matches found for selected songs
                  </div>
                </Show>

                <For each={matches()}>
                  {(match) => (
                    <div class="p-4 bg-gray-800/30 border border-gray-700 hover:border-gray-600 transition-colors">
                      <div class="flex items-start gap-3">
                        {/* thumbnail */}
                        <div class="w-16 h-16 bg-gray-700 border border-gray-600 rounded overflow-hidden flex-shrink-0 relative group">
                          <Show
                            when={match.cover_art_url}
                            fallback={
                              <div class="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                                no art
                              </div>
                            }
                          >
                            <button
                              onClick={() =>
                                handleThumbnailClick(match.cover_art_url!)
                              }
                              class="w-full h-full relative"
                            >
                              <img
                                src={match.cover_art_url!.replace(
                                  "front-500",
                                  "front-250"
                                )}
                                alt="cover art"
                                class="w-full h-full object-cover"
                                onError={(e) => {
                                  const target =
                                    e.currentTarget as HTMLImageElement;
                                  target.style.display = "none";
                                  target.parentElement!.innerHTML =
                                    '<div class="w-full h-full flex items-center justify-center text-gray-500 text-xs">404</div>';
                                }}
                              />
                              <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <span class="text-white text-xs font-medium">
                                  use this image
                                </span>
                              </div>
                            </button>
                          </Show>
                        </div>

                        <div class="flex-1 min-w-0">
                          <div class="font-medium text-white mb-1">
                            {match.title}
                            {match.track_number && (
                              <span class="text-gray-400 ml-2">
                                Track {match.track_number}
                                {match.disc_number &&
                                  match.disc_number > 1 &&
                                  ` • Disc ${match.disc_number}`}
                              </span>
                            )}
                          </div>
                          <div class="text-sm text-gray-400 mb-2">
                            {match.artist}
                            {match.album && (
                              <span class="ml-2">• {match.album}</span>
                            )}
                            {match.year && (
                              <span class="ml-2">• {match.year}</span>
                            )}
                            {match.genre && (
                              <span class="ml-2">• {match.genre}</span>
                            )}
                          </div>
                          <div class="text-xs text-gray-500">
                            Confidence: {match.confidence}%
                            {match.mbid && (
                              <span class="ml-2">
                                • MBID: {match.mbid.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => applyMatch(match)}
                          class="ml-4 px-3 py-1 bg-magenta-600 text-white text-sm hover:bg-magenta-700 transition-colors flex-shrink-0"
                          disabled={isLoading()}
                        >
                          apply
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* search tab */}
            <Show when={activeTab() === "search" && isEditing()}>
              <div class="space-y-4 py-4">
                {/* search context hint */}
                <div class="text-sm text-gray-400">
                  {totalSongs() > 1
                    ? "searching for albums (bulk mode)"
                    : "searching for individual songs"}
                </div>

                {/* search form */}
                <div class="space-y-4 p-4 bg-gray-800/30 border border-gray-700">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-300 mb-1">
                        artist
                      </label>
                      <input
                        type="text"
                        value={searchQuery().artist || ""}
                        onInput={(e) =>
                          setSearchQuery((prev) => ({
                            ...prev,
                            artist: e.target.value || undefined,
                          }))
                        }
                        class="w-full px-3 py-2 bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-magenta-500"
                        placeholder="artist name"
                      />
                    </div>

                    <div>
                      <label class="block text-sm font-medium text-gray-300 mb-1">
                        {totalSongs() > 1 ? "album" : "title"}
                      </label>
                      <input
                        type="text"
                        value={
                          totalSongs() > 1
                            ? searchQuery().album || ""
                            : searchQuery().title || ""
                        }
                        onInput={(e) =>
                          setSearchQuery((prev) => ({
                            ...prev,
                            ...(totalSongs() > 1
                              ? { album: e.target.value || undefined }
                              : { title: e.target.value || undefined }),
                          }))
                        }
                        class="w-full px-3 py-2 bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-magenta-500"
                        placeholder={
                          totalSongs() > 1 ? "album name" : "song title"
                        }
                      />
                    </div>

                    <Show when={totalSongs() === 1}>
                      <div>
                        <label class="block text-sm font-medium text-gray-300 mb-1">
                          album
                        </label>
                        <input
                          type="text"
                          value={searchQuery().album || ""}
                          onInput={(e) =>
                            setSearchQuery((prev) => ({
                              ...prev,
                              album: e.target.value || undefined,
                            }))
                          }
                          class="w-full px-3 py-2 bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-magenta-500"
                          placeholder="album name"
                        />
                      </div>
                    </Show>
                  </div>

                  <button
                    onClick={searchMusicBrainz}
                    class="w-full px-4 py-2 bg-magenta-600 text-white hover:bg-magenta-700 transition-colors disabled:opacity-50"
                    disabled={isLoading()}
                  >
                    {isLoading() ? "searching..." : "search"}
                  </button>
                </div>

                {/* search results */}
                <div class="space-y-2">
                  {/* album results for bulk mode */}
                  <Show when={albumSearchResults().length > 0}>
                    <div class="text-sm font-medium text-gray-300 mb-2">
                      album results ({albumSearchResults().length})
                    </div>
                    <For each={albumSearchResults()}>
                      {(album) => (
                        <div class="p-3 bg-gray-800/30 border border-gray-700 hover:border-gray-600 transition-colors">
                          <div class="flex items-start justify-between">
                            <div class="flex-1">
                              <div class="font-medium text-white">
                                {album.title}
                              </div>
                              <div class="text-sm text-gray-400">
                                {album.artist}
                                {album.year && (
                                  <span class="ml-2">• {album.year}</span>
                                )}
                                {album.track_count && (
                                  <span class="ml-2">
                                    • {album.track_count} tracks
                                  </span>
                                )}
                              </div>
                              <div class="text-xs text-gray-500 mt-1">
                                MBID: {album.mbid?.slice(0, 8)}...
                              </div>
                            </div>
                            <button
                              onClick={() => applyAlbumMatch(album)}
                              class="ml-4 px-3 py-1 bg-magenta-600 text-white text-sm hover:bg-magenta-700 transition-colors"
                              disabled={isLoading()}
                            >
                              apply album info
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>

                  {/* individual song results */}
                  <Show when={searchResults().length > 0}>
                    <div class="text-sm font-medium text-gray-300 mb-2">
                      song results ({searchResults().length})
                    </div>
                    <For each={searchResults()}>
                      {(result) => (
                        <div class="p-3 bg-gray-800/30 border border-gray-700 hover:border-gray-600 transition-colors">
                          <div class="flex items-start gap-3">
                            {/* thumbnail */}
                            <div class="w-12 h-12 bg-gray-700 border border-gray-600 rounded overflow-hidden flex-shrink-0 relative group">
                              <Show
                                when={result.cover_art_url}
                                fallback={
                                  <div class="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                                    no art
                                  </div>
                                }
                              >
                                <button
                                  onClick={() =>
                                    handleThumbnailClick(result.cover_art_url!)
                                  }
                                  class="w-full h-full relative"
                                >
                                  <img
                                    src={result.cover_art_url!.replace(
                                      "front-500",
                                      "front-250"
                                    )}
                                    alt="cover art"
                                    class="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target =
                                        e.currentTarget as HTMLImageElement;
                                      target.style.display = "none";
                                      target.parentElement!.innerHTML =
                                        '<div class="w-full h-full flex items-center justify-center text-gray-500 text-xs">404</div>';
                                    }}
                                  />
                                  <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <span class="text-white text-xs font-medium">
                                      use this image
                                    </span>
                                  </div>
                                </button>
                              </Show>
                            </div>

                            <div class="flex-1 min-w-0">
                              <div class="font-medium text-white">
                                {result.title}
                                {result.track_number && (
                                  <span class="text-gray-400 ml-2">
                                    Track {result.track_number}
                                    {result.disc_number &&
                                      result.disc_number > 1 &&
                                      ` • Disc ${result.disc_number}`}
                                  </span>
                                )}
                              </div>
                              <div class="text-sm text-gray-400">
                                {result.artist}
                                {result.album && (
                                  <span class="ml-2">• {result.album}</span>
                                )}
                                {result.year && (
                                  <span class="ml-2">• {result.year}</span>
                                )}
                              </div>
                              <div class="text-xs text-gray-500 mt-1">
                                Confidence: {result.confidence}%
                                {result.mbid && (
                                  <span class="ml-2">
                                    • MBID: {result.mbid.slice(0, 8)}...
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => applyMatch(result)}
                              class="ml-4 px-3 py-1 bg-magenta-600 text-white text-sm hover:bg-magenta-700 transition-colors flex-shrink-0"
                              disabled={isLoading()}
                            >
                              apply
                            </button>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>

                  <Show
                    when={
                      searchResults().length === 0 &&
                      albumSearchResults().length === 0 &&
                      !isLoading()
                    }
                  >
                    <div class="text-center text-gray-400 py-4">
                      no search results found
                    </div>
                  </Show>
                </div>
              </div>
            </Show>

            {/* images tab */}
            <Show when={activeTab() === "images"}>
              <div class="space-y-6 py-4">
                {/* musicbrainz image preview */}
                <Show when={appliedImageUrl()}>
                  <MusicBrainzImagePreview
                    coverArtUrl={appliedImageUrl()}
                    songs={props.songs}
                    onImageApplied={handleImageApplied}
                    onReset={handleImageReset}
                  />
                </Show>

                {/* current song images */}
                <ImageCarousel
                  songs={props.songs}
                  currentSongIndex={isBulkMode() ? 0 : currentSongIndex()}
                  isBulkMode={isBulkMode()}
                />
              </div>
            </Show>

            {/* metadata tab */}
            <Show when={activeTab() === "metadata" || !isEditing()}>
              <div class="space-y-6 py-4">
                {isBulkMode() ? (
                  // bulk edit mode - uses schema-driven form
                  <>
                    {isEditing() ? (
                      <Show when={formKey() >= 0} keyed>
                        <SongBulkEditForm
                          songs={props.songs}
                          onFormChange={handleFormChange}
                          initialChanges={formChanges()}
                          hideHeader={true}
                        />
                      </Show>
                    ) : (
                      <SongMetadataView
                        songs={props.songs}
                        currentSongIndex={0}
                        isBulkMode={true}
                      />
                    )}
                  </>
                ) : (
                  // single song mode
                  <>
                    {/* song content - uses schema-driven form */}
                    <Show when={currentSong()}>
                      {isEditing() ? (
                        <Show when={currentSong()?.id && formKey() >= 0} keyed>
                          <SongEditForm
                            song={currentSong()!}
                            songs={props.songs}
                            currentIndex={currentSongIndex()}
                            onFormChange={handleFormChange}
                            onSongChange={(index) => setCurrentSongIndex(index)}
                            initialChanges={formChanges()}
                            hideHeader={true}
                            hidePagination={true}
                          />
                        </Show>
                      ) : (
                        <SongMetadataView
                          songs={props.songs}
                          currentSongIndex={currentSongIndex()}
                          onSongChange={(index) => setCurrentSongIndex(index)}
                          isBulkMode={false}
                        />
                      )}
                    </Show>
                  </>
                )}
              </div>
            </Show>
          </div>

          {/* actions */}
          <div class="flex justify-end gap-3 pt-4 border-t border-gray-700">
            {/* cancel and save buttons - always shown when editing */}
            <Show when={isEditing()}>
              <button
                onClick={() => props.onClose()}
                class="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                disabled={isLoading()}
              >
                cancel
              </button>
              {/* save button for metadata tab */}
              <Show
                when={
                  (activeTab() === "metadata" || !isEditing()) && isEditing()
                }
              >
                <button
                  onClick={handleSave}
                  class="px-4 py-2 bg-magenta-600 text-white hover:bg-magenta-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isLoading() || !hasChanges()}
                >
                  {isLoading()
                    ? "saving..."
                    : !isBulkMode() &&
                        totalSongs() > 1 &&
                        currentSongIndex() < totalSongs() - 1
                      ? "save and next"
                      : "save"}
                </button>
              </Show>
            </Show>

            {/* close button for view-only mode */}
            <Show when={!isEditing()}>
              <button
                onClick={() => props.onClose()}
                class="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                close
              </button>
            </Show>
          </div>
        </div>
      </Modal>
    </Show>
  );
}
