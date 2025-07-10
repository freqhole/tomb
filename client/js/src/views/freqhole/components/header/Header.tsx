/* @jsxImportSource solid-js */
import { Show } from "solid-js";
import { SearchBox } from "../../../../components/search/SearchBox";
import { useAuth } from "../../../../hooks/auth";
import { UserMenu } from "../auth/UserMenu";
import { FreqholeIcon, CloseIcon } from "../icons";

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

  return (
    <div class="bg-black/40 backdrop-blur-xl px-8 py-6 sticky top-0 z-10">
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
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden ${
              props.currentView === "music"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => props.onViewChange("music")}
          >
            music
          </button>
          <button
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden ${
              props.currentView === "artists"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => props.onViewChange("artists")}
          >
            artists
          </button>
          <button
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden ${
              props.currentView === "albums"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => props.onViewChange("albums")}
          >
            albums
          </button>
          <button
            class={`px-8 py-4 bg-transparent border-none text-lg font-normal cursor-pointer transition-all duration-500 lowercase whitespace-nowrap relative overflow-hidden ${
              props.currentView === "playlists"
                ? "text-primary-500 bg-primary-500/10 font-medium"
                : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => props.onViewChange("playlists")}
          >
            playlists
          </button>
        </nav>

        <div class="flex-1 max-w-96 ml-12 relative flex items-center gap-2">
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
              onSearch={props.onSearch}
              autoSearch={true}
              debounceMs={300}
              class="w-full px-4 py-3 bg-white/10 text-white font-light transition-all duration-300"
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

        {/* Auth Integration */}
        <Show when={auth.isAuthenticated}>
          <UserMenu />
        </Show>
      </div>
    </div>
  );
};
