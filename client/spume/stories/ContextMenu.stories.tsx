import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconButton } from "../src/components/buttons/IconButton";
import { Icon } from "../src/components/icons/registry";
import type { MenuAction } from "../src/components/overlays/ContextMenu";
import {
  ContextMenu,
  DropdownMenu,
} from "../src/components/overlays/ContextMenu";
import { formatDuration, mockAlbums, mockSongs } from "./mockData";

const meta = {
  title: "Components/Overlays/Context Menu",
  component: ContextMenu,
  tags: ["autodocs"],
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

// basic context menu on right-click
export const RightClickMenu: Story = {
  render: () => {
    const actions: MenuAction[] = [
      {
        label: "play",
        icon: "play" as const,
        onClick: () => console.log("play"),
      },
      {
        label: "add to queue",
        icon: "queue" as const,
        onClick: () => console.log("queue"),
      },
      {
        label: "add to playlist",
        icon: "playlist" as const,
        onClick: () => console.log("playlist"),
      },
      { type: "separator" as const },
      {
        label: "edit",
        icon: "edit" as const,
        onClick: () => console.log("edit"),
      },
      {
        label: "delete",
        icon: "delete" as const,
        onClick: () => console.log("delete"),
        destructive: true,
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <ContextMenu actions={actions}>
          <div class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center">
            <p class="body-base text-[var(--color-text-primary)] mb-2">
              right-click anywhere in this box
            </p>
            <p class="caption text-[var(--color-text-tertiary)]">
              try right-clicking to open the context menu
            </p>
          </div>
        </ContextMenu>
      </div>
    );
  },
};

// button click menu (dropdown style)
export const ButtonMenu: Story = {
  render: () => {
    const actions: MenuAction[] = [
      {
        label: "profile",
        icon: "user" as const,
        onClick: () => console.log("profile"),
      },
      {
        label: "settings",
        icon: "settings" as const,
        onClick: () => console.log("settings"),
      },
      { type: "separator" as const },
      {
        label: "logout",
        icon: "logout" as const,
        onClick: () => console.log("logout"),
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <DropdownMenu
          trigger={<IconButton icon="more" aria-label="open menu" />}
          actions={actions}
        />
      </div>
    );
  },
};

// mobile long-press support (kobalte handles this automatically with onContextMenu)
export const MobileLongPress: Story = {
  render: () => {
    const actions: MenuAction[] = [
      {
        label: "copy link",
        icon: "edit" as const,
        onClick: () => console.log("copy"),
      },
      {
        label: "share",
        icon: "upload" as const,
        onClick: () => console.log("share"),
      },
      {
        label: "report",
        icon: "alertTriangle" as const,
        onClick: () => console.log("report"),
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <ContextMenu actions={actions}>
          <div class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center touch-none">
            <p class="body-base text-[var(--color-text-primary)] mb-2">
              long-press here (mobile) or right-click
            </p>
            <p class="caption text-[var(--color-text-tertiary)]">
              kobalte handles mobile long-press automatically
            </p>
          </div>
        </ContextMenu>
      </div>
    );
  },
};

// song row context menu
// song row menu (realistic use case)
export const SongRowMenu: Story = {
  render: () => {
    const songs = mockSongs.slice(0, 3).map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      duration: formatDuration(s.durationSeconds),
    }));

    const getActions = (songId: string): MenuAction[] => [
      {
        label: "play now",
        icon: "play" as const,
        onClick: () => console.log("play", songId),
      },
      {
        label: "play next",
        icon: "next" as const,
        onClick: () => console.log("play next", songId),
      },
      {
        label: "add to queue",
        icon: "queue" as const,
        onClick: () => console.log("queue", songId),
      },
      { type: "separator" as const },
      {
        label: "add to playlist",
        icon: "playlist" as const,
        onClick: () => console.log("playlist", songId),
      },
      {
        label: "favorite",
        icon: "favorite" as const,
        onClick: () => console.log("favorite", songId),
      },
      { type: "separator" as const },
      {
        label: "edit metadata",
        icon: "edit" as const,
        onClick: () => console.log("edit", songId),
      },
      {
        label: "delete",
        icon: "delete" as const,
        onClick: () => console.log("delete", songId),
        destructive: true,
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl space-y-2">
          <div class="caption mb-4">right-click on any song row</div>
          {songs.map((song) => (
            <ContextMenu actions={getActions(song.id)}>
              <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors cursor-default">
                <div class="flex-1">
                  <div class="body-small text-[var(--color-text-primary)]">
                    {song.title}
                  </div>
                  <div class="caption">{song.artist}</div>
                </div>
                <div class="monospace caption text-[var(--color-text-muted)]">
                  {song.duration}
                </div>
              </div>
            </ContextMenu>
          ))}
        </div>
      </div>
    );
  },
};

// disabled actions
export const DisabledActions: Story = {
  render: () => {
    const actions: MenuAction[] = [
      {
        label: "available action",
        icon: "check" as const,
        onClick: () => console.log("available"),
      },
      {
        label: "disabled action",
        icon: "x" as const,
        onClick: () => console.log("disabled"),
        disabled: true,
      },
      { type: "separator" as const },
      {
        label: "another available",
        icon: "play" as const,
        onClick: () => console.log("play"),
      },
      {
        label: "also disabled",
        icon: "delete" as const,
        onClick: () => console.log("delete"),
        disabled: true,
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <ContextMenu actions={actions}>
          <div class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center">
            <p class="body-base text-[var(--color-text-primary)] mb-2">
              right-click for menu with disabled items
            </p>
            <p class="caption text-[var(--color-text-tertiary)]">
              some actions are disabled
            </p>
          </div>
        </ContextMenu>
      </div>
    );
  },
};

// menu with custom content
// with custom content (text input for playlist creation)
export const WithCustomContent: Story = {
  render: () => {
    const [playlistName, setPlaylistName] = createSignal("");

    const actions: MenuAction[] = [
      {
        label: "create playlist",
        icon: "add" as const,
        onClick: () => console.log("create", playlistName()),
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <DropdownMenu
          trigger={
            <IconButton
              icon="add"
              variant="accent"
              aria-label="create playlist"
            />
          }
          actions={actions}
          header={
            <div>
              <label class="label text-[var(--color-text-secondary)] block mb-2">
                playlist name
              </label>
              <input
                type="text"
                value={playlistName()}
                onInput={(e) => setPlaylistName(e.currentTarget.value)}
                placeholder="enter playlist name"
                class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50"
              />
            </div>
          }
        />
      </div>
    );
  },
};

// album grid context menu
// album grid menu (realistic use case)
export const AlbumGridMenu: Story = {
  render: () => {
    const albums = mockAlbums.slice(0, 4).map((a) => ({
      id: a.id,
      title: a.title,
      artist: a.artist,
    }));

    const getActions = (albumId: string): MenuAction[] => [
      {
        label: "play album",
        icon: "play" as const,
        onClick: () => console.log("play", albumId),
      },
      {
        label: "play next",
        icon: "next" as const,
        onClick: () => console.log("play next", albumId),
      },
      { type: "separator" as const },
      {
        label: "add to playlist",
        icon: "playlist" as const,
        onClick: () => console.log("playlist", albumId),
      },
      {
        label: "favorite album",
        icon: "favorite" as const,
        onClick: () => console.log("favorite", albumId),
      },
      { type: "separator" as const },
      {
        label: "edit album info",
        icon: "edit" as const,
        onClick: () => console.log("edit", albumId),
      },
      {
        label: "delete album",
        icon: "delete" as const,
        onClick: () => console.log("delete", albumId),
        destructive: true,
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="caption mb-4">right-click on any album</div>
        <div class="grid grid-cols-2 gap-4 max-w-2xl">
          {albums.map((album) => (
            <ContextMenu actions={getActions(album.id)}>
              <div class="p-4 bg-[var(--color-bg-secondary)] rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors cursor-default">
                <div class="aspect-square bg-[var(--color-bg-tertiary)] rounded mb-3 flex items-center justify-center">
                  <Icon
                    name="music"
                    size={48}
                    color="var(--color-text-muted)"
                  />
                </div>
                <div class="body-small text-[var(--color-text-primary)] truncate">
                  {album.title}
                </div>
                <div class="caption truncate">{album.artist}</div>
              </div>
            </ContextMenu>
          ))}
        </div>
      </div>
    );
  },
};

// destructive action confirmation
export const DestructiveAction: Story = {
  render: () => {
    const [deleted, setDeleted] = createSignal(false);

    const actions: MenuAction[] = [
      {
        label: "edit",
        icon: "edit" as const,
        onClick: () => console.log("edit"),
      },
      {
        label: "duplicate",
        icon: "add" as const,
        onClick: () => console.log("duplicate"),
      },
      { type: "separator" as const },
      {
        label: "delete permanently",
        icon: "delete" as const,
        onClick: () => {
          if (confirm("are you sure you want to delete this item?")) {
            setDeleted(true);
          }
        },
        destructive: true,
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        {!deleted() ? (
          <ContextMenu actions={actions}>
            <div class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center">
              <p class="body-base text-[var(--color-text-primary)] mb-2">
                right-click and select delete
              </p>
              <p class="caption text-[var(--color-text-tertiary)]">
                destructive actions are highlighted in red
              </p>
            </div>
          </ContextMenu>
        ) : (
          <div class="p-8 bg-[var(--color-bg-secondary)] rounded-lg text-center">
            <p class="body-base text-[var(--color-text-tertiary)]">
              item deleted
            </p>
          </div>
        )}
      </div>
    );
  },
};

// nested menu simulation (multi-level)
// nested actions (kobalte supports submenus - placeholder for future enhancement)
export const NestedActionsSimulation: Story = {
  render: () => {
    const actions: MenuAction[] = [
      {
        label: "play",
        icon: "play" as const,
        onClick: () => console.log("play"),
      },
      {
        label: "add to queue",
        icon: "queue" as const,
        onClick: () => console.log("queue"),
      },
      {
        label: "add to playlist",
        icon: "playlist" as const,
        onClick: () =>
          console.log("add to playlist (submenu support coming soon)"),
      },
      { type: "separator" as const },
      {
        label: "edit",
        icon: "edit" as const,
        onClick: () => console.log("edit"),
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <ContextMenu actions={actions}>
          <div class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center">
            <p class="body-base text-[var(--color-text-primary)] mb-2">
              right-click for menu
            </p>
            <p class="caption text-[var(--color-text-tertiary)]">
              kobalte supports submenus - can enhance this later
            </p>
          </div>
        </ContextMenu>
      </div>
    );
  },
};
