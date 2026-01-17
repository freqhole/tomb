import { createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { MenuAction } from "../src/components/overlays/ContextMenu";
import {
  QueueSidebar,
  type QueueSong,
} from "../src/components/player/QueueSidebar";
import { mockSongs } from "./mockData";

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

// map mock songs to queue format
const mockQueueSongs: QueueSong[] = mockSongs.slice(0, 8).map((song) => ({
  id: song.id,
  title: song.title,
  artist: song.artist,
  duration: song.durationSeconds,
  thumbnailUrl: song.thumbnailUrl,
}));

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
      song: QueueSong,
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
        onClick: () => console.log("view artist:", song.artist),
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
    const [songs, setSongs] = createSignal(mockSongs);
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
      song: QueueSong,
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
        onClick: () => console.log("view artist:", song.artist),
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
          songs={[mockSongs[0]]}
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
    const longQueue: QueueSong[] = Array.from({ length: 50 }, (_, i) => ({
      id: `song-${i}`,
      title: `song ${i + 1} with a really long title that should truncate properly`,
      artist: `artist ${i + 1}`,
      duration: 180 + Math.floor(Math.random() * 300),
      thumbnailUrl: i % 3 === 0 ? mockSongs[0].thumbnailUrl : undefined,
    }));

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
          currentIndex={mockSongs.length - 1}
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
            mockSongs[0], // with thumbnail
            mockSongs[1], // no thumbnail
            mockSongs[2], // with thumbnail
            mockSongs[4], // no thumbnail
            mockSongs[5], // with thumbnail
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
