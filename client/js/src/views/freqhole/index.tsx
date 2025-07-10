export function Freqhole() {
  return (
    <div class="h-screen w-screen bg-black text-white font-metro flex flex-col">
      {/* Header */}
      <header class="h-16 bg-dark-100 border-b border-dark-300 flex items-center px-6">
        <h1 class="text-xl font-semibold text-primary-500 hover:text-primary-400 transition-colors">
          F R E Q H O L E
        </h1>
      </header>

      {/* Main Content Area */}
      <main class="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        {/* Left Panel */}
        <div class="col-span-2 bg-dark-200 border-r border-dark-300 p-4">
          <h2 class="text-sm font-medium text-gray-400 mb-4">Browse</h2>
          <div class="space-y-2">
            <div class="p-2 rounded hover:bg-primary-900 hover:text-primary-200 cursor-pointer transition-colors">
              Artists
            </div>
            <div class="p-2 rounded hover:bg-primary-900 hover:text-primary-200 cursor-pointer transition-colors">
              Albums
            </div>
            <div class="p-2 rounded hover:bg-primary-900 hover:text-primary-200 cursor-pointer transition-colors">
              Songs
            </div>
            <div class="p-2 rounded hover:bg-primary-900 hover:text-primary-200 cursor-pointer transition-colors">
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
          <div class="text-gray-400 mb-4">
            Primary content area - infinite scrolling will go here
          </div>

          {/* Tailwind v4 Tests */}
          <div class="space-y-4">
            <h3 class="text-white font-bold">Standard Tailwind Colors:</h3>
            <div class="text-red-500 text-2xl font-bold">RED TEXT</div>
            <div class="text-blue-500 text-2xl font-bold">BLUE TEXT</div>
            <div class="text-green-500 text-2xl font-bold">GREEN TEXT</div>

            <h3 class="text-white font-bold mt-6">Custom v4 Colors:</h3>
            <div class="text-primary-500 text-2xl font-bold">
              PRIMARY-500 TEXT
            </div>
            <div class="text-primary-300 text-2xl font-bold">
              PRIMARY-300 TEXT
            </div>
            <div class="text-dark-400 text-2xl font-bold">DARK-400 TEXT</div>

            <h3 class="text-white font-bold mt-6">Background Tests:</h3>
            <div class="w-64 h-16 bg-red-500 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              RED BG
            </div>
            <div class="w-64 h-16 bg-primary-500 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              PRIMARY BG
            </div>
            <div class="w-64 h-16 bg-dark-300 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              DARK BG
            </div>

            <div style="color: red; background: blue; padding: 16px; border-radius: 8px; font-weight: bold;">
              INLINE STYLE TEST (should be red on blue)
            </div>
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
