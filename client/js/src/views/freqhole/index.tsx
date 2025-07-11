import { createSignal, createMemo, onMount, Show, For } from "solid-js";
import {
  ContextMenu,
  useContextMenu,
  type MenuAction,
} from "./components/ui/ContextMenu";
import { Modal, Popover, useModal, usePopover } from "./components/ui/Modal";
import { useAuth } from "../../hooks/auth";
import { AuthModal } from "./components/auth/AuthModal";
import { Header } from "./components/header";
import {
  Player,
  QueueViewer,
  KeyboardHelp,
  MiniPlayer,
} from "./components/player";
import { FreqholeProvider, useFreqhole } from "./context";
import { PlayIcon, AddIcon, QueueIcon, EditIcon } from "./components/icons";

function FreqholeContent() {
  const contextMenu = useContextMenu();
  const modal = useModal();
  const popover = usePopover();
  const freqhole = useFreqhole();
  const [selectedSong, setSelectedSong] = createSignal<string | null>(null);

  // Auth state and modal
  const [showAuthModal, setShowAuthModal] = createSignal(false);
  const auth = useAuth({
    onAuthSuccess: () => {
      console.log("Auth successful!");
    },
    onLogout: () => {
      console.log("Logged out");
    },
  });

  // Initialize freqhole and check auth on mount
  onMount(async () => {
    console.log("Mount: Initial auth state:", {
      isAuthenticated: auth.isAuthenticated,
      currentUser: auth.currentUser,
      isLoading: auth.isLoading,
      error: auth.error,
    });

    // Reset loading state in case it's stuck
    auth.clearError();
    auth.resetLoadingState();

    const isAuthenticated = await auth.checkAuthStatusSilent();

    console.log("Mount: After auth check:", {
      isAuthenticated: auth.isAuthenticated,
      currentUser: auth.currentUser,
      isLoading: auth.isLoading,
      error: auth.error,
    });

    if (!isAuthenticated) {
      setShowAuthModal(true);
    } else {
      // Initialize freqhole data
      await freqhole.actions.initialize();
    }
  });

  // Get current view data - memoized to prevent re-renders
  const currentViewData = createMemo(() => {
    const currentView = freqhole.music.state.currentView();
    switch (currentView) {
      case "music":
        return freqhole.music.state.isSearchActive()
          ? freqhole.music.state.searchResults()
          : freqhole.music.state.songs();
      case "artists":
        return freqhole.music.state.artists();
      case "albums":
        return freqhole.music.state.albums();
      case "playlists":
        return freqhole.music.state.playlists();
      default:
        return [];
    }
  });

  const handleSearch = (query: string) => {
    if (query.trim()) {
      freqhole.music.actions.performSearch(query);
    } else {
      freqhole.music.actions.clearSearch();
    }
  };

  const handlePlayItem = (item: any) => {
    const currentView = freqhole.music.state.currentView();
    switch (currentView) {
      case "music":
        freqhole.actions.playAndQueue(item);
        break;
      case "artists":
        freqhole.actions.playArtist(item);
        break;
      case "albums":
        freqhole.actions.playAlbum(item);
        break;
      case "playlists":
        freqhole.actions.playPlaylist(item);
        break;
    }
  };

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const renderMusicItem = (song: any) => (
    <div
      class={`flex items-center p-3 border border-transparent hover:bg-dark-200 cursor-pointer transition-all duration-200 metro-item-hover ${
        selectedSong() === song.id
          ? "bg-primary-500/20 border-primary-500/50"
          : ""
      } ${
        freqhole.player.currentSong()?.id === song.id
          ? "bg-primary-500/30 border-primary-500"
          : ""
      }`}
      onClick={() => setSelectedSong(song.id)}
      onDblClick={() => handlePlayItem(song)}
    >
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <h3 class="text-white font-medium truncate">{song.title}</h3>
            <p class="text-gray-400 text-sm truncate">
              {song.artist} {song.album && `• ${song.album}`}
            </p>
          </div>
          <div class="flex items-center space-x-2 ml-4">
            <span class="text-gray-400 text-sm">
              {formatDuration(song.duration_seconds)}
            </span>
          </div>
        </div>
      </div>
      <div class="flex items-center space-x-2 ml-4">
        <button
          class="p-2 hover:bg-primary-500 border border-transparent rounded transition-all duration-200 metro-button-hover"
          onClick={(e) => {
            e.stopPropagation();
            handlePlayItem(song);
          }}
          title="Play"
        >
          <PlayIcon className="w-4 h-4 text-white" />
        </button>
        <button
          class="p-2 hover:bg-primary-500 border border-transparent rounded transition-all duration-200 metro-button-hover"
          onClick={(e) => {
            e.stopPropagation();
            freqhole.player.addToQueue(song);
          }}
          title="Add to Queue"
        >
          <QueueIcon className="w-4 h-4 text-white" />
        </button>
        <button
          class="p-2 hover:bg-primary-500 border border-transparent rounded transition-all duration-200 metro-button-hover"
          onClick={(e) => {
            e.stopPropagation();
            freqhole.actions.addToPlaylistWithModal([song]);
          }}
          title="Add to Playlist"
        >
          <AddIcon className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );

  const renderListItem = (item: any) => {
    const currentView = freqhole.music.state.currentView();

    if (currentView === "music") {
      return renderMusicItem(item);
    }

    // Generic item renderer for artists, albums, playlists
    return (
      <div
        class="flex items-center p-3 border border-transparent hover:bg-dark-200 cursor-pointer transition-all duration-200 metro-item-hover"
        onDblClick={() => handlePlayItem(item)}
      >
        <div class="flex-1 min-w-0">
          <h3 class="text-white font-medium truncate">
            {item.title || item.artist || item.album || "Unknown"}
          </h3>
          <p class="text-gray-400 text-sm truncate">
            {currentView === "artists" &&
              `${item.song_count} songs • ${item.album_count} albums`}
            {currentView === "albums" &&
              `${item.artist} • ${item.track_count} tracks`}
            {currentView === "playlists" && `${item.song_count || 0} songs`}
          </p>
        </div>
        <div class="flex items-center space-x-2 ml-4">
          <button
            class="p-2 hover:bg-primary-500 border border-transparent rounded transition-all duration-200 metro-button-hover"
            onClick={(e) => {
              e.stopPropagation();
              handlePlayItem(item);
            }}
            title="Play"
          >
            <PlayIcon className="w-4 h-4 text-white" />
          </button>
          {currentView === "playlists" && (
            <button
              class="p-2 hover:bg-primary-500 border border-transparent rounded transition-all duration-200 metro-button-hover"
              onClick={(e) => {
                e.stopPropagation();
                freqhole.view.actions.openEditPlaylistModal(item);
              }}
              title="Edit"
            >
              <EditIcon className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Demo context menu actions
  const menuActions: MenuAction[] = [
    {
      label: "Play",
      icon: (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      ),
      onClick: () => console.log("Play clicked"),
    },
    {
      label: "Add to Queue",
      icon: (
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </svg>
      ),
      onClick: () => console.log("Add to queue clicked"),
    },
    {
      label: "Add to Playlist",
      onClick: () => console.log("Add to playlist clicked"),
    },
    {
      label: "Disabled Action",
      onClick: () => console.log("Should not fire"),
      disabled: true,
    },
    {
      label: "Delete",
      onClick: () => console.log("Delete clicked"),
      destructive: true,
    },
  ];

  return (
    <>
      <div
        class="h-screen w-screen bg-black text-white font-metro flex flex-col"
        onContextMenu={contextMenu.handleContextMenu}
      >
        {/* Header */}
        <div class="flex-shrink-0">
          <Header
            currentView={freqhole.music.state.currentView()}
            onViewChange={(view) => freqhole.music.actions.changeView(view)}
            searchQuery={freqhole.music.state.searchQuery()}
            onSearchQueryChange={() => {}} // Handled by SearchBox
            onSearch={handleSearch}
            onClearSearch={() => freqhole.music.actions.clearSearch()}
            searchContext={{
              state: {
                setQuery: () => {}, // Handled by SearchBox
              },
            }}
          />
        </div>

        {/* Main Content Area */}
        <main class="flex-1 overflow-hidden p-6 pt-4">
          <div class="h-full flex flex-col">
            {/* Loading State - Only show for view operations, not player operations */}
            <Show when={freqhole.isLoading()}>
              <div class="flex items-center justify-center py-8">
                <div class="text-gray-400">Loading...</div>
              </div>
            </Show>

            {/* Error State */}
            <Show when={freqhole.getError()}>
              <div class="flex items-center justify-between bg-red-900/20 border border-red-500/30 p-4 rounded mb-4">
                <div class="text-red-400">{freqhole.getError()}</div>
                <button
                  class="px-3 py-1 bg-red-500 text-white hover:bg-red-600 transition-colors text-sm"
                  onClick={() => freqhole.actions.clearAllErrors()}
                >
                  Dismiss
                </button>
              </div>
            </Show>

            {/* View Title */}
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center space-x-4">
                <h2 class="text-xl font-bold text-white">
                  {freqhole.music.state.isSearchActive()
                    ? `Search Results (${freqhole.music.state.searchResults().length})`
                    : `${freqhole.music.state.currentView().charAt(0).toUpperCase() + freqhole.music.state.currentView().slice(1)} (${currentViewData().length})`}
                </h2>
                <Show when={freqhole.music.state.isSearchActive()}>
                  <span class="text-sm text-gray-400">
                    for "{freqhole.music.state.searchQuery()}"
                  </span>
                </Show>
              </div>

              <div class="flex items-center space-x-2">
                <Show when={freqhole.music.state.currentView() === "playlists"}>
                  <button
                    class="px-3 py-1 bg-primary-500 text-white border border-transparent hover:bg-primary-600 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover"
                    onClick={() =>
                      freqhole.view.actions.openCreatePlaylistModal()
                    }
                  >
                    create playlist
                  </button>
                </Show>
              </div>
            </div>

            {/* Content List */}
            <div
              class="flex-1 overflow-auto"
              ref={(el) => freqhole.music.actions.setScrollContainer(el)}
            >
              <Show
                when={!freqhole.isLoading() && currentViewData().length > 0}
                fallback={
                  <div class="flex items-center justify-center py-8">
                    <div class="text-gray-400">
                      {freqhole.music.state.isSearchActive()
                        ? "no search results found"
                        : "no items found"}
                    </div>
                  </div>
                }
              >
                <div class="space-y-1">
                  <For each={currentViewData()}>
                    {(item) => renderListItem(item)}
                  </For>

                  {/* Infinite scroll loading indicator */}
                  <Show
                    when={() => {
                      const currentView = freqhole.music.state.currentView();

                      switch (currentView) {
                        case "music":
                          return (
                            freqhole.music.state.songsLoading() &&
                            freqhole.music.state.songsHasMore()
                          );
                        case "artists":
                          return (
                            freqhole.music.state.artistsLoading() &&
                            freqhole.music.state.artistsHasMore()
                          );
                        case "albums":
                          return (
                            freqhole.music.state.albumsLoading() &&
                            freqhole.music.state.albumsHasMore()
                          );
                        case "playlists":
                          return (
                            freqhole.music.state.playlistsLoading() &&
                            freqhole.music.state.playlistsHasMore()
                          );
                        default:
                          return false;
                      }
                    }}
                  >
                    <div class="flex items-center justify-center py-4">
                      <div class="text-gray-400 text-sm">loading more...</div>
                    </div>
                  </Show>

                  {/* Load more button as fallback */}
                  <Show
                    when={() => {
                      const currentView = freqhole.music.state.currentView();

                      switch (currentView) {
                        case "music":
                          const songsHasMore =
                            freqhole.music.state.songsHasMore();
                          const songsLoading =
                            freqhole.music.state.songsLoading();
                          console.log("🔘 Songs load more button check:", {
                            songsHasMore,
                            songsLoading,
                          });
                          return songsHasMore && !songsLoading;
                        case "artists":
                          const artistsHasMore =
                            freqhole.music.state.artistsHasMore();
                          const artistsLoading =
                            freqhole.music.state.artistsLoading();
                          console.log("🔘 Artists load more button check:", {
                            artistsHasMore,
                            artistsLoading,
                          });
                          return artistsHasMore && !artistsLoading;
                        case "albums":
                          const albumsHasMore =
                            freqhole.music.state.albumsHasMore();
                          const albumsLoading =
                            freqhole.music.state.albumsLoading();
                          console.log("🔘 Albums load more button check:", {
                            albumsHasMore,
                            albumsLoading,
                          });
                          return albumsHasMore && !albumsLoading;
                        case "playlists":
                          const playlistsHasMore =
                            freqhole.music.state.playlistsHasMore();
                          const playlistsLoading =
                            freqhole.music.state.playlistsLoading();
                          console.log("🔘 Playlists load more button check:", {
                            playlistsHasMore,
                            playlistsLoading,
                          });
                          return playlistsHasMore && !playlistsLoading;
                        default:
                          return false;
                      }
                    }}
                  >
                    <div class="flex items-center justify-center py-4">
                      <button
                        class="px-4 py-2 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 metro-button-hover"
                        onClick={() => {
                          const currentView =
                            freqhole.music.state.currentView();
                          switch (currentView) {
                            case "music":
                              freqhole.music.actions.loadMoreSongs();
                              break;
                            case "artists":
                              freqhole.music.actions.loadMoreArtists();
                              break;
                            case "albums":
                              freqhole.music.actions.loadMoreAlbums();
                              break;
                            case "playlists":
                              freqhole.music.actions.loadMorePlaylists();
                              break;
                          }
                        }}
                      >
                        load more
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </main>

        {/* Footer Player */}
        <footer class="min-h-16 bg-black transition-all duration-300">
          <Player />
        </footer>
      </div>

      {/* Queue Viewer */}
      <QueueViewer />

      {/* Mini Player */}
      <MiniPlayer />

      {/* Keyboard Help */}
      <KeyboardHelp />

      {/* Context Menu */}
      <ContextMenu
        x={contextMenu.position().x}
        y={contextMenu.position().y}
        isOpen={contextMenu.isOpen()}
        onClose={contextMenu.close}
        actions={menuActions}
      >
        {/* Demo playlist input - shows on first menu item */}
        <div class="flex items-center space-x-2">
          <input
            type="text"
            placeholder="New playlist name..."
            class="flex-1 px-2 py-1 bg-dark-300 text-white text-sm border border-transparent focus:border-primary-300 focus:outline-none"
          />
          <button class="px-2 py-1 bg-primary-500 text-white text-xs hover:bg-primary-600 transition-colors">
            Create
          </button>
        </div>
      </ContextMenu>

      {/* Modal Demo */}
      <Modal
        isOpen={modal.isOpen()}
        onClose={modal.close}
        title="Demo Modal"
        size="md"
      >
        <div class="space-y-4">
          <p class="text-gray-300">
            This is a modal dialog with backdrop blur and Metro styling.
          </p>

          <div class="space-y-3">
            <h4 class="text-white font-medium">Modal Features:</h4>
            <ul class="space-y-2 text-sm text-gray-400">
              <li>✅ Backdrop blur and dark overlay</li>
              <li>✅ Escape key and click-outside to close</li>
              <li>✅ Body scroll prevention</li>
              <li>✅ Multiple sizes (sm, md, lg, xl, full)</li>
              <li>✅ Metro animations</li>
            </ul>
          </div>

          <div class="flex space-x-3 pt-4">
            <button
              class="px-4 py-2 bg-primary-500 text-white border border-transparent hover:bg-primary-600 hover:border-primary-300 transition-all duration-200 metro-button-hover"
              onClick={modal.close}
            >
              Close Modal
            </button>
            <button class="px-4 py-2 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 metro-button-hover">
              Another Action
            </button>
          </div>
        </div>
      </Modal>

      {/* Popover Demo */}
      <Popover
        isOpen={popover.isOpen()}
        onClose={popover.close}
        anchorElement={popover.anchorElement()}
        placement="auto"
        showArrow={true}
      >
        <div class="space-y-3 min-w-64">
          <h4 class="text-white font-medium">Popover Menu</h4>
          <p class="text-sm text-gray-400">
            Smart positioning that adapts to viewport edges.
          </p>

          <div class="space-y-2">
            <button class="w-full px-3 py-2 text-left border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 metro-button-hover">
              Settings
            </button>
            <button class="w-full px-3 py-2 text-left border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 metro-button-hover">
              Preferences
            </button>
            <button class="w-full px-3 py-2 text-left border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 metro-button-hover">
              About
            </button>
          </div>
        </div>
      </Popover>

      {/* Auth Modal */}
      <AuthModal
        isOpen={showAuthModal()}
        onClose={() => setShowAuthModal(false)}
        onAuthSuccess={() => setShowAuthModal(false)}
      />

      {/* Playlist Modal */}
      <Modal
        isOpen={freqhole.view.state.showPlaylistModal()}
        onClose={() => freqhole.view.actions.closePlaylistModal()}
        title={
          freqhole.view.state.playlistModalMode() === "create"
            ? "Create Playlist"
            : freqhole.view.state.playlistModalMode() === "edit"
              ? "Edit Playlist"
              : "Add Songs to Playlist"
        }
        size="md"
      >
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Playlist Name
            </label>
            <input
              type="text"
              class="w-full px-3 py-2 bg-dark-300 text-white border border-gray-600 rounded focus:border-primary-500 focus:outline-none"
              value={freqhole.view.state.playlistForm().title}
              onInput={(e) =>
                freqhole.view.actions.updatePlaylistForm({
                  title: e.target.value,
                })
              }
              placeholder="Enter playlist name..."
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Description (Optional)
            </label>
            <textarea
              class="w-full px-3 py-2 bg-dark-300 text-white border border-gray-600 rounded focus:border-primary-500 focus:outline-none"
              value={freqhole.view.state.playlistForm().description}
              onInput={(e) =>
                freqhole.view.actions.updatePlaylistForm({
                  description: e.target.value,
                })
              }
              placeholder="Enter playlist description..."
              rows="3"
            />
          </div>

          <div class="flex items-center">
            <input
              type="checkbox"
              id="public-playlist"
              class="w-4 h-4 text-primary-500 bg-dark-300 border-gray-600 rounded focus:ring-primary-500"
              checked={freqhole.view.state.playlistForm().is_public}
              onChange={(e) =>
                freqhole.view.actions.updatePlaylistForm({
                  is_public: e.target.checked,
                })
              }
            />
            <label for="public-playlist" class="ml-2 text-sm text-gray-300">
              Make playlist public
            </label>
          </div>

          <div class="flex space-x-3 pt-4">
            <button
              class="px-4 py-2 bg-primary-500 text-white border border-transparent hover:bg-primary-600 hover:border-primary-300 transition-all duration-200 metro-button-hover"
              onClick={() => {
                if (freqhole.view.state.playlistModalMode() === "create") {
                  freqhole.actions.createPlaylistWithModal();
                } else if (freqhole.view.state.playlistModalMode() === "edit") {
                  freqhole.actions.updatePlaylistWithModal();
                }
              }}
              disabled={!freqhole.view.state.playlistForm().title.trim()}
            >
              {freqhole.view.state.playlistModalMode() === "create"
                ? "Create Playlist"
                : "Update Playlist"}
            </button>
            <button
              class="px-4 py-2 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 metro-button-hover"
              onClick={() => freqhole.view.actions.closePlaylistModal()}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export function Freqhole() {
  return (
    <FreqholeProvider
      options={{
        initialVolume: 0.5,
        autoNext: true,
      }}
    >
      <FreqholeContent />
    </FreqholeProvider>
  );
}
