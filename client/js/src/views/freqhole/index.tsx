export function Freqhole() {
  return (
    <div class="h-screen w-screen bg-black text-white font-metro flex flex-col">
      {/* Header */}
      <header class="h-16 bg-dark-100 border-b border-dark-300 flex items-center px-6">
        <h1 class="text-xl font-semibold text-primary-500">Freqhole</h1>
      </header>

      {/* Main Content Area */}
      <main class="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        {/* Left Panel */}
        <div class="col-span-2 bg-dark-200 border-r border-dark-300 p-4">
          <h2 class="text-sm font-medium text-gray-400 mb-4">Browse</h2>
          <div class="space-y-2">
            <div class="p-2 rounded hover:bg-dark-100 cursor-pointer">
              Artists
            </div>
            <div class="p-2 rounded hover:bg-dark-100 cursor-pointer">
              Albums
            </div>
            <div class="p-2 rounded hover:bg-dark-100 cursor-pointer">
              Songs
            </div>
            <div class="p-2 rounded hover:bg-dark-100 cursor-pointer">
              Playlists
            </div>
          </div>
        </div>

        {/* Middle Panel */}
        <div class="col-span-2 bg-dark-200 border-r border-dark-300 p-4">
          <h2 class="text-sm font-medium text-gray-400 mb-4">Filters</h2>
          <div class="text-sm text-gray-500">Search filters will go here</div>
        </div>

        {/* Main Panel */}
        <div class="col-span-8 bg-dark-100 p-4">
          <h2 class="text-lg font-medium mb-4">Main Content</h2>
          <div class="text-gray-400">
            Primary content area - infinite scrolling will go here
          </div>
        </div>
      </main>

      {/* Footer Player (hidden for now) */}
      <footer class="h-0 bg-dark-200 border-t border-dark-300 transition-all duration-300">
        {/* Player controls will go here */}
      </footer>
    </div>
  );
}
