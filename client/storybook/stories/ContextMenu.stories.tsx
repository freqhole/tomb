import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconButton } from "../src/components/buttons/IconButton";
import type { MenuAction } from "../src/components/overlays/ContextMenu";
import {
  ContextMenu,
  useContextMenu,
  useLongPress,
} from "../src/components/overlays/ContextMenu";

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
    const menu = useContextMenu();

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
        <div
          class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center"
          onContextMenu={menu.handleContextMenu}
        >
          <p class="body-base text-[var(--color-text-primary)] mb-2">
            right-click anywhere in this box
          </p>
          <p class="caption text-[var(--color-text-tertiary)]">
            try right-clicking to open the context menu
          </p>
        </div>

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={actions}
        />
      </div>
    );
  },
};

// button click menu (dropdown style)
export const ButtonMenu: Story = {
  render: () => {
    const menu = useContextMenu();

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
        <IconButton
          icon="more"
          onClick={menu.handleButtonClick}
          aria-label="open menu"
        />

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={actions}
        />
      </div>
    );
  },
};

// mobile long-press
export const MobileLongPress: Story = {
  render: () => {
    const menu = useContextMenu();
    const longPress = useLongPress((event) => {
      menu.handleLongPress(event);
    });

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
        label: "share",
        icon: "upload" as const,
        onClick: () => console.log("share"),
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div
          class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center touch-none"
          {...longPress}
        >
          <p class="body-base text-[var(--color-text-primary)] mb-2">
            long-press this box (mobile)
          </p>
          <p class="caption text-[var(--color-text-tertiary)]">
            on mobile devices, press and hold for 500ms to open menu
          </p>
        </div>

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={actions}
        />
      </div>
    );
  },
};

// song row context menu
export const SongRowMenu: Story = {
  render: () => {
    const [menuFor, setMenuFor] = createSignal<string | null>(null);
    const menu = useContextMenu();

    const songs = [
      { id: "1", title: "speak to me", artist: "pink floyd", duration: "1:13" },
      {
        id: "2",
        title: "breathe (in the air)",
        artist: "pink floyd",
        duration: "2:43",
      },
      { id: "3", title: "on the run", artist: "pink floyd", duration: "3:30" },
    ];

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
            <div
              class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors cursor-default"
              onContextMenu={(e) => {
                menu.handleContextMenu(e);
                setMenuFor(song.id);
              }}
            >
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
          ))}
        </div>

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={menuFor() ? getActions(menuFor()!) : []}
        />
      </div>
    );
  },
};

