import { createSignal, onMount } from "solid-js";
import { Panel } from "./components/layout/Panel";
import {
  ContextMenu,
  useContextMenu,
  type MenuAction,
} from "./components/ui/ContextMenu";
import { Modal, Popover, useModal, usePopover } from "./components/ui/Modal";
import { useAuth } from "../../hooks/auth";
import { AuthModal } from "./components/auth/AuthModal";
import { Header } from "./components/header";
import { Player, QueueViewer } from "./components/player";
import { FreqholeProvider } from "./context";

export function Freqhole() {
  const contextMenu = useContextMenu();
  const modal = useModal();
  const popover = usePopover();

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

  // View state for header navigation
  const [currentView, setCurrentView] = createSignal<
    "music" | "artists" | "albums" | "playlists"
  >("music");
  const [searchQuery, setSearchQuery] = createSignal("");

  // Check auth status on mount (silent to avoid loading spinner)
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
    }
  });

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
    <FreqholeProvider
      options={{
        initialVolume: 0.5,
        autoNext: true,
      }}
    >
      <div
        class="h-screen w-screen bg-black text-white font-metro flex flex-col"
        onContextMenu={contextMenu.handleContextMenu}
      >
        {/* Header */}
        <div class="h-16">
          <Header
            currentView={currentView()}
            onViewChange={setCurrentView}
            searchQuery={searchQuery()}
            onSearchQueryChange={setSearchQuery}
            onSearch={(query) => {
              console.log("Search:", query);
              // TODO: Implement search functionality
            }}
            onClearSearch={() => {
              setSearchQuery("");
              // TODO: Clear search results
            }}
            searchContext={{
              state: {
                setQuery: setSearchQuery,
              },
            }}
          />
        </div>

        {/* Main Content Area */}
        <main class="flex-1 grid grid-cols-12 gap-6 overflow-hidden">
          {/* Left Panel - Hidden on mobile */}
          <div class="hidden md:block col-span-12 md:col-span-3">
            <Panel title="List Panel" subtitle="Dynamic content area">
              <div class="space-y-1">
                <div class="p-4 border border-transparent hover:bg-primary-500 hover:border-primary-300 cursor-pointer transition-all duration-200 metro-fade-in metro-item-hover">
                  Sample Item 1
                </div>
                <div class="p-4 border border-transparent hover:bg-primary-500 hover:border-primary-300 cursor-pointer transition-all duration-200 metro-fade-in metro-item-hover">
                  Sample Item 2
                </div>
                <div class="p-4 border border-transparent hover:bg-primary-500 hover:border-primary-300 cursor-pointer transition-all duration-200 metro-fade-in metro-item-hover">
                  Sample Item 3
                </div>
                <div class="p-4 border border-transparent hover:bg-primary-500 hover:border-primary-300 cursor-pointer transition-all duration-200 metro-fade-in metro-item-hover">
                  Sample Item 4
                </div>
              </div>
            </Panel>
          </div>

          {/* Middle Panel - Hidden on mobile */}
          <div class="hidden lg:block col-span-12 lg:col-span-3">
            <Panel
              title="Context Panel"
              subtitle="Details and controls"
              isLoading={true}
            >
              <div class="text-sm text-gray-500">
                Context content will go here
              </div>
            </Panel>
          </div>

          {/* Main Panel - Full width on mobile */}
          <div class="col-span-12 md:col-span-9 lg:col-span-6">
            <Panel
              title="Main Content"
              subtitle="Primary content area"
              headerActions={
                <div class="flex items-center space-x-2">
                  {/* Mobile panel toggles */}
                  <button class="md:hidden px-3 py-1 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover">
                    List
                  </button>
                  <button class="lg:hidden px-3 py-1 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover">
                    Context
                  </button>
                  <button
                    class="px-3 py-1 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover"
                    onClick={(e) => {
                      if (contextMenu.isOpen()) {
                        contextMenu.close();
                      } else {
                        contextMenu.handleButtonClick(e);
                      }
                    }}
                  >
                    View Options
                  </button>
                  <button
                    class="px-3 py-1 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover"
                    onClick={popover.handleButtonClick}
                  >
                    Popover
                  </button>
                  <button
                    class="px-3 py-1 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm metro-button-hover"
                    onClick={modal.open}
                  >
                    Modal
                  </button>
                </div>
              }
            >
              <div class="space-y-6">
                <div class="text-gray-400 mb-4">
                  Test our UI components: Right-click for context menu, click
                  buttons for Modal/Popover!
                </div>

                {/* UI Components Demo */}
                <div class="space-y-4">
                  <h3 class="text-white font-bold">UI Components Demo:</h3>
                  <div class="text-primary-500 text-xl font-bold metro-slide-up">
                    Modal, Popover & Context Menu working! ✨
                  </div>
                  <div class="text-green-500 font-medium">
                    ✅ Context Menu: Right-click or "View Options"
                  </div>
                  <div class="text-green-500 font-medium">
                    ✅ Modal: Full-screen overlay with backdrop
                  </div>
                  <div class="text-green-500 font-medium">
                    ✅ Popover: Anchored positioning with auto-placement
                  </div>
                  <div class="text-green-500 font-medium">
                    ✅ Click-away and escape key support
                  </div>
                  <div class="text-green-500 font-medium">
                    ✅ Metro animations and styling
                  </div>
                  <div class="text-yellow-500 font-medium">
                    🖱️ Try all three UI patterns!
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </main>

        {/* Footer Player */}
        <footer class="h-auto bg-black transition-all duration-300">
          <Player />
        </footer>

        {/* Queue Viewer */}
        <QueueViewer />

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
      </div>
    </FreqholeProvider>
  );
}
