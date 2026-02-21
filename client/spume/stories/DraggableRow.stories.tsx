import { createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconButton } from "../src/components/buttons/IconButton";
import { DraggableRow, DraggableRowSongContent } from "../src/components/lists/DraggableRow";
import { mockSongs, type Song } from "./mockData";

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

// interactive playlist with drag and drop
export const Interactive: Story = {
  render: () => {
    const [songs, setSongs] = createSignal<Song[]>(mockSongs);
    const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
    const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);
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
          title={mockSongs[17].title}
          artist={mockSongs[17].artist}
          album={mockSongs[17].album}
          durationSeconds={mockSongs[17].durationSeconds}
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
          title={mockSongs[11].title}
          artist={mockSongs[11].artist}
          album={mockSongs[11].album}
          durationSeconds={mockSongs[11].durationSeconds}
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
          title={mockSongs[0].title}
          artist={mockSongs[0].artist}
          album={mockSongs[0].album}
          durationSeconds={mockSongs[0].durationSeconds}
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
          title={mockSongs[0].title}
          artist={mockSongs[0].artist}
          album={mockSongs[0].album}
          durationSeconds={mockSongs[0].durationSeconds}
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
          title={mockSongs[22].title}
          artist={mockSongs[22].artist}
          album={mockSongs[22].album}
          durationSeconds={mockSongs[22].durationSeconds}
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
          title={mockSongs[1].title}
          artist={mockSongs[1].artist}
          album={mockSongs[1].album}
          durationSeconds={mockSongs[1].durationSeconds}
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
          title={mockSongs[22].title}
          artist={mockSongs[22].artist}
          album={mockSongs[22].album}
          durationSeconds={mockSongs[22].durationSeconds}
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
          title={mockSongs[15].title}
          artist={mockSongs[15].artist}
          album={mockSongs[15].album}
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
          title="This Is An Extremely Long Song Title That Should Truncate Properly And Not Wrap To Multiple Lines"
          artist="An Artist With A Very Long Name That Also Needs Truncation"
          album="The Album With The Longest Name You've Ever Seen In Your Entire Life"
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
          title={mockSongs[2].title}
          artist={mockSongs[2].artist}
          album={mockSongs[2].album}
          durationSeconds={mockSongs[2].durationSeconds}
        />
      </DraggableRow>

      <DraggableRow id="2" index={1} isSelected={true}>
        <DraggableRowSongContent
          title={mockSongs[3].title}
          artist={mockSongs[3].artist}
          album={mockSongs[3].album}
          durationSeconds={mockSongs[3].durationSeconds}
        />
      </DraggableRow>

      <DraggableRow id="3" index={2} isDragging={true}>
        <DraggableRowSongContent
          title={mockSongs[4].title}
          artist={mockSongs[4].artist}
          album={mockSongs[4].album}
          durationSeconds={mockSongs[4].durationSeconds}
        />
      </DraggableRow>

      <DraggableRow id="4" index={3} isDropTarget={true}>
        <DraggableRowSongContent
          title={mockSongs[5].title}
          artist={mockSongs[5].artist}
          album={mockSongs[5].album}
          durationSeconds={mockSongs[5].durationSeconds}
        />
      </DraggableRow>

      <DraggableRow id="5" index={4} disabled={true}>
        <DraggableRowSongContent
          title={mockSongs[6].title}
          artist={mockSongs[6].artist}
          album={mockSongs[6].album}
          durationSeconds={mockSongs[6].durationSeconds}
        />
      </DraggableRow>
    </div>
  ),
};