// disabled actions
export const DisabledActions: Story = {
  render: () => {
    const menu = useContextMenu();

    const actions: MenuAction[] = [
      {
        label: "play",
        icon: "play" as const,
        onClick: () => console.log("play"),
      },
      {
        label: "pause",
        icon: "pause" as const,
        onClick: () => console.log("pause"),
        disabled: true,
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
        disabled: true,
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div
          class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center"
          onContextMenu={menu.handleContextMenu}
        >
          <p class="body-base text-[var(--color-text-primary)] mb-2">
            right-click to see disabled actions
          </p>
          <p class="caption text-[var(--color-text-tertiary)]">
            some menu items are disabled and cannot be clicked
          </p>
        </div>

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={actions}
        />
      </div>
    );
  },
};

// menu with custom content
export const WithCustomContent: Story = {
  render: () => {
    const menu = useContextMenu();
    const [playlistName, setPlaylistName] = createSignal("");

    const actions: MenuAction[] = [
      {
        label: "create playlist",
        icon: "add" as const,
        onClick: () => console.log("create", playlistName()),
      },
      { type: "separator" as const },
      { label: "cancel", icon: "close" as const, onClick: () => menu.close() },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={(e) => {
            menu.handleButtonClick(e);
            setPlaylistName("");
          }}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-white rounded transition-colors"
        >
          create new playlist
        </button>

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={actions}
        >
          <div class="space-y-2">
            <label class="label text-[var(--color-text-secondary)] block">
              playlist name
            </label>
            <input
              type="text"
              value={playlistName()}
              onInput={(e) => setPlaylistName(e.currentTarget.value)}
              placeholder="enter name..."
              class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
            />
          </div>
        </ContextMenu>
      </div>
    );
  },
};

// album grid context menu
export const AlbumGridMenu: Story = {
  render: () => {
    const [menuFor, setMenuFor] = createSignal<string | null>(null);
    const menu = useContextMenu();

    const albums = [
      { id: "1", title: "the dark side of the moon", artist: "pink floyd" },
      { id: "2", title: "the wall", artist: "pink floyd" },
      { id: "3", title: "wish you were here", artist: "pink floyd" },
      { id: "4", title: "animals", artist: "pink floyd" },
    ];

    const getActions = (albumId: string): MenuAction[] => [
      {
        label: "play album",
        icon: "play" as const,
        onClick: () => console.log("play", albumId),
      },
      {
        label: "shuffle album",
        icon: "shuffle" as const,
        onClick: () => console.log("shuffle", albumId),
      },
      { type: "separator" as const },
      {
        label: "add to queue",
        icon: "queue" as const,
        onClick: () => console.log("queue", albumId),
      },
      {
        label: "add to playlist",
        icon: "playlist" as const,
        onClick: () => console.log("playlist", albumId),
      },
      { type: "separator" as const },
      {
        label: "go to artist",
        icon: "artist" as const,
        onClick: () => console.log("artist", albumId),
      },
      {
        label: "album info",
        icon: "info" as const,
        onClick: () => console.log("info", albumId),
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="caption mb-4">right-click on any album card</div>
        <div class="grid grid-cols-4 gap-4">
          {albums.map((album) => (
            <div
              class="bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden hover:bg-[var(--color-bg-hover)] transition-colors cursor-default"
              onContextMenu={(e) => {
                menu.handleContextMenu(e);
                setMenuFor(album.id);
              }}
            >
              <div class="aspect-square bg-[var(--color-bg-tertiary)] flex items-center justify-center">
                <span class="caption text-[var(--color-text-muted)]">
                  album
                </span>
              </div>
              <div class="p-3">
                <div class="body-small text-[var(--color-text-primary)] truncate">
                  {album.title}
                </div>
                <div class="caption truncate">{album.artist}</div>
              </div>
            </div>
          ))}
        </div>

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={menuFor() ? getActions(menuFor()!) : []}
        />
      </div>
    );
  },
};

// destructive action confirmation
export const DestructiveAction: Story = {
  render: () => {
    const menu = useContextMenu();
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
          setDeleted(true);
          setTimeout(() => setDeleted(false), 3000);
        },
        destructive: true,
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div
          class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center"
          onContextMenu={menu.handleContextMenu}
        >
          <p class="body-base text-[var(--color-text-primary)] mb-2">
            right-click to see destructive action
          </p>
          <p class="caption text-[var(--color-text-tertiary)]">
            the delete option is styled in red to indicate danger
          </p>
        </div>

        {deleted() && (
          <div class="mt-4 p-3 bg-[var(--color-error)] bg-opacity-20 border border-[var(--color-error)] rounded">
            <span class="body-small text-[var(--color-error)]">
              item deleted permanently
            </span>
          </div>
        )}

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={menu.close}
          x={menu.position().x}
          y={menu.position().y}
          actions={actions}
        />
      </div>
    );
  },
};

// nested menu simulation (multi-level)
export const NestedActionsSimulation: Story = {
  render: () => {
    const menu = useContextMenu();
    const [showPlaylistSubmenu, setShowPlaylistSubmenu] = createSignal(false);

    const mainActions: MenuAction[] = [
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
        label: "add to playlist →",
        icon: "playlist" as const,
        onClick: () => {
          setShowPlaylistSubmenu(true);
        },
      },
      { type: "separator" as const },
      {
        label: "edit",
        icon: "edit" as const,
        onClick: () => console.log("edit"),
      },
    ];

    const playlistActions: MenuAction[] = [
      {
        label: "← back",
        icon: "arrowLeft" as const,
        onClick: () => setShowPlaylistSubmenu(false),
      },
      { type: "separator" as const },
      {
        label: "workout vibes",
        icon: "playlist" as const,
        onClick: () => console.log("playlist 1"),
      },
      {
        label: "chill sunday",
        icon: "playlist" as const,
        onClick: () => console.log("playlist 2"),
      },
      {
        label: "90s nostalgia",
        icon: "playlist" as const,
        onClick: () => console.log("playlist 3"),
      },
      { type: "separator" as const },
      {
        label: "create new playlist",
        icon: "add" as const,
        onClick: () => console.log("new"),
      },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div
          class="p-8 bg-[var(--color-bg-secondary)] rounded-lg border-2 border-dashed border-[var(--color-border-default)] text-center"
          onContextMenu={(e) => {
            menu.handleContextMenu(e);
            setShowPlaylistSubmenu(false);
          }}
        >
          <p class="body-base text-[var(--color-text-primary)] mb-2">
            right-click and select "add to playlist"
          </p>
          <p class="caption text-[var(--color-text-tertiary)]">
            demonstrates a two-level menu simulation
          </p>
        </div>

        <ContextMenu
          isOpen={menu.isOpen()}
          onClose={() => {
            menu.close();
            setShowPlaylistSubmenu(false);
          }}
          x={menu.position().x}
          y={menu.position().y}
          actions={showPlaylistSubmenu() ? playlistActions : mainActions}
        />
      </div>
    );
  },
};
