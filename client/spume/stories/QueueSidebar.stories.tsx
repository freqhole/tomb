import { createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { MenuAction } from "../src/components/overlays/ContextMenu";
import { QueueSidebar } from "../src/components/player/QueueSidebar";
import type { Song } from "../src/music/data/types";
import { generateBulkSongs } from "./mockData";

const meta = {
  title: "Components/Player/QueueSidebar",
  component: QueueSidebar,
  tags: ["autodocs"],
  argTypes: {
    isOpen: {
      control: "boolean",
      description: "whether sidebar is open",
    },
  },
} satisfies Meta<typeof QueueSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

// generate mock songs using domain type
const mockQueueSongs: Song[] = generateBulkSongs(8);

// interactive example
export const Interactive: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [songs, setSongs] = createSignal(mockQueueSongs);
    const [currentIndex, setCurrentIndex] = createSignal(0);

    const handleSongClick = (index: number) => {
      console.log("song clicked:", index);
      setCurrentIndex(index);
    };

    const handleSongDoubleClick = (index: number) => {
      console.log("song double-clicked (play):", index);
      setCurrentIndex(index);
    };

    const handleRemoveSong = (index: number) => {
      const currentSongs = songs();
      console.log("handleRemoveSong called with index:", index);
      console.log(
        "current songs:",
        currentSongs.map((s, i) => `${i}: ${s.title}`),
      );
      console.log("removing song at index:", index, currentSongs[index]?.title);

      const newSongs = currentSongs.filter((_, i) => i !== index);
      console.log(
        "new songs after remove:",
        newSongs.map((s, i) => `${i}: ${s.title}`),
      );
      setSongs(newSongs);

      if (currentIndex() >= index && currentIndex() > 0) {
        setCurrentIndex((prev) => prev - 1);
      }
    };

    const handleClearAll = () => {
      console.log("clear all");
      setSongs([]);
      setCurrentIndex(0);
    };

    const getContextMenuActions = (
      index: number,
      song: Song,
    ): MenuAction[] => [
      {
        label: "play now",
        icon: "play" as const,
        onClick: () => {
          console.log("play song:", index, song.title);
          setCurrentIndex(index);
        },
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

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
          <p class="mt-4 text-[var(--color-text-secondary)] text-sm">
            currently playing: track {currentIndex() + 1}
          </p>
        </div>

        <QueueSidebar
          songs={songs()}
          currentIndex={currentIndex()}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={handleSongClick}
          onSongDoubleClick={handleSongDoubleClick}
          onRemoveSong={handleRemoveSong}
          onClearAll={handleClearAll}
          getContextMenuActions={getContextMenuActions}
        />
      </div>
    );
  },
};

// open with songs
export const Open: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [songs, setSongs] = createSignal(mockQueueSongs);
    const [currentIndex, setCurrentIndex] = createSignal(2);

    const handleSongClick = (index: number) => {
      console.log("song clicked:", index);
      setCurrentIndex(index);
    };

    const handleSongDoubleClick = (index: number) => {
      console.log("song double-clicked (play):", index);
      setCurrentIndex(index);
    };

    const handleRemoveSong = (index: number) => {
      const currentSongs = songs();
      console.log("handleRemoveSong called with index:", index);
      console.log(
        "current songs:",
        currentSongs.map((s, i) => `${i}: ${s.title}`),
      );
      console.log("removing song at index:", index, currentSongs[index]?.title);

      const newSongs = currentSongs.filter((_, i) => i !== index);
      console.log(
        "new songs after remove:",
        newSongs.map((s, i) => `${i}: ${s.title}`),
      );
      setSongs(newSongs);

      if (currentIndex() >= index && currentIndex() > 0) {
        setCurrentIndex((prev) => prev - 1);
      }
    };

    const handleClearAll = () => {
      console.log("clear all");
      setSongs([]);
      setCurrentIndex(0);
    };

    const getContextMenuActions = (
      index: number,
      song: Song,
    ): MenuAction[] => [
      {
        label: "play now",
        icon: "play" as const,
        onClick: () => {
          console.log("play song:", index, song.title);
          setCurrentIndex(index);
        },
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

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
          <p class="mt-4 text-[var(--color-text-secondary)] text-sm">
            currently playing: track {currentIndex() + 1}
          </p>
        </div>
        <QueueSidebar
          songs={songs()}
          currentIndex={currentIndex()}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={handleSongClick}
          onSongDoubleClick={handleSongDoubleClick}
          onRemoveSong={handleRemoveSong}
          onClearAll={handleClearAll}
          getContextMenuActions={getContextMenuActions}
        />
      </div>
    );
  },
};

// closed
export const Closed: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>
        <QueueSidebar
          songs={mockQueueSongs}
          currentIndex={0}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// empty queue
export const EmptyQueue: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>
        <QueueSidebar
          songs={[]}
          currentIndex={0}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// single song
export const SingleSong: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>
        <QueueSidebar
          songs={[mockQueueSongs[0]]}
          currentIndex={0}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// long queue
