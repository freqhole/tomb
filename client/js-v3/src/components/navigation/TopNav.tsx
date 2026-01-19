import { NavigationMenu as KobalteNav } from "@kobalte/core/navigation-menu";
import { createSignal, For, Show, type JSX } from "solid-js";
import { IconButton } from "../buttons/IconButton";
import { SearchInput } from "../forms/SearchInput";
import { Icon, type IconName } from "../icons/registry";

export interface NavMenuItem {
  /** menu item label */
  label: string;
  /** callback when item is clicked */
  onClick: () => void;
  /** whether item is disabled */
  disabled?: boolean;
}

export interface NavMenuSection {
  /** items in this section */
  items: NavMenuItem[];
}

export interface RecentPlaylist {
  /** playlist id */
  id: string;
  /** playlist name */
  name: string;
  /** callback when clicked */
  onClick: () => void;
}

export interface TopNavProps {
  /** brand name */
  brandName?: string;
  /** brand tagline/description */
  brandTagline?: string;
  /** version text */
  version?: string;
  /** callback when brand is clicked */
  onBrandClick?: () => void;
  /** search query */
  searchQuery?: string;
  /** callback when search query changes */
  onSearchChange?: (query: string) => void;
  /** callback when search is submitted */
  onSearchSubmit?: (query: string) => void;
  /** search placeholder text */
  searchPlaceholder?: string;
  /** main navigation menu sections */
  mainNavSections: NavMenuSection[];
  /** recent playlists */
  recentPlaylists?: RecentPlaylist[];
  /** callback for view all playlists */
  onViewAllPlaylists?: () => void;
  /** callback for create playlist */
  onCreatePlaylist?: () => void;
  /** current source name (e.g. "local library" or remote name) */
  currentSourceName?: string;
  /** available remote sources */
  remotes?: Array<{ id: string; name: string; url: string }>;
  /** callback to switch to local source */
  onSwitchToLocal?: () => void;
  /** callback to switch to a remote source */
  onSwitchToRemote?: (remoteId: string) => void;
  /** callback to add a new remote */
  onAddRemote?: () => void;
  /** additional content to render on the right side of the nav bar */
  rightContent?: JSX.Element;
  /** additional classes */
  class?: string;
}

