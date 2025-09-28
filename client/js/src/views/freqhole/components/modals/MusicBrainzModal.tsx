import { createSignal, Show, onMount, createEffect, For } from "solid-js";
import { Modal } from "../ui/Modal";
import type { Song } from "../../../../lib/music/schemas/song";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useAuth } from "../../../../hooks/auth";
import { useMusicBrainz } from "../../hooks/useMusicBrainz";
import { SongEditForm } from "../songs/SongEditForm";
import { SongBulkEditForm } from "../songs/SongBulkEditForm";
import type { EditableSongFields } from "../../../../lib/music/schemas/form-schemas";
import type {
  MusicBrainzMatch,
  MusicBrainzSearchRequest,
  AlbumMatch,
  AlbumSearchRequest,
} from "../../../../lib/musicbrainz/api-methods";
import { apiClient } from "../../../../lib/api-client";

interface MusicBrainzModalProps {
  isOpen: boolean;
  onClose: () => void;
  songs: Song[];
}

export function MusicBrainzModal(props: MusicBrainzModalProps) {
  const events = useGlobalEvents();
  const auth = useAuth();

  // musicbrainz hook with event integration
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

  const [activeTab, setActiveTab] = createSignal<"matches" | "search" | "edit">(
    "matches"
  );
  const [currentSongIndex, setCurrentSongIndex] = createSignal(0);
  const [isBulkMode, setIsBulkMode] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [matches, setMatches] = createSignal<MusicBrainzMatch[]>([]);
  const [searchResults, setSearchResults] = createSignal<MusicBrainzMatch[]>(
    []
  );
  const [albumSearchResults, setAlbumSearchResults] = createSignal<
    AlbumMatch[]
  >([]);
  const [searchQuery, setSearchQuery] = createSignal<MusicBrainzSearchRequest>({
    limit: 25,
  });

  // helper function to get pre-fill values for search form
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
  const [formChanges, setFormChanges] = createSignal<
    Partial<EditableSongFields>
  >({});
  const [markAsReviewed, setMarkAsReviewed] = createSignal(false);

  const totalSongs = () => props.songs.length;
  const currentSong = () => props.songs[currentSongIndex()];
  const isEditing = () => auth.isAdmin;
  const hasChanges = () => Object.keys(formChanges()).length > 0;
  const isLoading = () => musicBrainz.isLoading();

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
      setMatches([]);
      setSearchResults([]);
      setAlbumSearchResults([]);

      // pre-fill search form with song data
      const preFillValues = getSearchPreFillValues(props.songs);
      setSearchQuery({
        limit: 25,
        ...preFillValues,
      });

      setMarkAsReviewed(false);

      if (totalSongs() > 1 && auth.isAdmin) {
        setIsBulkMode(true);
      } else {
        setIsBulkMode(false);
      }

      // load existing matches
      loadMatches();
    }
  });

  // load matches for current songs
  const loadMatches = async () => {
    try {
      setError(null);
      musicBrainz.clearError();

      const songsToProcess = isBulkMode() ? props.songs : [currentSong()!];
      const songMatches = await musicBrainz.getMatches(songsToProcess);

      // extract all matches from all songs
      const allMatches = songMatches.flatMap(
        (songWithMatches) => songWithMatches.matches
      );
      setMatches(allMatches);
    } catch (err) {
      console.error("failed to load musicbrainz matches:", err);
      setError(err instanceof Error ? err.message : "failed to load matches");
    }
  };

  // search musicbrainz - use album search for multiple songs
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

  // helper function to convert MusicBrainz match to editable form fields
  const matchToFormChanges = (
    match: MusicBrainzMatch
  ): Partial<EditableSongFields> => {
    const changes: Partial<EditableSongFields> = {
      artist: match.artist,
      album: match.album || undefined,
      year: match.year || undefined,
      genre: match.genre || undefined,
    };

    // only include title and track/disc numbers in single mode (not bulk mode)
    if (!isBulkMode()) {
      changes.title = match.title;
      changes.track_number = match.track_number || undefined;
      changes.disc_number = match.disc_number || undefined;
    }

    return changes;
  };

  // apply match to current song(s)
  const applyMatch = async (match: MusicBrainzMatch) => {
    try {
      setError(null);
      musicBrainz.clearError();

      const songsToProcess = isBulkMode() ? props.songs : [currentSong()!];
      const success = await musicBrainz.applyMatch(songsToProcess, match);

      if (success) {
        // convert match data to form changes and switch to edit tab
        const changes = matchToFormChanges(match);
        setFormChanges(changes);
        setActiveTab("edit");
      }
    } catch (err) {
      console.error("failed to apply match:", err);
      setError(err instanceof Error ? err.message : "failed to apply metadata");
    }
  };

  // apply album match (convert to MusicBrainzMatch format)
  const applyAlbumMatch = async (album: AlbumMatch) => {
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
      genre: null, // Albums don't have genre info in this context
      confidence: 100,
      mbid: album.mbid,
      recording_id: null,
      release_id: album.release_id,
    };

    await applyMatch(match);
  };

  // form change handler for edit tab
  const handleFormChange = (changes: Partial<EditableSongFields>) => {
    setFormChanges(changes);
  };

  // save changes from edit tab
  const handleSave = async () => {
    try {
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

      let updatedChanges = { ...changes };

      // add reviewed tag if requested
      if (markAsReviewed()) {
        // TODO: implement tag management
        // updatedChanges.tags = [...(existingTags || []), "reviewed"];
      }

      const promises = [];

      // metadata updates
      if (auth.isAdmin) {
        promises.push(
          apiClient
            .bulkUpdateSongsFromChanges({
              song_ids: songIds,
              updates: updatedChanges,
            })
            .catch((err: any) => {
              if (err.message?.includes("no metadata updates")) {
                return null;
              }
              throw err;
            })
        );
      }

      // user preference updates
      promises.push(
        apiClient
          .bulkUpdateUserPreferencesFromChanges({
            song_ids: songIds,
            updates: updatedChanges,
          })
          .catch((err: any) => {
            if (err.message?.includes("no user preference updates")) {
              return null;
            }
            throw err;
          })
      );

      const results = await Promise.all(promises);
      const validResults = results.filter(Boolean);

      if (validResults.length > 0) {
        const updatedSongs = validResults.flatMap((result: any) => {
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
          events.emit("songs:updated", {
            songs: updatedSongs,
            operation: isBulkMode() ? "bulk-update" : "single-update",
          });
        } else {
          events.emit("data:reload", { type: "songs" });
        }
      }

      const songCount = isBulkMode() ? totalSongs() : 1;
      events.emit("notification:show", {
        message: `updated ${songCount} song${songCount === 1 ? "" : "s"}`,
        type: "success",
      });

      props.onClose();
    } catch (err) {
      console.error("save failed:", err);
      setError(err instanceof Error ? err.message : "failed to save changes");
    }
  };

  // navigation for single song mode
  const goToPrevious = () => {
    if (currentSongIndex() > 0) {
      setCurrentSongIndex(currentSongIndex() - 1);
      loadMatches();
    }
  };

  const goToNext = () => {
    if (currentSongIndex() < totalSongs() - 1) {
      setCurrentSongIndex(currentSongIndex() + 1);
      loadMatches();
    }
  };

  return (
    <Show when={props.isOpen}>
      <Modal
        isOpen={props.isOpen}
        onClose={props.onClose}
        size="lg"
        showCloseButton={false}
      >
        <div class="space-y-6">
          {/* header */}
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold text-white">
              musicbrainz integration
            </h2>
            <div class="flex items-center gap-2">
              {totalSongs() > 1 && auth.isAdmin && (
                <button
                  onClick={() => setIsBulkMode(!isBulkMode())}
                  class="px-3 py-1 text-sm bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                  disabled={isLoading()}
                >
                  {isBulkMode() ? "single mode" : "bulk mode"}
                </button>
              )}
              <button
                onClick={props.onClose}
                class="text-gray-400 hover:text-white transition-colors"
                disabled={isLoading()}
              >
                ✕
              </button>
            </div>
          </div>

          {/* song info */}
          <div class="bg-gray-800/50 p-4 border border-gray-700">
            {isBulkMode() ? (
              <div class="text-sm text-gray-400">
                processing {totalSongs()} songs
              </div>
            ) : (
              <>
                <div class="font-medium text-white mb-1">
                  {currentSong()?.title || "untitled"}
                </div>
                <div class="text-sm text-gray-400">
                  {currentSong()?.artist && `${currentSong()?.artist} • `}
                  {currentSong()?.album || "no album"}
                  {currentSong()?.year && ` • ${currentSong()?.year}`}
                </div>
                {totalSongs() > 1 && (
                  <div class="flex items-center gap-4 mt-3">
                    <button
                      onClick={goToPrevious}
                      class="px-3 py-1 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
                      disabled={currentSongIndex() === 0 || isLoading()}
                    >
                      ← previous
                    </button>
                    <span class="text-sm text-gray-400">
                      {currentSongIndex() + 1} of {totalSongs()}
                    </span>
                    <button
                      onClick={goToNext}
                      class="px-3 py-1 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
                      disabled={
                        currentSongIndex() >= totalSongs() - 1 || isLoading()
                      }
                    >
                      next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* error display */}
          <Show when={error() || musicBrainz.error()}>
            <div class="p-4 bg-red-900/20 border border-red-600 text-red-200">
              {error() || musicBrainz.error()}
            </div>
          </Show>

          {/* tab bar */}
          <div class="flex border-b border-gray-700">
            <button
              onClick={() => setActiveTab("matches")}
              class={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab() === "matches"
                  ? "text-magenta-400 border-b-2 border-magenta-400"
                  : "text-gray-400 hover:text-white"
              }`}
              disabled={isLoading()}
            >
              available matches
            </button>
            <button
              onClick={() => setActiveTab("search")}
              class={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab() === "search"
                  ? "text-magenta-400 border-b-2 border-magenta-400"
                  : "text-gray-400 hover:text-white"
              }`}
              disabled={isLoading()}
            >
              search musicbrainz
            </button>
            {isEditing() && (
              <button
                onClick={() => setActiveTab("edit")}
                class={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab() === "edit"
                    ? "text-magenta-400 border-b-2 border-magenta-400"
                    : "text-gray-400 hover:text-white"
                }`}
                disabled={isLoading()}
              >
                edit metadata
              </button>
            )}
          </div>

          {/* tab content */}
          <div class="min-h-64">
            {/* matches tab */}
            <Show when={activeTab() === "matches"}>
              <div class="space-y-4">
                <Show when={matches().length === 0 && !isLoading()}>
                  <div class="text-center text-gray-400 py-8">
                    no musicbrainz matches found for selected songs
                  </div>
                </Show>

                <For each={matches()}>
                  {(match) => (
                    <div class="p-4 bg-gray-800/30 border border-gray-700 hover:border-gray-600 transition-colors">
                      <div class="flex items-start justify-between">
                        <div class="flex-1">
                          <div class="font-medium text-white mb-1">
                            {match.title}
                            {match.track_number && (
                              <span class="text-gray-400 ml-2">
                                Track {match.track_number}
                                {match.disc_number &&
                                  match.disc_number > 1 &&
                                  ` (Disc ${match.disc_number})`}
                              </span>
                            )}
                          </div>
                          <div class="text-sm text-gray-400">
                            {match.artist}
                            {match.album && ` • ${match.album}`}
                            {match.year && ` • ${match.year}`}
                          </div>
                          {(match.duration_seconds || match.genre) && (
                            <div class="text-xs text-gray-500 mt-1">
                              {match.duration_seconds && (
                                <span>
                                  {Math.floor(match.duration_seconds / 60)}:
                                  {(match.duration_seconds % 60)
                                    .toString()
                                    .padStart(2, "0")}
                                </span>
                              )}
                              {match.duration_seconds && match.genre && " • "}
                              {match.genre && <span>{match.genre}</span>}
                            </div>
                          )}
                          <div class="text-xs text-magenta-400 mt-2">
                            confidence: {Math.round(match.confidence)}%
                          </div>
                        </div>
                        <button
                          onClick={() => applyMatch(match)}
                          class="px-3 py-1 text-sm bg-magenta-600 text-white hover:bg-magenta-700 transition-colors"
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
            <Show when={activeTab() === "search"}>
              <div class="space-y-4">
                {/* search context hint */}
                <div class="text-sm text-gray-400 bg-gray-800/30 p-3 border border-gray-700">
                  {totalSongs() > 1 ? (
                    <span>
                      searching for albums (multiple songs selected) - results
                      will show album-level metadata
                    </span>
                  ) : (
                    <span>
                      searching for individual songs - results will show
                      track-level metadata
                    </span>
                  )}
                </div>

                {/* search form */}
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-300 mb-2">
                      title
                    </label>
                    <input
                      type="text"
                      value={searchQuery().title || ""}
                      onInput={(e) =>
                        setSearchQuery((prev) => ({
                          ...prev,
                          title: e.currentTarget.value,
                        }))
                      }
                      class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:border-magenta-400"
                      placeholder="song title"
                      disabled={isLoading()}
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-300 mb-2">
                      artist
                    </label>
                    <input
                      type="text"
                      value={searchQuery().artist || ""}
                      onInput={(e) =>
                        setSearchQuery((prev) => ({
                          ...prev,
                          artist: e.currentTarget.value,
                        }))
                      }
                      class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:border-magenta-400"
                      placeholder="artist name"
                      disabled={isLoading()}
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-300 mb-2">
                      album
                    </label>
                    <input
                      type="text"
                      value={searchQuery().album || ""}
                      onInput={(e) =>
                        setSearchQuery((prev) => ({
                          ...prev,
                          album: e.currentTarget.value,
                        }))
                      }
                      class="w-full px-3 py-2 bg-gray-800 border border-gray-600 text-white placeholder-gray-400 focus:border-magenta-400"
                      placeholder="album name"
                      disabled={isLoading()}
                    />
                  </div>
                </div>

                <button
                  onClick={searchMusicBrainz}
                  class="px-4 py-2 bg-magenta-600 text-white hover:bg-magenta-700 transition-colors disabled:opacity-50"
                  disabled={isLoading()}
                >
                  {isLoading() ? "searching..." : "search"}
                </button>

                {/* search results */}
                <Show
                  when={
                    (searchResults()?.length || 0) === 0 &&
                    (albumSearchResults()?.length || 0) === 0 &&
                    !isLoading()
                  }
                >
                  <div class="text-center text-gray-400 py-8">
                    enter search terms and click search
                  </div>
                </Show>

                {/* Individual song results (single song selected) */}
                <For each={searchResults()}>
                  {(result) => (
                    <div class="p-4 bg-gray-800/30 border border-gray-700 hover:border-gray-600 transition-colors">
                      <div class="flex items-start justify-between">
                        <div class="flex-1">
                          <div class="font-medium text-white mb-1">
                            {result.title}
                            {result.track_number && (
                              <span class="text-gray-400 ml-2">
                                Track {result.track_number}
                                {result.disc_number &&
                                  result.disc_number > 1 &&
                                  ` (Disc ${result.disc_number})`}
                              </span>
                            )}
                          </div>
                          <div class="text-sm text-gray-400">
                            {result.artist}
                            {result.album && ` • ${result.album}`}
                            {result.year && ` • ${result.year}`}
                          </div>
                          {(result.duration_seconds || result.genre) && (
                            <div class="text-xs text-gray-500 mt-1">
                              {result.duration_seconds && (
                                <span>
                                  {Math.floor(result.duration_seconds / 60)}:
                                  {(result.duration_seconds % 60)
                                    .toString()
                                    .padStart(2, "0")}
                                </span>
                              )}
                              {result.duration_seconds && result.genre && " • "}
                              {result.genre && <span>{result.genre}</span>}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => applyMatch(result)}
                          class="px-3 py-1 text-sm bg-magenta-600 text-white hover:bg-magenta-700 transition-colors"
                          disabled={isLoading()}
                        >
                          apply
                        </button>
                      </div>
                    </div>
                  )}
                </For>

                {/* Album results (multiple songs selected) */}
                <For each={albumSearchResults()}>
                  {(album) => (
                    <div class="p-4 bg-gray-800/30 border border-gray-700 hover:border-gray-600 transition-colors">
                      <div class="flex items-start justify-between">
                        <div class="flex-1">
                          <div class="font-medium text-white mb-1">
                            {album.title}
                          </div>
                          <div class="text-sm text-gray-400">
                            {album.artist}
                            {album.year && ` • ${album.year}`}
                            {album.track_count &&
                              ` • ${album.track_count} tracks`}
                          </div>
                        </div>
                        <button
                          onClick={() => applyAlbumMatch(album)}
                          class="px-3 py-1 text-sm bg-magenta-600 text-white hover:bg-magenta-700 transition-colors"
                          disabled={isLoading()}
                        >
                          apply album info
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* edit tab */}
            <Show when={activeTab() === "edit" && isEditing()}>
              <div class="space-y-4">
                {isBulkMode() ? (
                  <SongBulkEditForm
                    songs={props.songs}
                    onFormChange={handleFormChange}
                    initialChanges={formChanges()}
                  />
                ) : (
                  <Show when={currentSong()}>
                    <SongEditForm
                      song={currentSong()!}
                      songs={props.songs}
                      currentIndex={currentSongIndex()}
                      onFormChange={handleFormChange}
                      onSongChange={setCurrentSongIndex}
                      initialChanges={formChanges()}
                    />
                  </Show>
                )}

                {/* reviewed checkbox */}
                <div class="flex items-center gap-2 p-4 bg-gray-800/30 border border-gray-700">
                  <input
                    type="checkbox"
                    id="mark-reviewed"
                    checked={markAsReviewed()}
                    onChange={(e) => setMarkAsReviewed(e.currentTarget.checked)}
                    class="w-4 h-4 text-magenta-600 bg-gray-800 border-gray-600 focus:ring-magenta-500"
                  />
                  <label for="mark-reviewed" class="text-sm text-gray-300">
                    mark as reviewed
                  </label>
                </div>

                {/* musicbrainz config info */}
                <Show when={!musicBrainz.isEnabled()}>
                  <div class="p-4 bg-yellow-900/20 border border-yellow-600 text-yellow-200">
                    musicbrainz integration is not enabled
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          {/* actions */}
          <div class="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              onClick={props.onClose}
              class="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              disabled={isLoading()}
            >
              cancel
            </button>

            {/* save button for edit tab */}
            <Show when={activeTab() === "edit" && isEditing()}>
              <button
                onClick={handleSave}
                class="px-4 py-2 bg-magenta-600 text-white hover:bg-magenta-700 transition-colors disabled:opacity-50"
                disabled={isLoading() || !hasChanges()}
              >
                {isLoading() ? "saving..." : "save changes"}
              </button>
            </Show>
          </div>
        </div>
      </Modal>
    </Show>
  );
}
