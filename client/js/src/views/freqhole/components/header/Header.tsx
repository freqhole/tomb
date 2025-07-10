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
    <div class="zune-header">
      <div class="zune-branding">
        <div class="zune-logo">
          <span class="zune-logo-text">
            <span class="hidden-sm">freqh</span>
            <FreqholeIcon />
            <span class="hidden-sm">le</span>
          </span>
        </div>

        <nav class="zune-nav">
          <button
            class={`zune-nav-item ${props.currentView === "music" ? "active" : ""}`}
            onClick={() => props.onViewChange("music")}
          >
            music
          </button>
          <button
            class={`zune-nav-item ${props.currentView === "artists" ? "active" : ""}`}
            onClick={() => props.onViewChange("artists")}
          >
            artists
          </button>
          <button
            class={`zune-nav-item ${props.currentView === "albums" ? "active" : ""}`}
            onClick={() => props.onViewChange("albums")}
          >
            albums
          </button>
          <button
            class={`zune-nav-item ${props.currentView === "playlists" ? "active" : ""}`}
            onClick={() => props.onViewChange("playlists")}
          >
            playlists
          </button>
        </nav>

        <div class="zune-search-container">
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
            class="zune-search-box"
          />
          <Show when={props.searchQuery.trim()}>
            <button
              class="zune-search-clear"
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
