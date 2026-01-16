import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  Song,
  SortDirection,
  SortField,
  VirtualSongList,
} from "../src/components/virtualized/VirtualSongList";

const meta = {
  title: "Components/Virtualized/VirtualSongList",
  component: VirtualSongList,
  tags: ["autodocs"],
  argTypes: {
    height: {
      control: "number",
      description: "height of the container in pixels",
    },
    variant: {
      control: "select",
      options: ["default", "playlist", "queue", "album", "artist"],
      description: "display variant for different contexts",
    },
    showTrackNumber: {
      control: "boolean",
      description: "show track numbers",
    },
    showFavorites: {
      control: "boolean",
      description: "show favorites column",
    },
    showRating: {
      control: "boolean",
      description: "show rating column",
    },
    showTags: {
      control: "boolean",
      description: "show tags column",
    },
  },
} satisfies Meta<typeof VirtualSongList>;

export default meta;
type Story = StoryObj<typeof meta>;

// generate mock song data
const generateSongs = (count: number): Song[] => {
  const artists = [
    "Pink Floyd",
    "Radiohead",
    "The Beatles",
    "Led Zeppelin",
    "King Crimson",
    "Tool",
    "Tame Impala",
    "Aphex Twin",
    "Godspeed You! Black Emperor",
    "Swans",
    "Talking Heads",
    "Black Midi",
  ];

  const albums = [
    "Dark Side of the Moon",
    "OK Computer",
    "Abbey Road",
    "Physical Graffiti",
    "In the Court of the Crimson King",
    "Lateralus",
    "Currents",
    "Selected Ambient Works",
    "Lift Your Skinny Fists",
    "The Seer",
    "Remain in Light",
    "Cavalcade",
  ];

  const tags = [
    ["progressive rock", "psychedelic"],
    ["alternative", "art rock"],
    ["classic rock", "british"],
    ["metal", "progressive"],
    ["electronic", "ambient"],
    ["indie", "experimental"],
    [],
  ];

  // generate songs grouped by album with proper disc/track numbers
  const songsPerAlbum = 12; // average tracks per album
  const results: Song[] = [];

  for (let i = 0; i < count; i++) {
    const albumIndex = Math.floor(i / songsPerAlbum);
    const trackInAlbum = i % songsPerAlbum;

    // some albums have 2 discs
    const hasMultipleDiscs = albumIndex % 3 === 0;
    const tracksPerDisc = hasMultipleDiscs ? 6 : songsPerAlbum;
    const discNumber = hasMultipleDiscs
      ? Math.floor(trackInAlbum / tracksPerDisc) + 1
      : 1;
    const trackNumber = hasMultipleDiscs
      ? (trackInAlbum % tracksPerDisc) + 1
      : trackInAlbum + 1;

    results.push({
      id: `song-${i}`,
      title: `${albums[albumIndex % albums.length]} - Track ${trackNumber}`,
      artist: artists[albumIndex % artists.length],
      album: albums[albumIndex % albums.length],
      duration: `${Math.floor(Math.random() * 5) + 2}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`,
      year: 1970 + Math.floor(Math.random() * 50),
      discNumber,
      trackNumber,
      userIsFavorite: Math.random() > 0.7,
      userRating:
        Math.random() > 0.5 ? Math.floor(Math.random() * 5) + 1 : null,
      tags: tags[albumIndex % tags.length],
    });
  }

  return results;
};

// default view - all columns
export const Default: Story = {
  args: {
    songs: generateSongs(100),
    height: 600,
    variant: "default",
  },
};

// album view - no album column, with track numbers
export const AlbumView: Story = {
  args: {
    songs: generateSongs(50),
    height: 600,
    variant: "album",
    showTrackNumber: true,
  },
};

// artist view - no artist column
export const ArtistView: Story = {
  args: {
    songs: generateSongs(80),
    height: 600,
    variant: "artist",
  },
};

// queue view - track numbers as queue position
export const QueueView: Story = {
  args: {
    songs: generateSongs(25),
    height: 600,
    variant: "queue",
    showTrackNumber: true,
  },
};

// playlist view
export const PlaylistView: Story = {
  args: {
    songs: generateSongs(60),
    height: 600,
    variant: "playlist",
  },
};

// with currently playing song
export const WithPlayingSong: Story = {
  args: {
    songs: generateSongs(200),
    height: 600,
    playingSongId: "song-50",
  },
};

// interactive with sorting
export const InteractiveSorting: Story = {
  render: () => {
    const songs = generateSongs(100);
    const [sortField, setSortField] = createSignal<SortField>("title");
    const [sortDirection, setSortDirection] =
      createSignal<SortDirection>("asc");

    const handleSortChange = (field: SortField, direction: SortDirection) => {
      setSortField(field);
      setSortDirection(direction);
    };

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded space-y-2">
          <div class="text-white text-sm">
            <span class="text-gray-400">sort by:</span>{" "}
            <span class="text-magenta-400">{sortField()}</span>{" "}
            <span class="text-gray-400">{sortDirection() || "default"}</span>
          </div>
          <div class="text-xs text-gray-500">
            click column headers to sort (cycles: asc → desc → default)
          </div>
        </div>

        <VirtualSongList
          songs={songs}
          height={600}
          sortState={{ field: sortField(), direction: sortDirection() }}
          onSortChange={handleSortChange}
        />
      </div>
    );
  },
};

