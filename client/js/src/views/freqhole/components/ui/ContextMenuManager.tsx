import { Show, createEffect } from "solid-js";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { PlaylistSelectorMenu } from "./PlaylistSelectorMenu";
import { createSignal } from "solid-js";
import type { Song } from "../../../../lib/music/schemas/song";

interface ContextMenuAction {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  type?: "separator";
}

export function ContextMenuManager() {
  const events = useGlobalEvents();
  const contextMenu = useContextMenu();
  const [actions, setActions] = createSignal<ContextMenuAction[]>([]);
  const [playlistSelector, setPlaylistSelector] = createSignal<{
    songs: Song[];
    show: boolean;
  } | null>(null);

  // Listen for context menu events
  createEffect(() => {
    events.on("context-menu:open", ({ x, y, actions: menuActions }) => {
      setActions(menuActions);
      setPlaylistSelector(null); // Clear any existing playlist selector
      contextMenu.open(x, y);
    });

    events.on("context-menu:close", () => {
      contextMenu.close();
      setPlaylistSelector(null);
    });

    events.on("playlist-selector:open", ({ x, y, songs }) => {
      // Close any existing context menu first
      setActions([]);
      setPlaylistSelector({ songs, show: true });
      contextMenu.open(x, y);
    });

    events.on("playlist-selector:close", () => {
      contextMenu.close();
      setPlaylistSelector(null);
    });
  });

  // Convert string icons to JSX elements
  const createIcon = (iconName?: string) => {
    if (!iconName) return undefined;

    const iconMap: Record<string, any> = {
      play: (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      ),
      "queue-add": (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" />
        </svg>
      ),
      "queue-next": (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
        </svg>
      ),
      heart: (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ),
      "heart-filled": (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ),
      "playlist-add": (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm11.5-9L22 12l-8.5 5V7z" />
        </svg>
      ),
      artist: (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      ),
      album: (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5s2.01-4.5 4.5-4.5 4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
        </svg>
      ),
      info: (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
        </svg>
      ),
    };

    return iconMap[iconName] || undefined;
  };

  // Convert action format from songInteractions to ContextMenu format
  const convertActions = (rawActions: any[]): any[] => {
    return rawActions
      .filter(
        (action) => action && (action.type === "separator" || action.label)
      )
      .map((action) => {
        if (action.type === "separator") {
          return { type: "separator" };
        }

        return {
          label: action.label,
          icon: createIcon(action.icon),
          onClick: () => {
            if (action.action) {
              action.action();
            } else if (action.onClick) {
              action.onClick();
            }
          },
          disabled: action.disabled || false,
          destructive: action.destructive || false,
        };
      });
  };

  const handleClose = () => {
    contextMenu.close();
    setActions([]);
    setPlaylistSelector(null);
  };

  const handlePlaylistSelected = (playlist: any) => {
    // Clear selection after successful playlist addition
    events.emit("selection:clear", {});
  };

  const handleNewPlaylistCreated = (playlist: any) => {
    // Clear selection after successful playlist creation
    events.emit("selection:clear", {});
  };

  return (
    <Show
      when={playlistSelector()?.show}
      fallback={
        <ContextMenu
          x={contextMenu.position().x}
          y={contextMenu.position().y}
          isOpen={contextMenu.isOpen()}
          onClose={handleClose}
          actions={convertActions(actions())}
        />
      }
    >
      <ContextMenu
        x={contextMenu.position().x}
        y={contextMenu.position().y}
        isOpen={contextMenu.isOpen()}
        onClose={handleClose}
        actions={[]}
      >
        <PlaylistSelectorMenu
          songs={playlistSelector()!.songs}
          onClose={handleClose}
          onPlaylistSelected={handlePlaylistSelected}
          onNewPlaylistCreated={handleNewPlaylistCreated}
        />
      </ContextMenu>
    </Show>
  );
}
