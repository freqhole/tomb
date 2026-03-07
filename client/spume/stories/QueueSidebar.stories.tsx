import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { MenuAction } from "../src/components/overlays/ContextMenu";
import { QueueSidebar } from "../src/components/player/QueueSidebar";
import type { Song } from "../src/music/data/types";
import { generateBulkSongs } from "./mockData";

const meta = {
  title: "Components/Player/QueueSidebar",
  component: QueueSidebar,
  tags: ["autodocs"],
} satisfies Meta<typeof QueueSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// generate mock songs - long queue for realistic testing
const mockQueueSongs: Song[] = generateBulkSongs(50);

// single interactive story with all features
export const Interactive: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [songs, setSongs] = createSignal(mockQueueSongs);
    const [currentIndex, setCurrentIndex] = createSignal(3); // start with 4th song playing
    const [currentTime, setCurrentTime] = createSignal(45);
    const [isPlaying, setIsPlaying] = createSignal(true);

    // simulate which songs are "loading" (being preloaded)
    // in real app this would be songs within next ~30 min of queue
    const [loadingSongIds, setLoadingSongIds] = createSignal<Set<string>>(
      new Set(
        [
          mockQueueSongs[3]?.sha256, // currently playing
          mockQueueSongs[4]?.sha256, // next song
          mockQueueSongs[5]?.sha256, // preloading
        ].filter(Boolean) as string[]
      )
    );

    // toggle loading state for demo
    const toggleLoading = (sha256: string) => {
      const current = loadingSongIds();
      const next = new Set(current);
      if (next.has(sha256)) {
        next.delete(sha256);
      } else {
        next.add(sha256);
      }
      setLoadingSongIds(next);
    };

    const handleSongClick = (index: number) => {
      console.log("song clicked:", index);
      setCurrentIndex(index);
    };

    const handleSongDoubleClick = (index: number) => {
      console.log("song double-clicked (play):", index);
      setCurrentIndex(index);
      setCurrentTime(0);
    };

    const handleRemoveSong = (index: number) => {
      const currentSongs = songs();
      const newSongs = currentSongs.filter((_, i) => i !== index);
      setSongs(newSongs);

      if (currentIndex() >= index && currentIndex() > 0) {
        setCurrentIndex((prev) => prev - 1);
      }
    };

    const handleClearAll = () => {
      setSongs([]);
      setCurrentIndex(0);
    };

    const getContextMenuActions = (index: number, song: Song): MenuAction[] => [
      {
        label: "play now",
        icon: "play" as const,
        onClick: () => {
          setCurrentIndex(index);
          setCurrentTime(0);
        },
      },
      {
        type: "separator",
      },
      {
        label: "toggle loading state",
        icon: "refresh" as const,
        onClick: () => toggleLoading(song.sha256),
      },
      {
        type: "separator",
      },
      {
        label: "add to playlist",
        icon: "add" as const,
        onClick: () => console.log("add to playlist:", song.title),
      },
      {
        label: "view album",
        icon: "album" as const,
        onClick: () => console.log("view album for:", song.title),
      },
      {
        label: "view artist",
        icon: "artist" as const,
        onClick: () => console.log("view artist:", song.artist_name),
      },
      {
        type: "separator",
      },
      {
        label: "remove from queue",
        icon: "close" as const,
        onClick: () => handleRemoveSong(index),
        destructive: true,
      },
    ];

    // simulate playback progress
    const interval = setInterval(() => {
      if (isPlaying()) {
        setCurrentTime((t) => {
          const song = songs()[currentIndex()];
          const duration = song?.duration_seconds ?? 180;
          if (t >= duration) {
            // next song
            if (currentIndex() < songs().length - 1) {
              setCurrentIndex((i) => i + 1);
              return 0;
            }
            setIsPlaying(false);
            return duration;
          }
          return t + 1;
        });
      }
    }, 1000);
    void interval;

    const currentSong = () => songs()[currentIndex()];

    return (
      <div class="relative h-screen flex">
        {/* main content area */}
        <div class="flex-1 p-8 overflow-auto">
          <h2 class="text-xl font-semibold text-[var(--color-text-primary)] mb-4">
            queue sidebar demo
          </h2>

          <div class="flex gap-4 mb-6">
            <button
              onClick={() => setIsOpen(!isOpen())}
              class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
            >
              {isOpen() ? "close queue" : "open queue"}
            </button>

            <button
              onClick={() => setIsPlaying(!isPlaying())}
              class="px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] rounded transition-colors"
            >
              {isPlaying() ? "pause" : "play"}
            </button>
          </div>

          <div class="space-y-2 text-sm text-[var(--color-text-secondary)]">
            <p>
              <strong>currently playing:</strong> {currentSong()?.title ?? "none"} (track{" "}
              {currentIndex() + 1} of {songs().length})
            </p>
            <p>
              <strong>progress:</strong> {Math.floor(currentTime())}s /{" "}
              {currentSong()?.duration_seconds ?? 0}s
            </p>
            <p>
              <strong>loading songs:</strong> {loadingSongIds().size} songs
            </p>
          </div>

          <div class="mt-6 p-4 bg-[var(--color-bg-secondary)] rounded-lg">
            <h3 class="text-sm font-medium text-[var(--color-text-primary)] mb-2">
              loading state demo
            </h3>
            <p class="text-xs text-[var(--color-text-muted)] mb-3">
              right-click songs in queue to toggle loading state. loading songs show a spinning ring
              around the duration.
            </p>
            <div class="flex flex-wrap gap-2">
              {songs()
                .slice(currentIndex(), currentIndex() + 6)
                .map((song, i) => (
                  <button
                    onClick={() => toggleLoading(song.sha256)}
                    class={`px-2 py-1 text-xs rounded transition-colors ${
                      loadingSongIds().has(song.sha256)
                        ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                        : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {i === 0 ? "playing" : `+${i}`}:{" "}
                    {loadingSongIds().has(song.sha256) ? "loading" : "cached"}
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* queue sidebar */}
        <QueueSidebar
          historyEntries={[]}
          songs={songs()}
          currentIndex={currentIndex()}
          isOpen={isOpen()}
          variant="inline"
          onClose={() => setIsOpen(false)}
          onSongClick={handleSongClick}
          onSongDoubleClick={handleSongDoubleClick}
          onRemoveSong={handleRemoveSong}
          onClearAll={handleClearAll}
          getContextMenuActions={getContextMenuActions}
          currentTime={currentTime()}
          duration={currentSong()?.duration_seconds}
          loadingSongIds={loadingSongIds()}
        />
      </div>
    );
  },
};