// interactive with all actions
export const FullyInteractive: Story = {
  render: () => {
    const [songs, setSongs] = createSignal(generateSongs(200));
    const [selectedSongIds, setSelectedSongIds] = createSignal(
      new Set<string>(),
    );
    const [playingSongId, setPlayingSongId] = createSignal<string | null>(null);
    const [actionLog, setActionLog] = createSignal<string[]>([]);

    const addLog = (message: string) => {
      setActionLog([...actionLog().slice(-9), message]);
    };

    const handleClick = (song: Song, index: number) => {
      const newSelected = new Set(selectedSongIds());
      if (newSelected.has(song.id)) {
        newSelected.delete(song.id);
      } else {
        newSelected.add(song.id);
      }
      setSelectedSongIds(newSelected);
      addLog(`clicked: ${song.title} (${index + 1})`);
    };

    const handleDoubleClick = (song: Song) => {
      setPlayingSongId(song.id);
      addLog(`playing: ${song.title}`);
    };

    const handleFavoriteToggle = (song: Song, isFavorite: boolean) => {
      setSongs(
        songs().map((s) =>
          s.id === song.id ? { ...s, userIsFavorite: isFavorite } : s,
        ),
      );
      addLog(`${isFavorite ? "favorited" : "unfavorited"}: ${song.title}`);
    };

    const handleRatingChange = (song: Song, rating: number) => {
      setSongs(
        songs().map((s) =>
          s.id === song.id ? { ...s, userRating: rating } : s,
        ),
      );
      addLog(`rated ${song.title}: ${rating}/5`);
    };

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded space-y-2">
          <div class="text-white text-sm">
            <span class="text-gray-400">selected:</span>{" "}
            <span class="text-magenta-400">{selectedSongIds().size} songs</span>
          </div>
          <div class="text-white text-sm">
            <span class="text-gray-400">playing:</span>{" "}
            <span class="text-magenta-400">
              {playingSongId()
                ? songs().find((s) => s.id === playingSongId())?.title
                : "none"}
            </span>
          </div>
          <div class="text-xs text-gray-500">
            click to select, double-click to play, click hearts/stars to rate
          </div>
        </div>

        <VirtualSongList
          songs={songs()}
          height={500}
          playingSongId={playingSongId() || undefined}
          selectedSongIds={selectedSongIds()}
          onSongClick={handleClick}
          onSongDoubleClick={handleDoubleClick}
          onFavoriteToggle={handleFavoriteToggle}
          onRatingChange={handleRatingChange}
        />

        <div class="p-3 bg-dark-800 rounded text-xs text-gray-400 max-h-32 overflow-auto">
          <div class="font-medium mb-2">action log (last 10):</div>
          {actionLog().length === 0 ? (
            <div>no actions yet</div>
          ) : (
            <ul class="space-y-1">
              {actionLog()
                .reverse()
                .map((entry, i) => (
                  <li>
                    {i + 1}. {entry}
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    );
  },
};

// large list (1000 songs)
export const LargeList: Story = {
  args: {
    songs: generateSongs(1000),
    height: 600,
  },
};

// huge list (10,000 songs) - performance test
export const HugeList: Story = {
  args: {
    songs: generateSongs(10000),
    height: 600,
  },
};

// minimal columns (for narrow screens)
export const MinimalColumns: Story = {
  args: {
    songs: generateSongs(100),
    height: 600,
    showFavorites: false,
    showRating: false,
    showTags: false,
    showTrackNumber: false,
  },
};

// all favorites
export const AllFavorites: Story = {
  args: {
    songs: generateSongs(50).map((s) => ({ ...s, userIsFavorite: true })),
    height: 600,
  },
};

// all rated
export const AllRated: Story = {
  args: {
    songs: generateSongs(50).map((s) => ({
      ...s,
      userRating: Math.floor(Math.random() * 5) + 1,
    })),
    height: 600,
  },
};

// empty list
export const EmptyList: Story = {
  args: {
    songs: [],
    height: 400,
  },
};

// horizontal scrolling test (narrow container)
export const HorizontalScrolling: Story = {
  render: () => {
    const songs = generateSongs(50);

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded text-sm text-gray-400">
          narrow container (600px) - scroll horizontally to see all columns
        </div>
        <div style={{ width: "600px" }}>
          <VirtualSongList songs={songs} height={600} />
        </div>
      </div>
    );
  },
};

// performance test with rapid updates
export const PerformanceTest: Story = {
  render: () => {
    const [songs] = createSignal(generateSongs(5000));
    const [playingSongId, setPlayingSongId] = createSignal<string | null>(null);
    const [isPlaying, setIsPlaying] = createSignal(false);

    let intervalId: number | undefined;

    const startAutoPlay = () => {
      setIsPlaying(true);
      let currentIndex = 0;
      intervalId = window.setInterval(() => {
        currentIndex = (currentIndex + 1) % songs().length;
        setPlayingSongId(songs()[currentIndex].id);
      }, 300);
    };

    const stopAutoPlay = () => {
      setIsPlaying(false);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded space-y-2">
          <div class="text-white text-sm">
            5,000 songs - testing virtualization performance
          </div>
          <button
            onClick={() => (isPlaying() ? stopAutoPlay() : startAutoPlay())}
            class="px-4 py-2 bg-magenta-500 text-white rounded hover:bg-magenta-600 disabled:opacity-50"
          >
            {isPlaying()
              ? "stop auto-play"
              : "start auto-play (changes every 300ms)"}
          </button>
        </div>

        <VirtualSongList
          songs={songs()}
          height={600}
          playingSongId={playingSongId() || undefined}
        />
      </div>
    );
  },
};
