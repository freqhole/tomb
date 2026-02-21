import { NavigationMenu as KobalteNav } from "@kobalte/core/navigation-menu";
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Icon } from "../icons/registry";
import { TopNavSearchContainer } from "../../utils/TopNavSearchContainer";
import MediaImage from "../media/MediaImage";
import { TopNavMobile } from "./TopNavMobile";
import { ViewSelector, type ViewOption } from "./ViewSelector";
import { getPageInfo } from "../../app/services/pageInfo";
import { Badge } from "../badges/Badge";
import type { ImageMetadata } from "../../music/services/storage/types";
import { routes } from "../../music/utils/routing";
import { canUploadMusic, canCreatePlaylist } from "../../music/data/permissions";
import { formatRelativeTime } from "../../utils/dateTime";

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
  /** structured image metadata array (preferred) */
  images?: ImageMetadata[];
  /** playlist thumbnail url (legacy, for backward compatibility) */
  thumbnailUrl?: string | null;
  thumbnailBlobId?: string | null;
  /** timestamp when playlist was last updated */
  updatedAt: number;
  /** callback when clicked */
  onClick: () => void;
}

export interface TopNavProps {
  /** brand name */
  brandName?: string;
  /** brand tagline/description */
  brandTagline?: string;
  /** current authenticated user name (for remote sources) */
  currentUsername?: string | null;
  /** current authenticated user role (for remote sources) */
  currentUserRole?: string | null;
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
  /** callback for navigation (optional - if not provided, search navigation is disabled) */
  onNavigate?: (path: string) => void;
  /** current pathname for search filtering logic */
  currentPath?: string;
  /** current source name (e.g. "local library" or remote name) */
  currentSourceName?: string;
  /** available remote sources */
  remotes?: Array<{ id: string; name: string; url: string; imageUrl?: string }>;
  /** callback to switch to local source */
  onSwitchToLocal?: () => void;
  /** callback to switch to a remote source */
  onSwitchToRemote?: (remoteId: string) => void;
  /** callback to add a new remote */
  onAddRemote?: () => void;
  /** browser storage usage in bytes */
  storageUsage?: number;
  /** browser storage quota in bytes */
  storageQuota?: number;
  /** additional content to render on the right side of the nav bar */
  rightContent?: JSX.Element;
  /** custom search component (optional - if not provided, uses TopNavSearchContainer) */
  searchComponent?: JSX.Element;
  /** whether queue drawer is open */
  queueOpen?: boolean;
  /** callback to toggle queue drawer */
  onQueueToggle?: () => void;
  /** number of items in queue (for badge) */
  queueLength?: number;
  /** page title to show in nav bar (e.g. "songs", "playlists") */
  pageTitle?: string;
  /** page item count to show with title */
  pageCount?: number;
  /** view options for the view selector flyout */
  viewOptions?: ViewOption[];
  /** callback for add music action */
  onAddMusic?: () => void;
  /** additional classes */
  class?: string;
}

