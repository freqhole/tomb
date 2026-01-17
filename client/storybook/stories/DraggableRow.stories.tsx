import { createSignal, For, type JSX } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconButton } from "../src/components/buttons/IconButton";
import {
  DraggableRow,
  DraggableRowSongContent,
} from "../src/components/lists/DraggableRow";

const meta = {
  title: "Components/Lists/DraggableRow",
  component: DraggableRow,
  tags: ["autodocs"],
  argTypes: {
    isDragging: {
      control: "boolean",
      description: "whether row is currently being dragged",
    },
    isDropTarget: {
      control: "boolean",
      description: "whether row is the current drop target",
    },
    isSelected: {
      control: "boolean",
      description: "whether row is selected",
    },
    disabled: {
      control: "boolean",
      description: "whether dragging is disabled",
    },
    showDragHandle: {
      control: "boolean",
      description: "whether to show drag handle instead of index",
    },
  },
} satisfies Meta<typeof DraggableRow>;

export default meta;
type Story = StoryObj<typeof meta>;

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
}

const mockSongs: Song[] = [
  {
    id: "1",
    title: "bohemian rhapsody",
    artist: "queen",
    album: "a night at the opera",
    durationSeconds: 354,
  },
  {
    id: "2",
    title: "stairway to heaven",
    artist: "led zeppelin",
    album: "led zeppelin iv",
    durationSeconds: 482,
  },
  {
    id: "3",
    title: "hotel california",
    artist: "eagles",
    album: "hotel california",
    durationSeconds: 391,
  },
  {
    id: "4",
    title: "comfortably numb",
    artist: "pink floyd",
    album: "the wall",
    durationSeconds: 382,
  },
  {
    id: "5",
    title: "smells like teen spirit",
    artist: "nirvana",
    album: "nevermind",
    durationSeconds: 301,
  },
  {
    id: "6",
    title: "imagine",
    artist: "john lennon",
    album: "imagine",
    durationSeconds: 183,
  },
  {
    id: "7",
    title: "sweet child o' mine",
    artist: "guns n' roses",
    album: "appetite for destruction",
    durationSeconds: 356,
  },
  {
    id: "8",
    title: "november rain",
    artist: "guns n' roses",
    album: "use your illusion i",
    durationSeconds: 537,
  },
  {
    id: "9",
    title: "yesterday",
    artist: "the beatles",
    album: "help!",
    durationSeconds: 123,
  },
  {
    id: "10",
    title: "billie jean",
    artist: "michael jackson",
    album: "thriller",
    durationSeconds: 294,
  },
];

// interactive playlist with drag and drop
export const Interactive: Story = {
  render: () => {
    const [songs, setSongs] = createSignal<Song[]>(mockSongs);
    const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
    const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(
      null,
    );
    const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());

    const handleDragStart = (index: number) => (e: DragEvent) => {
      setDraggedIndex(index);
      e.dataTransfer!.effectAllowed = "move";
      console.log("drag start:", index);
    };

    const handleDragOver = (index: number) => (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      setDropTargetIndex(index);
    };

    const handleDragLeave = () => {
      setDropTargetIndex(null);
    };

    const handleDrop = (dropIndex: number) => (e: DragEvent) => {
      e.preventDefault();
      const dragIndex = draggedIndex();

      if (dragIndex === null || dragIndex === dropIndex) {
        setDraggedIndex(null);
        setDropTargetIndex(null);
        return;
      }

      // reorder the array
      const reordered = [...songs()];
      const [draggedSong] = reordered.splice(dragIndex, 1);
      reordered.splice(dropIndex, 0, draggedSong);

      setSongs(reordered);
      setDraggedIndex(null);
      setDropTargetIndex(null);

      console.log("dropped at:", dropIndex);
    };

    const handleRowClick = (song: Song) => () => {
      const newSelected = new Set(selectedIds());
      if (newSelected.has(song.id)) {
        newSelected.delete(song.id);
      } else {
        newSelected.add(song.id);
      }
      setSelectedIds(newSelected);
      console.log("selected:", song.title);
    };

    const handleRemove = (song: Song) => (e: MouseEvent) => {
      e.stopPropagation();
      setSongs(songs().filter((s) => s.id !== song.id));
      console.log("removed:", song.title);
    };

    const handleQueue = (song: Song) => (e: MouseEvent) => {
      e.stopPropagation();
      console.log("add to queue:", song.title);
    };

    return (
      <div class="p-6 bg-[var(--color-bg-primary)] rounded-lg">
        <div class="mb-4">
          <h3 class="text-[var(--color-text-primary)] text-lg font-semibold mb-1">
            playlist reordering demo
          </h3>
          <p class="text-[var(--color-text-secondary)] text-sm">
            drag rows to reorder • click to select • hover for actions
          </p>
        </div>

        <div class="space-y-1">
          <For each={songs()}>
            {(song, index) => (
              <DraggableRow
                id={song.id}
                index={index()}
                isDragging={draggedIndex() === index()}
                isDropTarget={dropTargetIndex() === index()}
                isSelected={selectedIds().has(song.id)}
                onDragStart={handleDragStart(index())}
                onDragOver={handleDragOver(index())}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop(index())}
                onClick={handleRowClick(song)}
              >
                <DraggableRowSongContent
                  title={song.title}
                  artist={song.artist}
                  album={song.album}
                  durationSeconds={song.durationSeconds}
                  actions={
                    <>
                      <IconButton
                        icon="queue"
                        size="sm"
                        variant="ghost"
                        onClick={handleQueue(song)}
                        aria-label="add to queue"
                      />
                      <IconButton
                        icon="delete"
                        size="sm"
                        variant="ghost"
                        onClick={handleRemove(song)}
                        aria-label="remove from playlist"
                      />
                    </>
                  }
                />
              </DraggableRow>
            )}
          </For>
        </div>

        <div class="mt-4 text-[var(--color-text-tertiary)] text-xs">
          {songs().length} songs • {selectedIds().size} selected
        </div>
      </div>
    );
  },
};