// compact top nav with brand icon + search, 3-column flyout menu
export function TopNav(props: TopNavProps) {
  const [isSearchExpanded, setIsSearchExpanded] = createSignal(false);
  const [searchValue, setSearchValue] = createSignal(props.searchQuery || "");

  const handleSearchToggle = () => {
    setIsSearchExpanded(!isSearchExpanded());
    if (!isSearchExpanded() && searchValue()) {
      // if collapsing and there's a value, clear it
      setSearchValue("");
      props.onSearchChange?.("");
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchValue(value);
    props.onSearchChange?.(value);
    // keep search expanded if there's input
    if (value) {
      setIsSearchExpanded(true);
    }
  };

  const handleSearchSubmit = () => {
    props.onSearchSubmit?.(searchValue() as string);
  };

  return (
    <nav
      class={`fixed top-4 left-4 z-50 flex items-center gap-3 bg-[var(--color-bg-primary)] rounded-lg p-2 ${props.class || ""}`}
    >
      {/* brand icon with menu */}
      <KobalteNav>
        <KobalteNav.Menu>
          <KobalteNav.Trigger
            class="p-2 rounded-lg text-[var(--color-text-primary)] hover:text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 transition-colors border-none bg-transparent cursor-pointer"
            aria-label="menu"
          >
            <Icon name="freqhole" size={24} color="var(--color-accent-500)" />
          </KobalteNav.Trigger>

          <KobalteNav.Portal>
            <KobalteNav.Content class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-50 data-[expanded]:animate-in data-[closed]:animate-out">
              <div class="grid grid-cols-3 gap-6 min-w-[800px] max-h-[70vh]">
                {/* column 1: brand info + source management */}
                <div class="flex flex-col p-6">
                  <div class="space-y-3 mb-6">
                    <div>
                      <h3 class="text-lg font-bold text-[var(--color-accent-500)] m-0">
                        {props.brandName || "freqhole"}
                      </h3>
                      <Show when={props.brandTagline}>
                        <p class="text-xs text-[var(--color-text-muted)] m-0 mt-1">
                          {props.brandTagline}
                        </p>
                      </Show>
                    </div>
                    <Show when={props.version}>
                      <div class="px-2 py-1 bg-[var(--color-bg-tertiary)] rounded text-xs text-[var(--color-text-muted)] inline-block">
                        {props.version}
                      </div>
                    </Show>
                  </div>

                  {/* source selector */}
                  <div class="mb-4">
                    <h4 class="text-xs text-[var(--color-text-muted)] uppercase tracking-wide font-medium m-0 mb-2">
                      music source
                    </h4>
                    <div class="space-y-1">
                      {/* local library option */}
                      <button
                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded transition-colors border-none bg-transparent"
                        classList={{
                          "text-[var(--color-text-primary)] bg-[var(--color-accent-500)]/10 cursor-default":
                            props.currentSourceName === "local library" ||
                            !props.currentSourceName,
                          "text-[var(--color-text-secondary)] cursor-pointer hover:bg-[var(--color-accent-500)]/10":
                            props.currentSourceName &&
                            props.currentSourceName !== "local library",
                        }}
                        disabled={
                          props.currentSourceName === "local library" ||
                          !props.currentSourceName
                        }
                        onClick={() => props.onSwitchToLocal?.()}
                      >
                        <Show
                          when={
                            props.currentSourceName === "local library" ||
                            !props.currentSourceName
                          }
                          fallback={
                            <span class="w-2 h-2 rounded-full bg-[var(--color-accent-primary)]" />
                          }
                        >
                          <Icon
                            name="check"
                            size={14}
                            color="var(--color-accent-500)"
                          />
                        </Show>
                        <span>local library</span>
                      </button>

                      {/* remote sources */}
                      <Show when={props.remotes && props.remotes.length > 0}>
                        <div class="pt-1 border-t border-[var(--color-border-subtle)] mt-2">
                          <For each={props.remotes}>
                            {(remote) => (
                              <button
                                class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded transition-colors border-none bg-transparent"
                                classList={{
                                  "text-[var(--color-text-primary)] bg-[var(--color-accent-500)]/10 cursor-default":
                                    props.currentSourceName === remote.name,
                                  "text-[var(--color-text-secondary)] cursor-pointer hover:bg-[var(--color-accent-500)]/10":
                                    props.currentSourceName !== remote.name,
                                }}
                                disabled={
                                  props.currentSourceName === remote.name
                                }
                                onClick={() =>
                                  props.onSwitchToRemote?.(remote.id)
                                }
                              >
                                <Show
                                  when={props.currentSourceName === remote.name}
                                  fallback={
                                    <span class="w-2 h-2 rounded-full bg-[var(--color-status-success)]" />
                                  }
                                >
                                  <Icon
                                    name="check"
                                    size={14}
                                    color="var(--color-accent-500)"
                                  />
                                </Show>
                                <span class="truncate">{remote.name}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>

                      {/* add remote button */}
                      <button
                        class="w-full px-3 py-2 text-left text-sm text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors border-none bg-transparent cursor-pointer flex items-center gap-2 mt-2"
                        onClick={() => props.onAddRemote?.()}
                      >
                        <span>+</span>
                        <span>add remote server</span>
                      </button>
                    </div>
                  </div>

                  <div class="mt-auto space-y-1 pt-4 border-t border-[var(--color-border-subtle)]">
                    <For each={props.mainNavSections.slice(1)}>
                      {(section) => (
                        <For each={section.items}>
                          {(item) => (
                            <button
                              class="w-full px-3 py-2 text-left text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors border-none bg-transparent cursor-pointer disabled:opacity-50"
                              disabled={item.disabled}
                              onClick={item.onClick}
                            >
                              {item.label}
                            </button>
                          )}
                        </For>
                      )}
                    </For>
                  </div>
                </div>

                {/* column 2: main navigation */}
                <div class="border-l border-r border-[var(--color-border-subtle)] p-6">
                  <KobalteNav.Group>
                    <div class="space-y-1">
                      <For each={props.mainNavSections[0].items}>
                        {(item) => (
                          <KobalteNav.Item
                            class="w-full px-3 py-2 flex items-center text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed data-[highlighted]:bg-[var(--color-accent-500)]/10"
                            disabled={item.disabled}
                            closeOnSelect={true}
                            onSelect={item.onClick}
                          >
                            {item.label}
                          </KobalteNav.Item>
                        )}
                      </For>
                    </div>
                  </KobalteNav.Group>
                </div>

                {/* column 3: recent playlists */}
                <div class="flex flex-col p-6">
                  <h4 class="text-xs text-[var(--color-text-muted)] uppercase tracking-wide font-medium m-0 mb-3">
                    recent playlists
                  </h4>
                  <KobalteNav.Group>
                    <div class="flex-1 space-y-1 overflow-y-auto min-h-0">
                      <Show when={props.recentPlaylists?.length}>
                        <For each={props.recentPlaylists}>
                          {(playlist) => (
                            <KobalteNav.Item
                              class="w-full px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors cursor-pointer truncate data-[highlighted]:bg-[var(--color-accent-500)]/10"
                              closeOnSelect={true}
                              onSelect={playlist.onClick}
                            >
                              {playlist.name}
                            </KobalteNav.Item>
                          )}
                        </For>
                      </Show>
                      <Show when={!props.recentPlaylists?.length}>
                        <div class="text-xs text-[var(--color-text-muted)] px-3 py-2">
                          no recent playlists
                        </div>
                      </Show>
                    </div>
                  </KobalteNav.Group>

                  <div class="flex gap-2 pt-3 mt-3 border-t border-[var(--color-border-subtle)]">
                    <button
                      class="flex-1 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors border-none bg-transparent cursor-pointer"
                      onClick={() => {
                        props.onViewAllPlaylists?.();
                      }}
                    >
                      view all
                    </button>
                    <button
                      class="flex-1 px-3 py-1.5 text-xs text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors border-none bg-transparent cursor-pointer font-medium"
                      onClick={() => {
                        props.onCreatePlaylist?.();
                      }}
                    >
                      + create
                    </button>
                  </div>
                </div>
              </div>
            </KobalteNav.Content>
          </KobalteNav.Portal>
        </KobalteNav.Menu>

        <KobalteNav.Viewport />
      </KobalteNav>

      {/* search */}
      <div class="flex items-center gap-2">
        <Show
          when={isSearchExpanded() || searchValue()}
          fallback={
            <IconButton
              icon="search"
              aria-label="search"
              onClick={handleSearchToggle}
              variant="ghost"
            />
          }
        >
          <div class="flex items-center gap-2 transition-all duration-300">
            <SearchInput
              placeholder={props.searchPlaceholder || "search..."}
              onInputChange={handleSearchChange}
              onSelect={(suggestion) => {
                if (suggestion) {
                  handleSearchChange(suggestion.text);
                  handleSearchSubmit();
                }
              }}
              class="w-64"
            />
            <Show when={!searchValue()}>
              <IconButton
                icon="close"
                aria-label="close search"
                onClick={handleSearchToggle}
                variant="ghost"
              />
            </Show>
          </div>
        </Show>
      </div>
    </nav>
  );
}