// compact top nav with brand icon + search, 3-column flyout menu
export function TopNav(props: TopNavProps) {
  // responsive: track if viewport is narrow (< 768px)
  const NARROW_BREAKPOINT = 768;
  const [isNarrow, setIsNarrow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false
  );
  const [mobileMenuOpen, setMobileMenuOpen] = createSignal(false);
  const [searchExpanded, setSearchExpanded] = createSignal(false);
  const [sortOpen, setSortOpen] = createSignal(false);
  const [sortLocked, setSortLocked] = createSignal(false);
  const [tagOpen, setTagOpen] = createSignal(false);
  const [tagLocked, setTagLocked] = createSignal(false);
  const [feedFilterOpen, setFeedFilterOpen] = createSignal(false);
  const [feedFilterLocked, setFeedFilterLocked] = createSignal(false);
  const [navHovered, setNavHovered] = createSignal(false);
  let sortCloseTimeout: ReturnType<typeof setTimeout> | undefined;
  let tagCloseTimeout: ReturnType<typeof setTimeout> | undefined;
  let feedFilterCloseTimeout: ReturnType<typeof setTimeout> | undefined;

  // derived state from pageInfo store
  const info = () => getPageInfo();
  const isNonDefaultSort = () => {
    const i = info();
    if (!i.sortFields?.length) return false;
    return i.sortBy !== i.defaultSortBy || i.sortDirection !== i.defaultSortDirection;
  };
  const hasActiveTags = () => (info().selectedTagFilters?.length || 0) > 0;
  const hasActiveFeedFilters = () =>
    (info().selectedFeedTypes?.length || 0) > 0 || info().myItemsOnly;
  const unselectedTags = () => {
    const i = info();
    if (!i.availableTags?.length) return [];
    const selected = new Set((i.selectedTagFilters || []).map((f) => f.tag));
    return i.availableTags.filter((t) => !selected.has(t.value));
  };

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
      // close mobile menu if viewport becomes wide
      if (window.innerWidth >= NARROW_BREAKPOINT) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  // format bytes to human readable size
  const formatBytes = (bytes: number | undefined): string => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // calculate storage percentage
  const storagePercent = () => {
    if (!props.storageUsage || !props.storageQuota) return 0;
    return Math.round((props.storageUsage / props.storageQuota) * 100);
  };

  // get current remote for image + url
  const currentRemote = () => {
    if (!props.remotes || !props.currentSourceName) return null;
    return props.remotes.find((r) => r.name === props.currentSourceName) ?? null;
  };

  return (
    <>
      {/* mobile menu overlay - slides from top */}
      <Show when={isNarrow()}>
        <TopNavMobile
          isOpen={mobileMenuOpen()}
          onClose={() => setMobileMenuOpen(false)}
          brandName={props.brandName}
          brandTagline={props.brandTagline}
          currentUsername={props.currentUsername}
          currentUserRole={props.currentUserRole}
          version={props.version}
          currentSourceName={props.currentSourceName}
          remotes={props.remotes}
          onSwitchToLocal={props.onSwitchToLocal}
          onSwitchToRemote={props.onSwitchToRemote}
          onAddRemote={props.onAddRemote}
          mainNavSections={props.mainNavSections}
          storageUsage={props.storageUsage}
          storageQuota={props.storageQuota}
          recentPlaylists={props.recentPlaylists}
          onViewAllPlaylists={props.onViewAllPlaylists}
          onCreatePlaylist={props.onCreatePlaylist}
          onNavigate={props.onNavigate}
          onAddMusic={props.onAddMusic}
        />
      </Show>

      <nav
        class={`flex flex-col z-[1000] ${props.class || ""}`}
        classList={{
          // narrow: full-width fixed strip at top
          "fixed top-0 left-0 right-0 bg-black/95 backdrop-blur-sm px-3 py-2 border-b border-white/10":
            isNarrow(),
          // wide: fixed top-left floating element, doesn't push content
          "fixed top-2 left-6 bg-black/20 backdrop-blur-sm px-2 py-1.5 rounded-lg border border-white/10 shadow-lg":
            !isNarrow(),
        }}
        style={{ height: isNarrow() ? "var(--nav-height, 56px)" : "auto" }}
        onMouseEnter={() => setNavHovered(true)}
        onMouseLeave={() => setNavHovered(false)}
      >
        <div class="flex items-center gap-3">
          {/* back button + menu trigger - only rendered on narrow */}
          <Show when={isNarrow()}>
            <button
              class="p-1 rounded-lg text-white hover:bg-white/10 transition-colors border-none bg-transparent cursor-pointer"
              classList={{ "bg-white/10": mobileMenuOpen() }}
              aria-label="menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen())}
            >
              <Show
                when={currentRemote()}
                fallback={<Icon name="freqhole" size={24} color="var(--color-accent-500)" />}
              >
                {(remote) => (
                  <MediaImage
                    imageUrl={remote().imageUrl ? `${remote().url}${remote().imageUrl}` : null}
                    alt=""
                    class="w-7 h-7 rounded object-cover flex-shrink-0"
                  />
                )}
              </Show>
            </button>
          </Show>

          {/* desktop menu - kobalte navigation, only rendered on wide */}
          <Show when={!isNarrow()}>
            <KobalteNav>
              <KobalteNav.Menu>
                <KobalteNav.Trigger
                  class="p-1 rounded-lg text-white hover:bg-white/10 transition-colors border-none bg-transparent cursor-pointer"
                  aria-label="menu"
                >
                  <Show
                    when={currentRemote()}
                    fallback={<Icon name="freqhole" size={24} color="var(--color-accent-500)" />}
                  >
                    {(remote) => (
                      <MediaImage
                        imageUrl={remote().imageUrl ? `${remote().url}${remote().imageUrl}` : null}
                        alt=""
                        class="w-7 h-7 rounded object-cover flex-shrink-0"
                      />
                    )}
                  </Show>
                </KobalteNav.Trigger>

                <KobalteNav.Portal>
                  <KobalteNav.Content class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-[1001] data-[expanded]:animate-in data-[closed]:animate-out">
                    <div class="grid grid-cols-2 gap-6 min-w-[560px] max-h-[70dvh]">
                      {/* column 1: brand info + source management */}
                      <div class="flex flex-col p-6">
                        <div class="flex items-start justify-between mb-6">
                          <div class="space-y-3">
                            <div>
                              <h3 class="text-lg font-bold m-0">
                                <span>freqh</span>
                                <Icon
                                  name="freqhole"
                                  size={24}
                                  color="var(--color-accent-500)"
                                  className="inline"
                                />
                                <span>le</span>
                              </h3>
                              <Show
                                when={props.currentUsername && props.currentUserRole}
                                fallback={
                                  <Show when={props.brandTagline}>
                                    <p class="text-xs text-[var(--color-text-muted)] m-0 mt-1">
                                      {props.brandTagline}
                                    </p>
                                  </Show>
                                }
                              >
                                <div class="flex items-center gap-2 mt-1">
                                  <span class="text-xs text-[var(--color-text-secondary)]">
                                    {props.currentUsername}
                                  </span>
                                  <Badge variant="default" size="sm">
                                    {props.currentUserRole}
                                  </Badge>
                                </div>
                              </Show>
                            </div>
                            <Show when={props.version}>
                              <div class="px-2 py-1 bg-[var(--color-bg-tertiary)] rounded text-xs text-[var(--color-text-muted)] inline-block">
                                {props.version}
                              </div>
                            </Show>
                          </div>
                          <Show when={props.onAddMusic && canUploadMusic()}>
                            <button
                              class="px-3 py-1.5 text-xs text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors border border-[var(--color-accent-500)]/30 bg-transparent cursor-pointer font-medium whitespace-nowrap"
                              onClick={() => props.onAddMusic?.()}
                            >
                              add music
                            </button>
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
                                  !!props.currentSourceName &&
                                  props.currentSourceName !== "local library",
                              }}
                              disabled={
                                !!(
                                  props.currentSourceName === "local library" ||
                                  !props.currentSourceName
                                )
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
                                <Icon name="check" size={14} color="var(--color-accent-500)" />
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
                                      disabled={props.currentSourceName === remote.name}
                                      onClick={() => props.onSwitchToRemote?.(remote.id)}
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
                                      <MediaImage
                                        imageUrl={
                                          remote.imageUrl ? `${remote.url}${remote.imageUrl}` : null
                                        }
                                        alt=""
                                        class="w-4 h-4 rounded object-cover flex-shrink-0"
                                      />
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

                          {/* storage usage */}
                          <Show
                            when={
                              props.storageUsage !== undefined && props.storageQuota !== undefined
                            }
                          >
                            <button
                              class="w-full flex items-center gap-2 px-3 py-2 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] text-xs text-left transition-colors border-none cursor-pointer"
                              onClick={() => props.onNavigate?.(routes.settingsStorage())}
                            >
                              <Icon name="database" size={14} />
                              <div class="flex flex-col">
                                <span class="text-[var(--color-text-secondary)]">
                                  {formatBytes(props.storageUsage)} /{" "}
                                  {formatBytes(props.storageQuota)}
                                </span>
                                <span class="text-[var(--color-text-tertiary)]">
                                  {storagePercent()}% used
                                </span>
                              </div>
                            </button>
                          </Show>
                        </div>
                      </div>

                      {/* column 2: recent playlists */}
                      <div class="flex flex-col p-6 border-l border-[var(--color-border-subtle)]">
                        <h4 class="text-xs text-[var(--color-text-muted)] uppercase tracking-wide font-medium m-0 mb-3">
                          recent playlists
                        </h4>
                        <KobalteNav.Group>
                          <div class="flex-1 space-y-0.5 overflow-y-auto min-h-0">
                            <Show when={props.recentPlaylists?.length}>
                              <For each={props.recentPlaylists}>
                                {(playlist) => (
                                  <KobalteNav.Item
                                    class="w-full hover:bg-[var(--color-accent-500)]/10 rounded transition-colors cursor-pointer data-[highlighted]:bg-[var(--color-accent-500)]/10 flex items-center gap-2 px-2 py-1"
                                    style={{ "min-height": "0", height: "auto" }}
                                    closeOnSelect={true}
                                    onSelect={playlist.onClick}
                                  >
                                    <MediaImage
                                      images={playlist.images}
                                      imageUrl={playlist.thumbnailUrl || null}
                                      blobId={playlist.thumbnailBlobId}
                                      alt=""
                                      class="w-8 h-8 object-cover rounded flex-shrink-0"
                                      domainType="playlist"
                                    />
                                    <div class="flex-1 min-w-0">
                                      <div class="text-sm text-[var(--color-text-primary)] truncate">
                                        {playlist.name}
                                      </div>
                                      <div class="text-xs text-[var(--color-text-tertiary)]">
                                        {formatRelativeTime(playlist.updatedAt)}
                                      </div>
                                    </div>
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
                          <Show when={canCreatePlaylist()}>
                            <button
                              class="flex-1 px-3 py-1.5 text-xs text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 rounded transition-colors border-none bg-transparent cursor-pointer font-medium"
                              onClick={() => {
                                props.onCreatePlaylist?.();
                              }}
                            >
                              + create
                            </button>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </KobalteNav.Content>
                </KobalteNav.Portal>
              </KobalteNav.Menu>

              <KobalteNav.Viewport />
            </KobalteNav>

            {/* view selector flyout - desktop only */}
            <Show when={props.viewOptions?.length}>
              <ViewSelector
                views={props.viewOptions!}
                currentTitle={props.pageTitle}
                currentCount={props.pageCount}
                onNavigate={(path) => props.onNavigate?.(path)}
              />
            </Show>
          </Show>

          {/* search - grows to fill space */}
          <div class="flex-1">
            <Show
              when={props.searchComponent !== undefined}
              fallback={
                <TopNavSearchContainer
                  placeholder={props.searchPlaceholder}
                  onNavigate={props.onNavigate}
                  currentPath={props.currentPath}
                  onExpandedChange={setSearchExpanded}
                  navHovered={navHovered()}
                />
              }
            >
              {props.searchComponent}
            </Show>
          </div>

          {/* sort controls - desktop only, when view has sorting */}
          <Show when={!isNarrow() && info().sortFields?.length}>
            <div
              class="relative flex-shrink-0"
              onMouseEnter={() => {
                clearTimeout(sortCloseTimeout);
                if (!sortOpen()) setSortOpen(true);
              }}
              onMouseLeave={() => {
                if (sortLocked()) return;
                sortCloseTimeout = setTimeout(() => setSortOpen(false), 150);
              }}
            >
              <button
                class="p-1.5 rounded transition-colors border-none bg-transparent cursor-pointer"
                classList={{
                  "text-[var(--color-accent-500)]": isNonDefaultSort(),
                  "text-white/60 hover:text-white": !isNonDefaultSort(),
                }}
                onClick={() => {
                  if (sortOpen() && sortLocked()) {
                    setSortLocked(false);
                    setSortOpen(false);
                  } else {
                    setSortOpen(true);
                    setSortLocked(true);
                  }
                  setTagOpen(false);
                  setTagLocked(false);
                }}
                title="sort"
              >
                <Icon name="sort" size={16} />
              </button>
              <Show when={sortOpen()}>
                <div class="absolute top-full right-0 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-[1001] p-2 flex gap-1">
                  <select
                    value={info().sortBy || ""}
                    onChange={(e) => {
                      info().onSortChange?.(e.target.value, info().sortDirection || "desc");
                    }}
                    class="px-2 py-1.5 bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] text-xs rounded border border-[var(--color-border-default)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
                  >
                    <For each={info().sortFields}>
                      {(field) => (
                        <option value={field.value} title={field.description}>
                          {field.label}
                        </option>
                      )}
                    </For>
                  </select>
                  <button
                    onClick={() => {
                      const newDir = (info().sortDirection || "desc") === "asc" ? "desc" : "asc";
                      info().onSortChange?.(info().sortBy || "", newDir);
                    }}
                    class="px-2 py-1.5 bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] text-xs rounded border border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] transition-colors border-none cursor-pointer"
                    title={`sort ${(info().sortDirection || "desc") === "asc" ? "ascending" : "descending"} - click to toggle`}
                  >
                    {(info().sortDirection || "desc") === "asc" ? "\u2191" : "\u2193"}
                  </button>
                </div>
              </Show>
            </div>
          </Show>

          {/* tag filter icon - desktop only, when view has tags */}
          <Show when={!isNarrow() && info().availableTags?.length}>
            <div
              class="relative flex-shrink-0"
              onMouseEnter={() => {
                clearTimeout(tagCloseTimeout);
                if (!tagOpen()) setTagOpen(true);
              }}
              onMouseLeave={() => {
                if (tagLocked()) return;
                tagCloseTimeout = setTimeout(() => setTagOpen(false), 150);
              }}
            >
              <button
                class="p-1.5 rounded transition-colors border-none bg-transparent cursor-pointer"
                classList={{
                  "text-[var(--color-accent-500)]": hasActiveTags(),
                  "text-white/60 hover:text-white": !hasActiveTags(),
                }}
                onClick={() => {
                  if (tagOpen() && tagLocked()) {
                    setTagLocked(false);
                    setTagOpen(false);
                  } else {
                    setTagOpen(true);
                    setTagLocked(true);
                  }
                  setSortOpen(false);
                  setSortLocked(false);
                }}
                title="tag filters"
              >
                <Icon name="tag" size={16} />
              </button>
              <Show when={tagOpen()}>
                <div class="absolute top-full right-0 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-[1001] min-w-[200px] max-w-[320px]">
                  <div class="p-2">
                    <Show when={hasActiveTags()}>
                      <div class="border-b border-[var(--color-border-subtle)] pb-2 mb-2">
                        <button
                          onClick={() => {
                            info().onClearAllTags?.();
                          }}
                          class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded transition-colors"
                        >
                          clear all
                        </button>
                      </div>
                    </Show>
                    <Show when={info().tagsLoading}>
                      <div class="text-xs text-[var(--color-text-tertiary)] py-2 px-2">
                        loading tags...
                      </div>
                    </Show>
                    <Show when={!info().tagsLoading && unselectedTags().length === 0}>
                      <div class="text-xs text-[var(--color-text-tertiary)] py-2 px-2">
                        {(info().availableTags?.length || 0) === 0
                          ? "no tags available"
                          : "all tags selected"}
                      </div>
                    </Show>
                    <Show when={!info().tagsLoading && unselectedTags().length > 0}>
                      <div class="max-h-64 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--color-border-default)]">
                        <For each={unselectedTags()}>
                          {(tag) => (
                            <button
                              onClick={() => info().onAddTag?.(tag.value)}
                              class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded transition-colors flex items-center justify-between"
                            >
                              <span>{tag.label}</span>
                              <Show when={tag.count !== undefined}>
                                <span class="text-[var(--color-text-tertiary)] text-xs">
                                  ({tag.count})
                                </span>
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* feed type filter icon - when view has feed types */}
          <Show when={info().feedTypeOptions?.length}>
            <div
              class="relative flex-shrink-0"
              onMouseEnter={() => {
                clearTimeout(feedFilterCloseTimeout);
                if (!feedFilterOpen()) setFeedFilterOpen(true);
              }}
              onMouseLeave={() => {
                if (feedFilterLocked()) return;
                feedFilterCloseTimeout = setTimeout(() => setFeedFilterOpen(false), 150);
              }}
            >
              <button
                class="p-1.5 rounded transition-colors border-none bg-transparent cursor-pointer"
                classList={{
                  "text-[var(--color-accent-500)]": hasActiveFeedFilters() || feedFilterOpen(),
                  "text-white/60 hover:text-white": !hasActiveFeedFilters() && !feedFilterOpen(),
                }}
                onClick={() => {
                  if (feedFilterOpen() && feedFilterLocked()) {
                    setFeedFilterLocked(false);
                    setFeedFilterOpen(false);
                  } else {
                    setFeedFilterOpen(true);
                    setFeedFilterLocked(true);
                  }
                  setSortOpen(false);
                  setSortLocked(false);
                  setTagOpen(false);
                  setTagLocked(false);
                }}
                title="feed type filters"
              >
                <Icon name="filter" size={16} />
              </button>
              <Show when={feedFilterOpen()}>
                <div class="absolute top-full right-0 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-[1001] min-w-[180px]">
                  <div class="p-2">
                    <Show when={hasActiveFeedFilters()}>
                      <div class="border-b border-[var(--color-border-subtle)] pb-2 mb-2">
                        <button
                          onClick={() => info().onClearFeedTypes?.()}
                          class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded transition-colors"
                        >
                          show all types
                        </button>
                      </div>
                    </Show>
                    <For each={info().feedTypeOptions}>
                      {(option) => {
                        const isSelected = () =>
                          (info().selectedFeedTypes || []).some((f) => f.type === option.value);
                        return (
                          <button
                            onClick={() => info().onToggleFeedType?.(option.value)}
                            class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] rounded transition-colors flex items-center gap-2"
                            classList={{
                              "text-[var(--color-accent-500)]": isSelected(),
                              "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]":
                                !isSelected(),
                            }}
                          >
                            <span class="w-3 text-center">{isSelected() ? "\u2713" : ""}</span>
                            <span>{option.label}</span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* my items toggle - when view supports it */}
          <Show when={info().onToggleMyItems}>
            <button
              class="p-1.5 rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0"
              classList={{
                "text-[var(--color-accent-500)]": info().myItemsOnly,
                "text-white/60 hover:text-white": !info().myItemsOnly,
              }}
              onClick={() => info().onToggleMyItems?.()}
              title={info().myItemsOnly ? "showing my items only" : "showing all items"}
            >
              <Icon name="user" size={16} />
            </button>
          </Show>

          {/* back to top - shown after scroll threshold, after all filter controls */}
          <Show when={info().showBackToTop && info().onBackToTop}>
            <button
              class="p-1.5 rounded transition-all border-none bg-transparent cursor-pointer text-white/60 hover:text-white flex-shrink-0 animate-in fade-in duration-200"
              onClick={() => info().onBackToTop?.()}
              title="back to top"
            >
              <Icon name="chevronUp" size={16} />
            </button>
          </Show>

          {/* page title - only on narrow views, hidden when search is expanded */}
          <Show when={isNarrow() && props.pageTitle && !searchExpanded()}>
            <div class="flex-shrink-0 text-sm text-white/70 truncate max-w-[120px]">
              {props.pageTitle}
              <Show when={props.pageCount !== undefined}>
                <span class="text-white/40 ml-1">({props.pageCount})</span>
              </Show>
            </div>
          </Show>

          {/* right side: queue toggle - only on narrow views */}
          <Show when={isNarrow() && props.onQueueToggle}>
            <button
              class="p-2 rounded-lg hover:bg-white/10 transition-colors border-none bg-transparent cursor-pointer ml-auto relative"
              classList={{
                "text-[var(--color-accent-500)]": props.queueOpen,
                "text-white/70 hover:text-white": !props.queueOpen,
              }}
              aria-label={props.queueOpen ? "close queue" : "open queue"}
              onClick={props.onQueueToggle}
            >
              <Icon name="queue" size={20} />
              <Show when={(props.queueLength || 0) > 0}>
                <span class="absolute -top-0.5 -right-0.5 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center font-medium px-1">
                  {props.queueLength}
                </span>
              </Show>
            </button>
          </Show>
        </div>

        {/* selected tag badges - desktop only, below nav bar */}
        <Show when={!isNarrow() && hasActiveTags()}>
          <div class="flex gap-1.5 flex-wrap mt-1.5 px-1">
            <For each={info().selectedTagFilters}>
              {(filter) => (
                <button
                  onClick={() => info().onToggleTagMode?.(filter.tag)}
                  title={
                    filter.mode === "include"
                      ? `include: ${filter.tag} (click to exclude)`
                      : `exclude: ${filter.tag} (click to include)`
                  }
                  class="cursor-pointer hover:opacity-90 transition-opacity border-none bg-transparent p-0"
                >
                  <Badge
                    variant={filter.mode === "include" ? "success" : "error"}
                    size="sm"
                    removable={true}
                    onRemove={() => info().onRemoveTag?.(filter.tag)}
                  >
                    {filter.tag}
                  </Badge>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* selected feed type + my items badges - below nav bar */}
        <Show when={hasActiveFeedFilters()}>
          <div class="flex gap-1.5 flex-wrap mt-1.5 px-1">
            <For each={info().selectedFeedTypes}>
              {(filter) => {
                const label = () =>
                  info().feedTypeOptions?.find((o) => o.value === filter.type)?.label ??
                  filter.type;
                return (
                  <button
                    onClick={() => info().onToggleFeedTypeMode?.(filter.type)}
                    title={
                      filter.mode === "include"
                        ? `include: ${label()} (click to exclude)`
                        : `exclude: ${label()} (click to include)`
                    }
                    class="cursor-pointer hover:opacity-90 transition-opacity border-none bg-transparent p-0"
                  >
                    <Badge
                      variant={filter.mode === "include" ? "success" : "error"}
                      size="sm"
                      removable={true}
                      onRemove={() => info().onRemoveFeedType?.(filter.type)}
                    >
                      {label()}
                    </Badge>
                  </button>
                );
              }}
            </For>
            <Show when={info().myItemsOnly}>
              <Badge
                variant="accent"
                size="sm"
                removable={true}
                onRemove={() => info().onToggleMyItems?.()}
              >
                my items
              </Badge>
            </Show>
          </div>
        </Show>
      </nav>
    </>
  );
}
