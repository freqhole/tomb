// artists view - displays all artists in a two-column layout with A-Z navigation
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { playQueue, addToQueue } from "../services/audio/queue";
import { appState } from "../../app/services/storage/db";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { ArtistDetailPanel } from "../../components/artists/ArtistDetailPanel";
import { Button } from "../../components/buttons/Button";
import { formatNumber } from "../../components/cards/StatsCard";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import { AlphabetNav } from "../../components/navigation/AlphabetNav";
import { VirtualItemList, type ListItem } from "../../components/virtualized/VirtualItemList";
import { getDataSource } from "../data";
import { showArtistEditor, showImageCarousel } from "../modals";
import { useArtistSongsQuery, useArtistsQuery } from "../queries/songs";
import { useSetRatingMutation } from "../queries/ratings";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { useArtistContextMenu } from "../hooks/contextMenu";
import { buildRoute } from "../utils/routing";
import { getArtistAbbreviation } from "../utils/format";
import { warn } from "../../utils/logger";
import type { ImageMetadata } from "../services/storage/types";

// narrow breakpoint for responsive layout
const NARROW_BREAKPOINT = 768;

export interface ArtistsViewProps {
  onAddMusic: () => void;
  onArtistClick?: (artistId: string) => void;
}

const artistSortFields = [
  { value: "name", label: "name", description: "sort by artist name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  { value: "albumCount", label: "albums", description: "sort by album count" },
];

export function ArtistsView(props: ArtistsViewProps) {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();

  // restore selected artist from URL params or history state on mount
  const initialArtistId =
    params.id ||
    (typeof window !== "undefined"
      ? (window.history.state?.selectedArtistId as string | null)
      : null);

  // responsive: track narrow viewport
  const [isNarrow, setIsNarrow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false
  );
  // track whether detail is showing on narrow (for back navigation)
  // initialize to true if we have an initial ID and are on a narrow screen
  const [showingDetailOnNarrow, setShowingDetailOnNarrow] = createSignal(
    typeof window !== "undefined" && window.innerWidth < NARROW_BREAKPOINT && !!initialArtistId
  );

  const [selectedArtistId, setSelectedArtistId] = createSignal<string | null>(initialArtistId);
  const [sortBy, setSortBy] = createSignal("name");
  const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("asc");
  const [currentLetter, setCurrentLetter] = createSignal<string | null>(null);
  const [scrollToIndex, setScrollToIndex] = createSignal<((index: number) => void) | null>(null);
  const [isLocalClick, setIsLocalClick] = createSignal(false);

  // track query changes to force list reset
  const [isResetting, setIsResetting] = createSignal(false);

  onMount(() => {
    const handleResize = () => {
      const narrow = window.innerWidth < NARROW_BREAKPOINT;
      setIsNarrow(narrow);
      // reset detail view state when going from narrow to wide
      if (!narrow) {
        setShowingDetailOnNarrow(false);
      }
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearPageInfo(); // clear page info when leaving view
    });
  });

  // save selected artist to history state when it changes
  createEffect(() => {
    const artistId = selectedArtistId();
    if (artistId && typeof window !== "undefined") {
      const currentState = window.history.state || {};
      window.history.replaceState({ ...currentState, selectedArtistId: artistId }, "");
    }
  });

  // sync URL params with selected artist
  createEffect(() => {
    const urlArtistId = params.id;

    if (urlArtistId && urlArtistId !== selectedArtistId()) {
      setSelectedArtistId(urlArtistId);

      // only scroll if this is from navigation (back/forward/initial), not from clicking in the list
      const shouldScroll = !isLocalClick();
      if (shouldScroll && scrollToIndex()) {
        const artistIndex = sortedArtists().findIndex((a) => a.artist_id === urlArtistId);
        if (artistIndex >= 0) {
          scrollToIndex()!(artistIndex);
        }
      }

      // reset flag after capturing its value
      setIsLocalClick(false);
    }
  });

  // fetch artists using tanstack query (works with local + remote)
  const artistsQuery = useArtistsQuery({
    pageSize: 100,
    query: () => {
      const q = searchParams.q;
      return Array.isArray(q) ? q[0] : q;
    },
  });

  // rating mutation
  const setRatingMutation = useSetRatingMutation();

  // favorite mutation
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // reset virtual list when query param changes
  createEffect(() => {
    const q = searchParams.q;
    const queryParam = Array.isArray(q) ? q[0] : q;
    // briefly show resetting state to force list to remount
    setIsResetting(true);
    setTimeout(() => setIsResetting(false), 0);
  });

  // auto-fetch next page when query becomes idle and has more data
  createEffect(
    on(
      () => ({
        hasNextPage: artistsQuery.hasNextPage,
        isFetchingNextPage: artistsQuery.isFetchingNextPage,
        isFetching: artistsQuery.isFetching,
      }),
      (state) => {
        // automatically load more if there's more data and we're not already fetching
        if (state.hasNextPage && !state.isFetchingNextPage && !state.isFetching) {
          artistsQuery.fetchNextPage();
        }
      }
    )
  );

  // flatten all pages of artists
  const artistsData = createMemo(() => {
    const pages = artistsQuery.data?.pages ?? [];
    return pages.flatMap((page) => page.items);
  });

  // fetch songs for selected artist using tanstack query
  const artistSongsQuery = useArtistSongsQuery(() => selectedArtistId());

  // songs for detail panel - just pass through query results
  const artistSongs = createMemo(() => {
    const result = artistSongsQuery.data;
    if (!result || result.items.length === 0) return [];
    return result.items;
  });

  // sort artists
  const sortedArtists = createMemo(() => {
    const data = artistsData();
    if (!data || data.length === 0) return [];

    const sorted = [...data];
    const dir = sortDirection() === "asc" ? 1 : -1;
    const currentSortBy = sortBy();

    const compareArtists = (a: (typeof sorted)[0], b: (typeof sorted)[0]) => {
      switch (currentSortBy) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "songCount":
          return (a.song_count - b.song_count) * dir;
        case "albumCount":
          return (a.album_count - b.album_count) * dir;
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    };

    sorted.sort(compareArtists);

    return sorted;
  });

  // update page info for TopNav (mobile displays "artists (N)")
  createEffect(() => {
    const count = sortedArtists().length;
    setPageInfo({
      title: "artists",
      count,
      sortFields: artistSortFields,
      sortBy: sortBy(),
      sortDirection: sortDirection(),
      defaultSortBy: "name",
      defaultSortDirection: "asc",
      onSortChange: (field, direction) => {
        setSortBy(field);
        setSortDirection(direction);
      },
    });
  });

  // get selected artist data
  const selectedArtist = createMemo(() => {
    const id = selectedArtistId();
    if (!id) return null;
    return sortedArtists().find((a) => a.artist_id === id);
  });

  // convert to list items
  const artistListItems = createMemo((): ListItem[] => {
    return sortedArtists().map((artist) => ({
      id: artist.artist_id,
      title: artist.name,
      subtitle: `${formatNumber(artist.song_count)} songs · ${artist.album_count} albums`,
      images: artist.images,
      domainType: "artist" as const,
      fallbackText: getArtistAbbreviation(artist.name),
    }));
  });

  // calculate disabled letters for alphabet nav (only when sorted by name)
  const disabledLetters = createMemo(() => {
    if (sortBy() !== "name") return new Set<string>();

    const artists = sortedArtists();
    if (artists.length === 0) return new Set<string>();

    const disabledSet = new Set<string>();
    const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

    // build set of letters that DO have artists
    const enabledLetters = new Set<string>();
    artists.forEach((artist) => {
      const firstChar = artist.name[0]?.toUpperCase() || "";
      if (/[A-Z]/.test(firstChar)) {
        enabledLetters.add(firstChar);
      } else {
        enabledLetters.add("#");
      }
    });

    // disable letters that are NOT in the enabled set
    allLetters.forEach((letter) => {
      if (!enabledLetters.has(letter)) {
        disabledSet.add(letter);
      }
    });

    return disabledSet;
  });

  // calculate index for each letter (for A-Z navigation)
  const letterToIndexMap = createMemo(() => {
    if (sortBy() !== "name") return new Map<string, number>();

    const artists = sortedArtists();
    const map = new Map<string, number>();

    artists.forEach((artist, index) => {
      const firstChar = artist.name[0]?.toUpperCase() || "";
      const letter = /[A-Z]/.test(firstChar) ? firstChar : "#";

      // only store the first occurrence of each letter
      if (!map.has(letter)) {
        map.set(letter, index);
      }
    });

    return map;
  });

  // auto-select first artist when data loads
  createEffect(() => {
    const artists = sortedArtists();
    if (artists.length > 0 && !selectedArtistId()) {
      setSelectedArtistId(artists[0].artist_id);
    }
  });

  // shuffle array helper
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // play all songs for selected artist
  const handlePlayAll = async () => {
    const songs = artistSongs();
    if (!songs || songs.length === 0) return;

    await playQueue(songs);
  };

  // shuffle all songs for selected artist
  const handleShuffle = async () => {
    const songs = artistSongs();
    if (!songs || songs.length === 0) return;

    const shuffled = shuffleArray(songs);
    await playQueue(shuffled);
  };

  // add all songs to end of queue
  const handleAddToQueue = async () => {
    const songs = artistSongs();
    if (!songs || songs.length === 0) return;

    await addToQueue(songs);
  };

  // navigate to album detail
  const handleAlbumClick = (albumId: string) => {
    navigate(buildRoute(`/albums/${albumId}`));
  };

  // play specific album
  const handlePlayAlbum = async (albumId: string) => {
    const datasource = getDataSource();
    const result = await datasource.getAlbumSongs?.(albumId);
    if (!result || result.items.length === 0) return;

    await playQueue(result.items);
  };

  // add album to queue
  const handleAddAlbumToQueue = async (albumId: string) => {
    const datasource = getDataSource();
    const result = await datasource.getAlbumSongs?.(albumId);
    if (!result || result.items.length === 0) return;

    await addToQueue(result.items);
  };

  // play specific song
  const handleSongDoubleClick = async (songId: string, albumId: string) => {
    const datasource = getDataSource();
    const result = await datasource.getAlbumSongs?.(albumId);
    if (!result || result.items.length === 0) return;

    const clickedSong = result.items.find((s) => s.id === songId);
    if (!clickedSong) return;

    const startIndex = result.items.findIndex((s) => s.id === songId);
    await playQueue(result.items, { startIndex: Math.max(0, startIndex) });
  };

  // edit artist
  const handleEditArtist = () => {
    const artist = selectedArtist();
    if (artist) {
      showArtistEditor({ artistId: artist.artist_id });
    }
  };

  // handle rating change
  const handleRatingChange = (rating: number) => {
    const artist = selectedArtist();
    if (artist) {
      setRatingMutation.mutate({
        targetType: "artist",
        targetId: artist.artist_id,
        rating,
      });
    }
  };

  // handle song rating change
  const handleSongRatingChange = (songId: string, rating: number) => {
    setRatingMutation.mutate({
      targetType: "song",
      targetId: songId,
      rating,
    });
  };

  // handle album rating change
  const handleAlbumRatingChange = (albumId: string, rating: number) => {
    setRatingMutation.mutate({
      targetType: "album",
      targetId: albumId,
      rating,
    });
  };

  // handle album favorite toggle
  const handleAlbumFavoriteToggle = (albumId: string, isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "album",
      targetId: albumId,
      isFavorite,
    });
  };

  // handle artist favorite toggle
  const handleArtistFavoriteToggle = (isFavorite: boolean) => {
    const artist = selectedArtist();
    if (!artist) return;
    toggleFavoriteMutation.mutate({
      targetType: "artist",
      targetId: artist.artist_id,
      isFavorite,
    });
  };

  // handle song favorite toggle
  const handleSongFavoriteToggle = (songId: string, isFavorite: boolean) => {
    const song = artistSongs()?.find((s) => s.id === songId);
    toggleFavoriteMutation.mutate({
      targetType: "song",
      targetId: songId,
      sha256: song?.sha256,
      isFavorite,
    });
  };

  // show artist image carousel with all artist, album, and song images (no waveforms)
  const handleArtistImageClick = async () => {
    const artist = selectedArtist();
    if (!artist) return;

    const songs = artistSongs();
    const imageMap = new Map<string, string>();

    const addImage = (img: ImageMetadata) => {
      if (img.blob_type === "waveform") return;
      const url = img.remote_url || img.local_blob_id;
      if (!url) return;
      const key = img.remote_blob_id || img.local_blob_id || url;
      imageMap.set(key, url);
    };

    // artist images
    if (artist.images?.length) {
      for (const img of artist.images) addImage(img);
    }

    // song + album images from all songs
    for (const song of songs) {
      if (song.images?.length) {
        for (const img of song.images) addImage(img);
      }
      if (song.album_images?.length) {
        for (const img of song.album_images) addImage(img);
      }
    }
    const imageUrls = Array.from(imageMap.values());

    if (imageUrls.length === 0) {
      warn("no images found for artist");
      return;
    }

    showImageCarousel({
      images: imageUrls,
      title: `${artist.name} images`,
    });
  };

  // navigate to genre detail
  const handleGenreClick = (genreId: string, genreName: string) => {
    navigate(buildRoute(`/genres/${genreId}`));
  };

  // build context menu actions for each artist
  const getContextMenuActions = (item: ListItem, index: number) => {
    const artist = sortedArtists().find((a) => a.artist_id === item.id);
    if (!artist) return [];

    return useArtistContextMenu(
      {
        id: artist.artist_id,
        name: artist.name,
        song_count: artist.song_count,
        album_count: artist.album_count,
      },
      {
        isFavorite: artist.is_favorite ?? false,
        onPlayAll: async () => {
          // select this artist first
          setSelectedArtistId(artist.artist_id);
          // wait a tick for query to update
          await new Promise((resolve) => setTimeout(resolve, 50));
          // get songs via datasource (limited to 100)
          const datasource = getDataSource();
          const result = await datasource.getArtistSongs?.(artist.artist_id, { limit: 100 });
          if (!result || result.items.length === 0) return;
          await playQueue(result.items);
        },
        onShuffle: async () => {
          setSelectedArtistId(artist.artist_id);
          await new Promise((resolve) => setTimeout(resolve, 50));
          const datasource = getDataSource();
          const result = await datasource.getArtistSongs?.(artist.artist_id, { limit: 100 });
          if (!result || result.items.length === 0) return;
          const shuffled = shuffleArray(result.items);
          await playQueue(shuffled);
        },
        onAddToQueue: async () => {
          setSelectedArtistId(artist.artist_id);
          await new Promise((resolve) => setTimeout(resolve, 50));
          const datasource = getDataSource();
          const result = await datasource.getArtistSongs?.(artist.artist_id, { limit: 100 });
          if (!result || result.items.length === 0) return;
          await addToQueue(result.items);
        },
      }
    );
  };

  // handle back navigation on narrow
  const handleBack = () => {
    setShowingDetailOnNarrow(false);
  };

  // left column - artist list
  const leftColumn = (
    <>
      <div class="flex flex-col h-full">
        <div class="flex-1 overflow-hidden">
          <Show
            when={artistListItems().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center h-full gap-4 p-8">
                <div class="text-center max-w-md">
                  <p class="text-lg text-[var(--color-text-secondary)] mb-2">
                    no artists in your library yet
                  </p>
                  <p class="text-sm text-[var(--color-text-tertiary)] mb-6">
                    click "add music" above to import local audio files or download from urls
                  </p>
                  <Button variant="primary" onClick={props.onAddMusic}>
                    add music
                  </Button>
                </div>
              </div>
            }
          >
            <VirtualItemList
              items={artistListItems()}
              selectedId={selectedArtistId()}
              scrollPaddingTop={100}
              onItemClick={(item) => {
                setIsLocalClick(true);
                // show detail on narrow viewport
                if (isNarrow()) {
                  setShowingDetailOnNarrow(true);
                }
                navigate(buildRoute(`/artists/${item.id}`));
                props.onArtistClick?.(item.id);
              }}
              onVirtualizerReady={(scrollFn) => {
                setScrollToIndex(() => scrollFn);

                // only scroll if current artist matches the initial one (prevents scroll on subsequent clicks)
                const current = selectedArtistId();
                if (current && current === initialArtistId) {
                  const index = sortedArtists().findIndex((a) => a.artist_id === current);
                  if (index >= 0) {
                    setTimeout(() => scrollFn(index), 50);
                  }
                }
              }}
              getContextMenuActions={getContextMenuActions}
              height={window.innerHeight - ((appState()?.queue.length || 0) > 0 ? 80 : 0)}
            />
          </Show>
        </div>
      </div>
    </>
  );

  // right column - artist detail
  // use selectedArtist() for Show condition - it's falsy when no artist selected OR artist data not loaded
  const rightColumn = (
    <Show
      when={selectedArtist()}
      fallback={
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-[var(--color-text-tertiary)]">
            <svg class="w-24 h-24 mx-auto mb-4 opacity-30" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            <p class="text-xl mb-2">select an artist</p>
            <p class="text-sm text-[var(--color-text-tertiary)]">
              choose from the list to see details
            </p>
          </div>
        </div>
      }
    >
      {(artist) => (
        <ArtistDetailPanel
          artist={artist()}
          songs={artistSongs() || []}
          onPlayAll={handlePlayAll}
          onShuffle={handleShuffle}
          onAddToQueue={handleAddToQueue}
          onAlbumClick={handleAlbumClick}
          onPlayAlbum={handlePlayAlbum}
          onAddAlbumToQueue={handleAddAlbumToQueue}
          onSongDoubleClick={handleSongDoubleClick}
          getSongData={(songId) => {
            // find the full song data from artistSongs
            return artistSongs().find((s) => s.id === songId);
          }}
          onEditArtist={handleEditArtist}
          onRatingChange={handleRatingChange}
          onSongRatingChange={handleSongRatingChange}
          onAlbumRatingChange={handleAlbumRatingChange}
          onFavoriteToggle={handleArtistFavoriteToggle}
          onAlbumFavoriteToggle={handleAlbumFavoriteToggle}
          onSongFavoriteToggle={handleSongFavoriteToggle}
          onImageClick={handleArtistImageClick}
          onGenreClick={handleGenreClick}
          showBackButton={isNarrow() && showingDetailOnNarrow()}
          onBack={handleBack}
        />
      )}
    </Show>
  );

  // alphabet navigation (only shown when sorted by name)
  const alphabetNav = () =>
    sortBy() === "name" ? (
      <AlphabetNav
        currentLetter={currentLetter()}
        disabledLetters={disabledLetters()}
        onLetterClick={(letter) => {
          setCurrentLetter(letter);
          const index = letterToIndexMap().get(letter);
          if (index !== undefined) {
            const scroll = scrollToIndex();
            if (scroll) {
              scroll(index);
            }
          }
        }}
        sortDirection={sortDirection()}
      />
    ) : null;

  return (
    <div class="flex flex-col h-full">
      {/* two-column layout - full height, handles its own scrolling */}
      <div class="flex-1 overflow-hidden">
        {isResetting() ? (
          <div class="flex items-center justify-center h-full">
            <div class="text-[var(--color-text-secondary)]">loading...</div>
          </div>
        ) : (
          <TwoColumnLayout
            leftColumn={leftColumn}
            rightColumn={rightColumn}
            alphabetNav={alphabetNav()}
            showDetail={showingDetailOnNarrow()}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
