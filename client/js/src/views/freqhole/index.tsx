import { Panel } from "./components/layout/Panel";
import {
  ContextMenu,
  useContextMenu,
  type MenuAction,
} from "./components/ui/ContextMenu";

export function Freqhole() {
  const contextMenu = useContextMenu();

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
    <div
      class="h-screen w-screen bg-black text-white font-metro flex flex-col"
      onContextMenu={contextMenu.handleContextMenu}
    >
      {/* Header */}
      <header class="h-16 bg-black flex items-center justify-between px-6">
        <h1 class="text-xl font-semibold text-primary-500 hover:text-primary-400 transition-colors">
          F R E Q H O L E
        </h1>

        {/* Navigation Links */}
        <nav class="hidden md:flex items-center space-x-2">
          <button class="px-4 py-2 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm font-medium metro-button-hover">
            Artists
          </button>
          <button class="px-4 py-2 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm font-medium metro-button-hover">
            Albums
          </button>
          <button class="px-4 py-2 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm font-medium metro-button-hover">
            Songs
          </button>
          <button class="px-4 py-2 bg-dark-200 text-white border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 text-sm font-medium metro-button-hover">
            Playlists
          </button>
        </nav>

        {/* Mobile menu button */}
        <button class="md:hidden text-primary-500 hover:text-primary-400 transition-colors">
          <svg
            class="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      </header>

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
              </div>
            }
          >
            <div class="space-y-6">
              <div class="text-gray-400 mb-4">
                Right-click anywhere OR click "View Options" button to test
                context menu!
              </div>

              {/* Context Menu Demo */}
              <div class="space-y-4">
                <h3 class="text-white font-bold">Context Menu Demo:</h3>
                <div class="text-primary-500 text-xl font-bold metro-slide-up">
                  Context menu system working! ✨
                </div>
                <div class="text-green-500 font-medium">
                  ✅ Viewport-aware positioning
                </div>
                <div class="text-green-500 font-medium">
                  ✅ Click outside to close
                </div>
                <div class="text-green-500 font-medium">
                  ✅ Escape key to close
                </div>
                <div class="text-green-500 font-medium">
                  ✅ Custom content support (playlist input)
                </div>
                <div class="text-green-500 font-medium">
                  ✅ Metro hover animations
                </div>
                <div class="text-green-500 font-medium">
                  ✅ Destructive actions styling
                </div>
                <div class="text-yellow-500 font-medium">
                  🖱️ Try right-clicking near window edges!
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </main>

      {/* Footer Player (hidden for now) */}
      <footer class="h-0 bg-black transition-all duration-300">
        {/* Player controls will go here */}
      </footer>

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
    </div>
  );
}
