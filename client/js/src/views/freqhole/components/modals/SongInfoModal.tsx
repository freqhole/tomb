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
    "musicbrainz" | "edit" | "matches"
  >("edit");
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

      // switch to matches tab if we have matches
      if (allMatches.length > 0) {
        setActiveTab("matches");
      }
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
        limit: 25,
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

          {/* content */}
          <div class="space-y-6">
            {isBulkMode() ? (
              // bulk edit mode - uses schema-driven form
              <>
                <div class="text-sm text-gray-400">
                  editing {totalSongs()} songs
                </div>
                {isEditing() ? (
                  <SongBulkEditForm
                    songs={props.songs}
                    onFormChange={handleFormChange}
                  />
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
                    <Show when={currentSong()?.id} keyed>
                      <SongEditForm
                        song={currentSong()!}
                        songs={props.songs}
                        currentIndex={currentSongIndex()}
                        onFormChange={handleFormChange}
                        onSongChange={(index) => setCurrentSongIndex(index)}
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