// single row states
export const Default: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0} onClick={() => console.log("clicked")}>
        <DraggableRowSongContent
          title="bohemian rhapsody"
          artist="queen"
          album="a night at the opera"
          durationSeconds={354}
        />
      </DraggableRow>
    </div>
  ),
};

export const Dragging: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0} isDragging={true}>
        <DraggableRowSongContent
          title="stairway to heaven"
          artist="led zeppelin"
          album="led zeppelin iv"
          durationSeconds={482}
        />
      </DraggableRow>
    </div>
  ),
};

export const DropTarget: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0} isDropTarget={true}>
        <DraggableRowSongContent
          title="hotel california"
          artist="eagles"
          album="hotel california"
          durationSeconds={391}
        />
      </DraggableRow>
    </div>
  ),
};

export const Selected: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0} isSelected={true}>
        <DraggableRowSongContent
          title="comfortably numb"
          artist="pink floyd"
          album="the wall"
          durationSeconds={382}
        />
      </DraggableRow>
    </div>
  ),
};

export const WithActions: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0} onClick={() => console.log("clicked")}>
        <DraggableRowSongContent
          title="smells like teen spirit"
          artist="nirvana"
          album="nevermind"
          durationSeconds={301}
          actions={
            <>
              <IconButton
                icon="favorite"
                size="sm"
                variant="ghost"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  console.log("favorite");
                }}
                aria-label="favorite"
              />
              <IconButton
                icon="queue"
                size="sm"
                variant="ghost"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  console.log("add to queue");
                }}
                aria-label="add to queue"
              />
              <IconButton
                icon="more"
                size="sm"
                variant="ghost"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  console.log("more options");
                }}
                aria-label="more options"
              />
            </>
          }
        />
      </DraggableRow>
    </div>
  ),
};

export const HoverInteraction: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <p class="text-[var(--color-text-secondary)] text-sm mb-4">
        hover over row to see drag handle appear
      </p>
      <DraggableRow id="1" index={0} onClick={() => console.log("clicked")}>
        <DraggableRowSongContent
          title="imagine"
          artist="john lennon"
          album="imagine"
          durationSeconds={183}
        />
      </DraggableRow>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0} disabled={true}>
        <DraggableRowSongContent
          title="sweet child o' mine"
          artist="guns n' roses"
          album="appetite for destruction"
          durationSeconds={356}
        />
      </DraggableRow>
    </div>
  ),
};

export const NoDuration: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0}>
        <DraggableRowSongContent
          title="yesterday"
          artist="the beatles"
          album="help!"
        />
      </DraggableRow>
    </div>
  ),
};

export const LongTitle: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <DraggableRow id="1" index={0}>
        <DraggableRowSongContent
          title="this is an extremely long song title that should truncate properly and not wrap to multiple lines"
          artist="an artist with a very long name that also needs truncation"
          album="the album with the longest name you've ever seen in your entire life"
          durationSeconds={999}
        />
      </DraggableRow>
    </div>
  ),
};

// multiple rows demonstrating visual states
export const MultipleStates: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)] space-y-1">
      <DraggableRow id="1" index={0}>
        <DraggableRowSongContent
          title="normal state"
          artist="default row"
          album="no interaction"
          durationSeconds={180}
        />
      </DraggableRow>

      <DraggableRow id="2" index={1} isSelected={true}>
        <DraggableRowSongContent
          title="selected state"
          artist="highlighted row"
          album="clicked once"
          durationSeconds={240}
        />
      </DraggableRow>

      <DraggableRow id="3" index={2} isDragging={true}>
        <DraggableRowSongContent
          title="dragging state"
          artist="being moved"
          album="ghost appearance"
          durationSeconds={195}
        />
      </DraggableRow>

      <DraggableRow id="4" index={3} isDropTarget={true}>
        <DraggableRowSongContent
          title="drop target state"
          artist="target zone"
          album="highlighted border"
          durationSeconds={320}
        />
      </DraggableRow>

      <DraggableRow id="5" index={4} disabled={true}>
        <DraggableRowSongContent
          title="disabled state"
          artist="non-draggable"
          album="locked in place"
          durationSeconds={205}
        />
      </DraggableRow>
    </div>
  ),
};
