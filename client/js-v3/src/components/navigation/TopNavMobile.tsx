import { For, Show, type JSX } from "solid-js";
import { Icon } from "../icons/registry";
import MediaImage from "../media/MediaImage";

// re-export shared types
export type { NavMenuItem, NavMenuSection, RecentPlaylist } from "./TopNav";

export interface TopNavMobileProps {
  /** whether menu is open */
  isOpen: boolean;
  /** callback to close menu */
  onClose: () => void;
  /** brand name */
  brandName?: string;
  /** brand tagline/description */
  brandTagline?: string;
  /** version text */
  version?: string;
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
  /** main navigation menu sections */
  mainNavSections: Array<{
    items: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  }>;
  /** browser storage usage in bytes */
  storageUsage?: number;
  /** browser storage quota in bytes */
  storageQuota?: number;
  /** recent playlists */
  recentPlaylists?: Array<{
    id: string;
    name: string;
    images?: import("../../music/services/storage/types").ImageMetadata[];
    thumbnailUrl?: string | null;
    thumbnailBlobId?: string | null;
    updatedAt: number;
    onClick: () => void;
  }>;
  /** callback for view all playlists */
  onViewAllPlaylists?: () => void;
  /** callback for create playlist */
  onCreatePlaylist?: () => void;
  /** callback for navigation (optional) */
  onNavigate?: (path: string) => void;
}

/** format bytes to human readable */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** format timestamp to relative time */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * mobile navigation menu overlay
 *
 * slides down from top of screen on narrow viewports.
 * contains: brand info, source selector, navigation links, recent playlists, storage stats
 */
