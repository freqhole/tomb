import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  VirtualSongList,
  type SortDirection,
  type SortField,
} from "../src/components/virtualized/VirtualSongList";
import type { Song } from "../src/music/data/types";
import { generateBulkSongs } from "./mockData";

const meta = {
  title: "Components/Virtualized/VirtualSongList",
  component: VirtualSongList,
  tags: ["autodocs"],
  argTypes: {
    height: {
      control: "number",
      description: "height of the container in pixels",
    },
  },
} satisfies Meta<typeof VirtualSongList>;

export default meta;
type Story = StoryObj<typeof meta>;

// generate mock song data using shared data
const generateSongs = (count: number): Song[] => {
  return generateBulkSongs(count) as Song[];
};

// default view
export const Default: Story = {
  args: {
    songs: generateSongs(100),
    height: 600,
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
    const [playingSongId, setPlayingSongId] = createSignal<string | null>(null);
    const [actionLog, setActionLog] = createSignal<string[]>([]);

    const addLog = (message: string) => {
      setActionLog([...actionLog().slice(-9), message]);
    };

    const handleClick = (song: Song, index: number) => {
      addLog(`clicked: ${song.title} (${index + 1})`);
    };

    const handleDoubleClick = (song: Song, _index: number) => {
      setPlayingSongId(song.id);
      addLog(`playing: ${song.title}`);
    };

    const handleFavoriteToggle = (song: Song, isFavorite: boolean) => {
      setSongs(
        songs().map((s) =>
          s.id === song.id ? { ...s, is_favorite: isFavorite } : s,
        ),
      );
      addLog(`${isFavorite ? "favorited" : "unfavorited"}: ${song.title}`);
    };

    const handleRatingChange = (song: Song, rating: number) => {
      setSongs(
        songs().map((s) =>
          s.id === song.id ? { ...s, user_rating: rating } : s,
        ),
      );
      addLog(`rated ${song.title}: ${rating}/5`);
    };

    return (
      <div class="space-y-4">
        <div class="p-4 bg-dark-800 rounded space-y-2">
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

// empty list
export const EmptyList: Story = {
  args: {
    songs: [],
    height: 400,
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

// ============================================================================
// responsive layout stories
// ============================================================================

// narrow viewport - compact row mode
export const NarrowCompactRows: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => {
    const songs = generateSongs(50);
    const [playingSongId, setPlayingSongId] = createSignal<string | undefined>();

    return (
      <div class="w-[320px]">
        <div class="p-2 text-xs text-[var(--color-text-secondary)] mb-2">
          narrow viewport (320px) - compact 2-line row layout
        </div>
        <VirtualSongList
          songs={songs}
          height={500}
          playingSongId={playingSongId()}
          onSongDoubleClick={(song) => setPlayingSongId(song.sha256)}
        />
      </div>
    );
  },
};

// comparison: narrow vs wide
export const ResponsiveComparison: Story = {
  render: () => {
    const songs = generateSongs(30);

    return (
      <div class="space-y-8 p-4">
        <div>
          <h3 class="text-lg font-medium text-[var(--color-text-primary)] mb-2">
            narrow (320px) - compact rows
          </h3>
          <div class="w-[320px] bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden">
            <VirtualSongList songs={songs} height={400} />
          </div>
        </div>

        <div>
          <h3 class="text-lg font-medium text-[var(--color-text-primary)] mb-2">
            wide (900px) - table layout
          </h3>
          <div class="w-[900px] bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden">
            <VirtualSongList songs={songs} height={400} />
          </div>
        </div>
      </div>
    );
  },
};
