import { Show, createSignal } from "solid-js";
import { SearchBox } from "../../../../components/search/SearchBox";
import { useAuth } from "../../../../hooks/auth";
import { UserMenu } from "../auth/UserMenu";
import { FreqholeIcon, CloseIcon, SearchIcon } from "../icons";

export interface HeaderProps {
  currentView: "music" | "artists" | "albums" | "playlists";
  onViewChange: (view: "music" | "artists" | "albums" | "playlists") => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  searchContext: any; // SearchContext type
}

export const Header = (props: HeaderProps) => {
  const auth = useAuth();
  const [showMobileSearch, setShowMobileSearch] = createSignal(false);

  return (
    <div class="bg-black/40 backdrop-blur-xl px-8 py-6 sticky top-0 z-50">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-4">
          <span class="text-2xl font-light text-white lowercase">
            <span class="hidden sm:inline">freqh</span>
            <FreqholeIcon class="inline" />
            <span class="hidden sm:inline">le</span>
          </span>
        </div>

        <nav class="flex gap-2 overflow-x-auto scrollbar-none">
          <button
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden group ${
              props.currentView === "music"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-primary-500/20"
            }`}
            onClick={() => props.onViewChange("music")}
          >
            <span class="relative z-10">music</span>
            <div class="absolute inset-0 bg-gradient-to-r from-transparent to-primary-500/20 transform translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
          </button>
          <button
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden group ${
              props.currentView === "artists"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-primary-500/20"
            }`}
            onClick={() => props.onViewChange("artists")}
          >
            <span class="relative z-10">artists</span>
            <div class="absolute inset-0 bg-gradient-to-r from-transparent to-primary-500/20 transform translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
          </button>
          <button
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden group ${
              props.currentView === "albums"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-primary-500/20"
            }`}
            onClick={() => props.onViewChange("albums")}
          >
            <span class="relative z-10">albums</span>
            <div class="absolute inset-0 bg-gradient-to-r from-transparent to-primary-500/20 transform translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
          </button>
          <button
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden group ${
              props.currentView === "playlists"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-primary-500/20"
            }`}
            onClick={() => props.onViewChange("playlists")}
          >
            <span class="relative z-10">playlists</span>
            <div class="absolute inset-0 bg-gradient-to-r from-transparent to-primary-500/20 transform translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
          </button>
        </nav>

        {/* Desktop Search */}
        <div class="hidden lg:flex flex-1 max-w-96 ml-12 relative items-center gap-2 bg-black rounded-lg p-1">
          <div class="flex-1">
            <SearchBox
              placeholder="search music..."
              useInternalState={false}
              query={props.searchQuery}
              onQueryChange={(query) => {
                props.onSearchQueryChange(query);
                props.searchContext.state.setQuery(query);
                if (!query.trim()) {
                  props.onClearSearch();
                }
              }}
              onSearch={(query) => {
                props.onViewChange("music");
                props.onSearch(query);
              }}
              onSuggestionSelect={(suggestion) => {
                props.onViewChange("music");
                props.onSearch(suggestion);
              }}
              onClear={props.onClearSearch}
              showSuggestions={true}
              maxSuggestions={6}
              autoSearch={false}
              debounceMs={300}
              class="w-full px-4 py-3 bg-transparent text-white font-light transition-all duration-300 border-none"
            />
          </div>
          <Show when={props.searchQuery.trim()}>
            <button
              class="bg-white/10 border-none text-white/60 cursor-pointer p-2 rounded transition-all duration-300 flex items-center justify-center hover:bg-primary-500 hover:text-white"
              onClick={props.onClearSearch}
              title="Clear search"
            >
              <CloseIcon />
            </button>
          </Show>
        </div>

        {/* Mobile Search Button */}
        <div class="lg:hidden">
          <button
            class="p-3 bg-black rounded-lg text-white hover:bg-primary-500/20 transition-all duration-300"
            onClick={() => setShowMobileSearch(!showMobileSearch())}
            title="Search"
          >
            <SearchIcon />
          </button>
        </div>

        {/* Auth Integration */}
        <Show when={auth.isAuthenticated}>
          <UserMenu />
        </Show>
      </div>

      {/* Mobile Search Overlay */}
      <Show when={showMobileSearch()}>
        <div
          class="lg:hidden fixed inset-0 z-50"
          onClick={() => setShowMobileSearch(false)}
        >
          <div
            class="absolute inset-x-0 top-0 bg-black/95 backdrop-blur-xl p-4 border-t border-white/10 animate-slideDown"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center gap-2">
              <div class="flex-1">
                <SearchBox
                  placeholder="search music..."
                  useInternalState={false}
                  query={props.searchQuery}
                  onQueryChange={(query) => {
                    props.onSearchQueryChange(query);
                    props.searchContext.state.setQuery(query);
                    if (!query.trim()) {
                      props.onClearSearch();
                    }
                  }}
                  onSearch={(query) => {
                    props.onViewChange("music");
                    props.onSearch(query);
                    setShowMobileSearch(false);
                  }}
                  onSuggestionSelect={(suggestion) => {
                    props.onViewChange("music");
                    props.onSearch(suggestion);
                    setShowMobileSearch(false);
                  }}
                  onClear={() => {
                    props.onClearSearch();
                    setShowMobileSearch(false);
                  }}
                  showSuggestions={true}
                  maxSuggestions={5}
                  autoSearch={false}
                  debounceMs={300}
                  class="w-full px-4 py-3 bg-white/10 text-white font-light transition-all duration-300 border-none rounded-lg"
                />
              </div>
              <button
                class="bg-white/10 border-none text-white/60 cursor-pointer p-3 rounded-lg transition-all duration-300 flex items-center justify-center hover:bg-primary-500 hover:text-white"
                onClick={() => {
                  props.onClearSearch();
                  setShowMobileSearch(false);
                }}
                title="Clear and close search"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