export function TopNavMobile(props: TopNavMobileProps) {
  // helper to close menu after action
  const handleMenuItemClick = (callback?: () => void) => {
    props.onClose();
    callback?.();
  };

  // calculate storage percentage
  const storagePercent = () => {
    if (!props.storageUsage || !props.storageQuota) return 0;
    return Math.round((props.storageUsage / props.storageQuota) * 100);
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-[60]">
        {/* backdrop */}
        <div class="absolute inset-0 bg-black/80" onClick={() => props.onClose()} />
        {/* menu panel - slides from top, full width */}
        <div
          class="absolute top-[var(--nav-height,56px)] left-0 right-0 bg-black/95 backdrop-blur-sm border-b border-white/10 overflow-y-auto animate-in slide-in-from-top duration-200"
          style={{ "max-height": "calc(100vh - var(--player-height) - var(--nav-height, 56px))" }}
        >
          {/* mobile menu content */}
          <div class="flex flex-col gap-0">
            {/* section 1: brand info + source management */}
            <div class="flex flex-col p-3 border-b border-white/10">
              <div class="space-y-2 mb-4">
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
                  <Show when={props.brandTagline}>
                    <p class="text-xs text-white/50 m-0 mt-1">{props.brandTagline}</p>
                  </Show>
                </div>
                <Show when={props.version}>
                  <div class="px-2 py-1 bg-white/10 rounded text-xs text-white/50 inline-block">
                    {props.version}
                  </div>
                </Show>
              </div>

              {/* source selector */}
              <div class="mb-3">
                <h4 class="text-xs text-[var(--color-text-muted)] uppercase tracking-wide font-medium m-0 mb-2">
                  music source
                </h4>
                <div class="space-y-1">
                  {/* local library option */}
                  <button
                    class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded transition-colors border-none bg-transparent"
                    classList={{
                      "text-white bg-white/10 cursor-default":
                        props.currentSourceName === "local library" || !props.currentSourceName,
                      "text-white/70 cursor-pointer hover:bg-white/10 hover:text-white":
                        props.currentSourceName && props.currentSourceName !== "local library",
                    }}
                    disabled={
                      props.currentSourceName === "local library" || !props.currentSourceName
                    }
                    onClick={() => handleMenuItemClick(() => props.onSwitchToLocal?.())}
                  >
                    <Show
                      when={props.currentSourceName === "local library" || !props.currentSourceName}
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
                    <div class="pt-1 border-t border-white/10 mt-2">
                      <For each={props.remotes}>
                        {(remote) => (
                          <button
                            class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded transition-colors border-none bg-transparent"
                            classList={{
                              "text-white bg-white/10 cursor-default":
                                props.currentSourceName === remote.name,
                              "text-white/70 cursor-pointer hover:bg-white/10 hover:text-white":
                                props.currentSourceName !== remote.name,
                            }}
                            disabled={props.currentSourceName === remote.name}
                            onClick={() =>
                              handleMenuItemClick(() => props.onSwitchToRemote?.(remote.id))
                            }
                          >
                            <Show
                              when={props.currentSourceName === remote.name}
                              fallback={
                                <span class="w-2 h-2 rounded-full bg-[var(--color-status-success)]" />
                              }
                            >
                              <Icon name="check" size={14} color="var(--color-accent-500)" />
                            </Show>
                            <MediaImage
                              imageUrl={remote.imageUrl ? `${remote.url}${remote.imageUrl}` : null}
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
                    class="w-full px-3 py-2 text-left text-sm text-[var(--color-accent-500)] hover:bg-white/10 rounded transition-colors border-none bg-transparent cursor-pointer flex items-center gap-2 mt-2"
                    onClick={() => handleMenuItemClick(() => props.onAddRemote?.())}
                  >
                    <span>+</span>
                    <span>add remote server</span>
                  </button>
                </div>
              </div>
            </div>

            {/* section 2: main navigation */}
            <div class="border-b border-white/10 p-3">
              <div class="space-y-1">
                <For each={props.mainNavSections[0]?.items}>
                  {(item) => (
                    <button
                      class="w-full px-3 py-2 flex items-center text-sm text-white hover:bg-white/10 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-none bg-transparent"
                      disabled={item.disabled}
                      onClick={() => handleMenuItemClick(item.onClick)}
                    >
                      {item.label}
                    </button>
                  )}
                </For>
              </div>

              {/* secondary nav items */}
              <Show when={props.mainNavSections.length > 1}>
                <div class="space-y-1 pt-3 mt-3 border-t border-white/10">
                  <For each={props.mainNavSections.slice(1)}>
                    {(section) => (
                      <For each={section.items}>
                        {(item) => (
                          <button
                            class="w-full px-3 py-2 text-left text-sm text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors border-none bg-transparent cursor-pointer disabled:opacity-50"
                            disabled={item.disabled}
                            onClick={() => handleMenuItemClick(item.onClick)}
                          >
                            {item.label}
                          </button>
                        )}
                      </For>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* section 3: recent playlists */}
            <div class="flex flex-col p-3">
              <h4 class="text-xs text-white/50 uppercase tracking-wide font-medium m-0 mb-2">
                recent playlists
              </h4>
              <div class="flex-1 space-y-1 min-h-0">
                <Show when={props.recentPlaylists?.length}>
                  <For each={props.recentPlaylists}>
                    {(playlist) => (
                      <button
                        class="w-full px-3 py-2 hover:bg-white/10 rounded transition-colors cursor-pointer border-none bg-transparent text-left"
                        onClick={() => handleMenuItemClick(playlist.onClick)}
                      >
                        <div class="flex items-center gap-2">
                          <MediaImage
                            images={playlist.images}
                            imageUrl={playlist.thumbnailUrl || null}
                            blobId={playlist.thumbnailBlobId}
                            alt=""
                            class="w-10 h-10 object-cover rounded flex-shrink-0"
                            domainType="playlist"
                          />
                          <div class="flex-1 min-w-0">
                            <div class="text-sm text-white truncate">{playlist.name}</div>
                            <div class="text-xs text-white/50">
                              {formatRelativeTime(playlist.updatedAt)}
                            </div>
                          </div>
                        </div>
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={!props.recentPlaylists?.length}>
                  <div class="text-xs text-white/50 px-3 py-2">no recent playlists</div>
                </Show>
              </div>

              <div class="flex gap-2 pt-3 mt-3 border-t border-white/10">
                <button
                  class="flex-1 px-3 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors border-none bg-transparent cursor-pointer"
                  onClick={() => handleMenuItemClick(() => props.onViewAllPlaylists?.())}
                >
                  view all
                </button>
                <button
                  class="flex-1 px-3 py-1.5 text-xs text-[var(--color-accent-500)] hover:bg-white/10 rounded transition-colors border-none bg-transparent cursor-pointer font-medium"
                  onClick={() => handleMenuItemClick(() => props.onCreatePlaylist?.())}
                >
                  + create
                </button>
              </div>
            </div>

            {/* storage stats - at bottom, clickable to settings */}
            <Show when={props.storageUsage !== undefined && props.storageQuota !== undefined}>
              <div class="p-3 border-t border-white/10">
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 rounded bg-white/5 hover:bg-white/10 text-xs text-left transition-colors border-none cursor-pointer"
                  onClick={() => handleMenuItemClick(() => props.onNavigate?.("/settings/storage"))}
                >
                  <Icon name="database" size={14} color="white" />
                  <div class="flex flex-col">
                    <span class="text-white/70">
                      {formatBytes(props.storageUsage)} / {formatBytes(props.storageQuota)}
                    </span>
                    <span class="text-white/50">{storagePercent()}% used</span>
                  </div>
                  <span class="ml-auto text-white/40">settings</span>
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