export const LongQueue: Story = {
  render: () => {
    const longQueue: Song[] = generateBulkSongs(50);

    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>
        <QueueSidebar
          songs={longQueue}
          currentIndex={10}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// playing first song
export const PlayingFirstSong: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>
        <QueueSidebar
          songs={mockQueueSongs}
          currentIndex={0}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// playing last song
export const PlayingLastSong: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>
        <QueueSidebar
          songs={mockQueueSongs}
          currentIndex={mockQueueSongs.length - 1}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// mixed thumbnails
export const MixedThumbnails: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="relative h-screen">
        <div class="p-8">
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>
        <QueueSidebar
          songs={[
            mockQueueSongs[0], // with thumbnail
            mockQueueSongs[1], // no thumbnail
            mockQueueSongs[2], // with thumbnail
            mockQueueSongs[4], // no thumbnail
            mockQueueSongs[5], // with thumbnail
          ]}
          currentIndex={2}
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// ============================================================================
// responsive / narrow viewport stories - bottom sheet behavior
// ============================================================================

// narrow viewport - bottom sheet open
export const NarrowBottomSheetOpen: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [songs, setSongs] = createSignal(mockQueueSongs);
    const [currentIndex, setCurrentIndex] = createSignal(2);

    const handleRemoveSong = (index: number) => {
      setSongs(songs().filter((_, i) => i !== index));
      if (currentIndex() >= index && currentIndex() > 0) {
        setCurrentIndex((prev) => prev - 1);
      }
    };

    return (
      <div class="relative h-screen w-[320px] bg-[var(--color-bg-primary)]">
        <div class="p-4">
          <h2 class="text-lg font-medium text-[var(--color-text-primary)] mb-4">
            narrow viewport (320px)
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)] mb-4">
            queue appears as bottom sheet
          </p>
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors w-full"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>

        <QueueSidebar
          songs={songs()}
          currentIndex={currentIndex()}
          isOpen={isOpen()}
          variant="overlay"
          onClose={() => setIsOpen(false)}
          onSongClick={(index) => setCurrentIndex(index)}
          onSongDoubleClick={(index) => setCurrentIndex(index)}
          onRemoveSong={handleRemoveSong}
          onClearAll={() => {
            setSongs([]);
            setCurrentIndex(0);
          }}
        />
      </div>
    );
  },
};

// narrow viewport - bottom sheet closed
export const NarrowBottomSheetClosed: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div class="relative h-screen w-[320px] bg-[var(--color-bg-primary)]">
        <div class="p-4">
          <h2 class="text-lg font-medium text-[var(--color-text-primary)] mb-4">
            narrow viewport (320px) - closed
          </h2>
          <p class="text-sm text-[var(--color-text-secondary)] mb-4">
            tap button to see bottom sheet slide up
          </p>
          <button
            onClick={() => setIsOpen(!isOpen())}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors w-full"
          >
            {isOpen() ? "close queue" : "open queue"}
          </button>
        </div>

        <QueueSidebar
          songs={mockQueueSongs}
          currentIndex={0}
          isOpen={isOpen()}
          variant="overlay"
          onClose={() => setIsOpen(false)}
          onSongClick={(i) => console.log("clicked:", i)}
          onRemoveSong={(i) => console.log("remove:", i)}
          onClearAll={() => console.log("clear all")}
        />
      </div>
    );
  },
};

// comparison: narrow vs wide
export const ResponsiveComparison: Story = {
  render: () => {
    const [narrowOpen, setNarrowOpen] = createSignal(true);
    const [wideOpen, setWideOpen] = createSignal(true);

    return (
      <div class="flex gap-8 p-4">
        {/* narrow - bottom sheet */}
        <div>
          <h3 class="text-lg font-medium text-[var(--color-text-primary)] mb-2">
            narrow (bottom sheet)
          </h3>
          <div class="relative h-[500px] w-[320px] bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden">
            <div class="p-4">
              <button
                onClick={() => setNarrowOpen(!narrowOpen())}
                class="px-3 py-1.5 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded text-sm"
              >
                {narrowOpen() ? "close" : "open"}
              </button>
            </div>
            <QueueSidebar
              songs={mockQueueSongs.slice(0, 5)}
              currentIndex={1}
              isOpen={narrowOpen()}
              variant="overlay"
              onClose={() => setNarrowOpen(false)}
              onSongClick={(i) => console.log("clicked:", i)}
              onRemoveSong={(i) => console.log("remove:", i)}
              onClearAll={() => console.log("clear all")}
            />
          </div>
        </div>

        {/* wide - sidebar */}
        <div>
          <h3 class="text-lg font-medium text-[var(--color-text-primary)] mb-2">
            wide (sidebar)
          </h3>
          <div class="relative h-[500px] w-[500px] bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden flex">
            <div class="flex-1 p-4">
              <button
                onClick={() => setWideOpen(!wideOpen())}
                class="px-3 py-1.5 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded text-sm"
              >
                {wideOpen() ? "close" : "open"}
              </button>
            </div>
            <QueueSidebar
              songs={mockQueueSongs.slice(0, 5)}
              currentIndex={1}
              isOpen={wideOpen()}
              variant="inline"
              onClose={() => setWideOpen(false)}
              onSongClick={(i) => console.log("clicked:", i)}
              onRemoveSong={(i) => console.log("remove:", i)}
              onClearAll={() => console.log("clear all")}
            />
          </div>
        </div>
      </div>
    );
  },
};
