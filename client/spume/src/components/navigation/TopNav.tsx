import { NavigationMenu as KobalteNav } from "@kobalte/core/navigation-menu";
import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { getLocalNodeId, isCharnelMode } from "../../app/services/charnel";
import { getPageInfo } from "../../app/services/pageInfo";
import { isNarrowViewport } from "../../config/breakpoints";
import { canCreatePlaylist, canUploadMusic } from "../../music/data/permissions";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import type { ImageMetadata } from "../../music/services/storage/types";
import { routes } from "../../music/utils/routing";
import { formatRelativeTime } from "../../utils/dateTime";
import { DEFAULT_SHARE_WEB_HOST } from "../../utils/permalink";
import { TopNavSearchContainer } from "../../utils/TopNavSearchContainer";
import { Badge } from "../badges/Badge";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import { toast } from "../feedback/Toast";
import { Icon } from "../icons/registry";
import MediaImage from "../media/MediaImage";
import { QrCodeModal } from "../modals/QrCodeModal";
import { type MenuAction } from "../overlays/ContextMenu";
import { ViewSelector, type ViewOption } from "./ViewSelector";

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
  /** current source id (remote_id if connected to remote, null for local) */
  currentSourceId?: string | null;
  /** available remote sources */
  remotes?: Array<{
    id: string;
    name: string;
    url: string;
    imageUrl?: string;
    imageBlobId?: string | null;
    peerAddr?: string;
    isOffline?: boolean;
    lastChecked?: number | null;
    isCharnelManaged?: boolean;
    isLocal?: boolean;
    updatedAt?: number;
  }>;
  /** callback to switch to local source */
  onSwitchToLocal?: () => void;
  /** callback to switch to a remote source */
  onSwitchToRemote?: (remoteId: string) => void;
  /** callback to recheck remote status and switch if online */
  onRecheckRemote?: (remoteId: string) => Promise<boolean>;
  /** callback to add a new remote */
  onAddRemote?: () => void;
  /** callback to delete a remote */
  onDeleteRemote?: (remoteId: string) => Promise<void> | void;
  /** browser storage usage in bytes */
  storageUsage?: number;
  /** browser storage quota in bytes */
  storageQuota?: number;
  /** additional content to render on the right side of the nav bar */
  rightContent?: JSX.Element;
  /** custom search component (optional - if not provided, uses TopNavSearchContainer) */
  searchComponent?: JSX.Element;
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

// remote type used internally
type RemoteItem = NonNullable<TopNavProps["remotes"]>[number];

// component to render remote server images (handles P2P blob resolution)
function RemoteServerImage(props: { remote: RemoteItem; class?: string; alt?: string }) {
  const [loadError, setLoadError] = createSignal(false);
  const isP2P = () => !!props.remote.peerAddr;

  // resolve P2P blob URL asynchronously
  const [resolvedP2PUrl] = createResource(
    () =>
      isP2P() && props.remote.imageBlobId
        ? { blobId: props.remote.imageBlobId, remoteId: props.remote.id }
        : null,
    async (params) => {
      if (!params) return null;
      try {
        return await resolveBlobUrl(params.blobId, params.remoteId);
      } catch (e) {
        return null;
      }
    }
  );

  // for HTTP remotes, use direct URL with cache-busting based on updatedAt
  const httpImageUrl = () => {
    if (isP2P()) return null;
    if (!props.remote.imageUrl) {
      return null;
    }
    // if imageUrl is already absolute (asset://, http://, https://), use directly
    if (
      props.remote.imageUrl.startsWith("asset://") ||
      props.remote.imageUrl.startsWith("http://") ||
      props.remote.imageUrl.startsWith("https://")
    ) {
      const url = props.remote.updatedAt
        ? `${props.remote.imageUrl}?v=${props.remote.updatedAt}`
        : props.remote.imageUrl;
      return url;
    }
    // relative URL - prepend base URL
    if (!props.remote.url) {
      return null;
    }
    const baseUrl = `${props.remote.url}${props.remote.imageUrl}`;
    const url = props.remote.updatedAt ? `${baseUrl}?v=${props.remote.updatedAt}` : baseUrl;
    return url;
  };

  const imageUrl = () => {
    const url = isP2P() ? resolvedP2PUrl() : httpImageUrl();
    return url;
  };

  // fallback icon component
  const FallbackIcon = () => (
    <div
      class={`bg-[var(--color-bg-tertiary)] flex items-center justify-center ${props.class || ""}`}
      style={{ "min-width": "28px", "min-height": "28px" }}
    >
      <Icon name="freqhole" size={16} color="var(--color-accent-500)" />
    </div>
  );

  return (
    <Show when={imageUrl() && !loadError()} fallback={<FallbackIcon />}>
      <Show
        when={!resolvedP2PUrl.loading}
        fallback={
          <div
            class={`bg-[var(--color-bg-tertiary)] flex items-center justify-center animate-pulse ${props.class || ""}`}
            style={{ "min-width": "28px", "min-height": "28px" }}
          >
            <Icon
              name="freqhole"
              size={16}
              color="var(--color-accent-500)"
              className="opacity-50"
            />
          </div>
        }
      >
        <img
          src={imageUrl()!}
          alt={props.alt || ""}
          class={props.class}
          style={{ "min-width": "28px", "min-height": "28px" }}
          onError={() => {
            setLoadError(true);
          }}
          onLoad={() => {
            setLoadError(false);
          }}
        />
      </Show>
    </Show>
  );
}

// per-row actions menu — a `...` icon button that toggles a small popup
// with the supplied actions. used in the source-selector flyout to expose
// copy / qr / delete options per remote.
function RowActionsMenu(props: {
  actions: MenuAction[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  let menuRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  // close on outside click
  const handleDocClick = (e: MouseEvent) => {
    const target = e.target as Node;
    if (menuRef?.contains(target)) return;
    if (triggerRef?.contains(target)) return;
    props.onClose();
  };

  createEffect(() => {
    if (props.isOpen) {
      document.addEventListener("mousedown", handleDocClick, true);
      onCleanup(() => document.removeEventListener("mousedown", handleDocClick, true));
    }
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class="flex-shrink-0 px-2 py-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] border-none bg-transparent cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          props.onToggle();
        }}
        aria-label="row actions"
        title="more"
      >
        <Icon name="more" size={16} />
      </button>
      <Show when={props.isOpen}>
        <div
          ref={menuRef}
          class="absolute right-0 top-full mt-1 z-[1300] min-w-[10rem] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl overflow-hidden py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <For each={props.actions}>
            {(action) => {
              if (action.type === "separator") {
                return <div class="my-1 h-px bg-[var(--color-border-subtle)]" />;
              }
              return (
                <button
                  type="button"
                  class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-none bg-transparent cursor-pointer transition-colors ${
                    action.disabled
                      ? "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50"
                      : action.destructive
                        ? "text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-white"
                        : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                  }`}
                  disabled={action.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (action.disabled) return;
                    props.onClose();
                    action.onClick();
                  }}
                >
                  <Show when={action.icon}>
                    <Icon name={action.icon!} size={14} color="currentColor" />
                  </Show>
                  <span>{action.label}</span>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </>
  );
}

// compact top nav with brand icon + search, responsive flyout menu
export function TopNav(props: TopNavProps) {
  // responsive: track viewport sizes
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());

  // narrow viewport gets bigger touch-friendly icon buttons
  const iconBtnPad = () => (isNarrow() ? "p-2.5" : "p-1.5");
  const iconBtnSize = () => (isNarrow() ? 22 : 16);
  const [searchExpanded, setSearchExpanded] = createSignal(false);
  const [sortOpen, setSortOpen] = createSignal(false);
  const [sortLocked, setSortLocked] = createSignal(false);
  const [tagOpen, setTagOpen] = createSignal(false);
  const [tagLocked, setTagLocked] = createSignal(false);
  const [feedFilterOpen, setFeedFilterOpen] = createSignal(false);
  const [feedFilterLocked, setFeedFilterLocked] = createSignal(false);
  const [navHovered, setNavHovered] = createSignal(false);
  const [recheckingRemoteIds, setRecheckingRemoteIds] = createSignal<Set<string>>(new Set());

  // qr modal state for remote rows
  const [qrPayload, setQrPayload] = createSignal<{
    payload: string;
    name: string;
  } | null>(null);

  // confirm-delete modal state for remote rows
  const [pendingDelete, setPendingDelete] = createSignal<{
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = createSignal(false);

  // which remote row currently has its actions menu open (id, or null)
  const [openMenuFor, setOpenMenuFor] = createSignal<string | null>(null);

  // extract a usable node id from a peer_addr that may be a 64-hex string
  // or a json blob containing { node_id, ... }
  const extractNodeIdLocal = (peerAddr: string): string => {
    const trimmed = peerAddr.trim();
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
    try {
      const parsed = JSON.parse(trimmed) as { node_id?: string };
      if (parsed?.node_id && typeof parsed.node_id === "string") {
        return parsed.node_id;
      }
    } catch {
      // not json, fall through
    }
    return trimmed;
  };

  // build context-menu actions for a remote row
  const remoteContextActions = (
    remote: NonNullable<typeof props.remotes>[number]
  ): MenuAction[] => {
    const actions: MenuAction[] = [];

    // for the charnel-managed local row, peerAddr is undefined and url is the
    // "local" sentinel. resolve to the running iroh node id (populated by
    // charnel host on startup) so copy/qr expose a usable share target.
    const localNodeId =
      remote.isCharnelManaged || (remote.isLocal && (!remote.peerAddr || remote.url === "local"))
        ? getLocalNodeId()
        : null;

    // copy: prefer node id (p2p / charnel-local), else url (http remote)
    if (localNodeId) {
      actions.push({
        label: "copy node id",
        icon: "copy",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(localNodeId);
            toast.success("node id copied");
          } catch {
            toast.error("failed to copy");
          }
        },
      });
      actions.push({
        label: "show qr code",
        icon: "share",
        onClick: () => {
          setQrPayload({
            payload: `${DEFAULT_SHARE_WEB_HOST}/?r=${localNodeId}`,
            name: remote.name,
          });
        },
      });
    } else if (remote.peerAddr) {
      const nodeId = extractNodeIdLocal(remote.peerAddr);
      actions.push({
        label: "copy node id",
        icon: "copy",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(nodeId);
            toast.success("node id copied");
          } catch {
            toast.error("failed to copy");
          }
        },
      });
      actions.push({
        label: "show qr code",
        icon: "share",
        onClick: () => {
          setQrPayload({
            payload: `${DEFAULT_SHARE_WEB_HOST}/?r=${nodeId}`,
            name: remote.name,
          });
        },
      });
    } else if (remote.url) {
      actions.push({
        label: "copy url",
        icon: "copy",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(remote.url);
            toast.success("url copied");
          } catch {
            toast.error("failed to copy");
          }
        },
      });
      actions.push({
        label: "show qr code",
        icon: "share",
        onClick: () => {
          setQrPayload({ payload: remote.url, name: remote.name });
        },
      });
    }

    if (props.onDeleteRemote && !remote.isCharnelManaged) {
      if (actions.length > 0) actions.push({ type: "separator" });
      actions.push({
        label: "delete remote",
        icon: "delete",
        destructive: true,
        onClick: () => setPendingDelete({ id: remote.id, name: remote.name }),
      });
    }

    return actions;
  };

  const handleConfirmDelete = async () => {
    const target = pendingDelete();
    if (!target || !props.onDeleteRemote) return;
    setDeleting(true);
    try {
      await props.onDeleteRemote(target.id);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  // browser navigation back/forward state.
  // uses the modern Navigation API where available (chromium) for accurate
  // canGoBack/canGoForward tracking. falls back to history.length heuristic
  // elsewhere (safari/firefox) where forward state is unknowable, so the
  // forward button stays hidden unless we can prove it exists.
  const [canGoBack, setCanGoBack] = createSignal(false);
  const [canGoForward, setCanGoForward] = createSignal(false);

  // hide view selector, search, sort, and source selector on aggregate feed route
  const isAggregateFeedRoute = () => (props.currentPath ?? "").startsWith("/feed");
  // also hide search input and the music sub-nav (songs/albums/playlists/etc)
  // on the radio route — radio has its own list-and-detail layout.
  const isRadioRoute = () => (props.currentPath ?? "").startsWith("/radio");
  const isSharedRoute = () => (props.currentPath ?? "").startsWith("/shared");
  const isLocalSourceActive = () =>
    !isAggregateFeedRoute() &&
    !isRadioRoute() &&
    !isSharedRoute() &&
    (props.currentSourceName === "local library" || !props.currentSourceName);
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
      setIsNarrow(isNarrowViewport());
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));

    // wire up nav back/forward state tracking.
    // prefer the modern Navigation API (chromium) for accurate state.
    // otherwise we maintain our own depth/position by stamping history.state
    // and intercepting pushState/replaceState — works in safari/firefox.
    const nav = (
      window as unknown as {
        navigation?: EventTarget & { canGoBack?: boolean; canGoForward?: boolean };
      }
    ).navigation;

    if (nav) {
      const updateNavState = () => {
        setCanGoBack(nav.canGoBack ?? false);
        setCanGoForward(nav.canGoForward ?? false);
      };
      updateNavState();
      nav.addEventListener("currententrychange", updateNavState);
      onCleanup(() => nav.removeEventListener("currententrychange", updateNavState));
    } else {
      // fallback tracker: only counts navigations we've observed within this
      // tab since the app loaded. browser entries from before the app are
      // not counted (we can't inspect them), so back stays hidden until the
      // user has actually navigated within the app.
      type StampedState = { __topnavIdx?: number } & Record<string, unknown>;
      let position = 0;
      let depth = 1;

      const origPush = window.history.pushState.bind(window.history);
      const origReplace = window.history.replaceState.bind(window.history);

      const readIdx = (): number | undefined => {
        const s = window.history.state as StampedState | null;
        return typeof s?.__topnavIdx === "number" ? s.__topnavIdx : undefined;
      };

      const update = () => {
        setCanGoBack(position > 0);
        setCanGoForward(position < depth - 1);
      };

      // adopt or stamp the current entry
      const existing = readIdx();
      if (existing !== undefined) {
        position = existing;
        if (depth <= position) depth = position + 1;
      } else {
        const s = (window.history.state as StampedState | null) ?? {};
        origReplace({ ...s, __topnavIdx: position }, "");
      }
      update();

      // wrap pushState: new entry truncates forward stack
      window.history.pushState = function (state, title, url) {
        position += 1;
        depth = position + 1;
        const merged: StampedState = {
          ...((state as StampedState | null) ?? {}),
          __topnavIdx: position,
        };
        origPush(merged, title, url);
        update();
      };

      // wrap replaceState: keep the same position, preserve our stamp
      window.history.replaceState = function (state, title, url) {
        const merged: StampedState = {
          ...((state as StampedState | null) ?? {}),
          __topnavIdx: position,
        };
        origReplace(merged, title, url);
        update();
      };

      const onPop = () => {
        const idx = readIdx();
        if (typeof idx === "number") {
          position = idx;
          if (position >= depth) depth = position + 1;
        }
        update();
      };
      window.addEventListener("popstate", onPop);

      onCleanup(() => {
        window.history.pushState = origPush;
        window.history.replaceState = origReplace;
        window.removeEventListener("popstate", onPop);
      });
    }
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
    if (!props.remotes || !props.currentSourceId) {
      return null;
    }
    const found = props.remotes.find((r) => r.id === props.currentSourceId) ?? null;
    return found;
  };

  // handle remote click - recheck if offline, otherwise switch
  const handleRemoteClick = async (remote: NonNullable<typeof props.remotes>[number]) => {
    // if it's the current source and not on aggregate feed, do nothing
    if (!isAggregateFeedRoute() && props.currentSourceId === remote.id) return;

    // if offline, try to recheck
    if (remote.isOffline && props.onRecheckRemote) {
      setRecheckingRemoteIds((prev) => new Set([...prev, remote.id]));
      try {
        const isNowOnline = await props.onRecheckRemote(remote.id);
        if (isNowOnline) {
          props.onSwitchToRemote?.(remote.id);
        } else {
          toast.warning(`${remote.name} is still offline`);
        }
      } finally {
        setRecheckingRemoteIds((prev) => {
          const next = new Set(prev);
          next.delete(remote.id);
          return next;
        });
      }
      return;
    }

    // otherwise just switch
    props.onSwitchToRemote?.(remote.id);
  };

  return (
    <>
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
        style={{
          height: isNarrow() ? "var(--nav-height, 56px)" : "auto",
          "padding-top": isNarrow() ? "var(--safe-area-top, 0px)" : undefined,
        }}
        onMouseEnter={() => setNavHovered(true)}
        onMouseLeave={() => setNavHovered(false)}
      >
        <div
          class="flex items-center"
          classList={{
            "gap-3": !isNarrow(),
            "gap-1": isNarrow(),
          }}
        >
          {/* menu trigger */}
          <KobalteNav>
            <KobalteNav.Menu>
              <KobalteNav.Trigger
                class="p-1 rounded-lg text-white hover:bg-white/10 transition-colors border-none bg-transparent cursor-pointer flex items-center justify-center"
                style={{
                  "min-width": isNarrow() ? "44px" : "36px",
                  "min-height": isNarrow() ? "44px" : "36px",
                }}
                aria-label="menu"
              >
                <Show
                  when={!isAggregateFeedRoute() && currentRemote()}
                  fallback={
                    <Icon
                      name="freqhole"
                      size={isNarrow() ? 32 : 24}
                      color="var(--color-accent-500)"
                    />
                  }
                >
                  {(remote) => (
                    <RemoteServerImage
                      remote={remote()}
                      class={
                        isNarrow()
                          ? "w-9 h-9 rounded object-cover flex-shrink-0"
                          : "w-7 h-7 rounded object-cover flex-shrink-0"
                      }
                    />
                  )}
                </Show>
              </KobalteNav.Trigger>

              <KobalteNav.Portal>
                <KobalteNav.Content
                  class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-[1001] data-[expanded]:animate-in data-[closed]:animate-out"
                  ref={(el: HTMLElement) => {
                    // intercept pointerleave in capture phase before Kobalte sees it.
                    // Kobalte's NavigationMenu.Content calls startLeaveTimer() on
                    // pointerleave without checking pointerType, so touch scrolling
                    // closes the menu on Android. we swallow the event for touch.
                    el.addEventListener(
                      "pointerleave",
                      (e) => {
                        if (e.pointerType === "touch") {
                          e.stopImmediatePropagation();
                        }
                      },
                      { capture: true }
                    );
                  }}
                >
                  <div
                    class="flex flex-col wide:grid wide:grid-cols-2 gap-4 wide:gap-6 min-w-[280px] wide:min-w-[560px]"
                    style={{
                      "max-height": "70vh",
                      "overflow-y": "auto",
                      "-webkit-overflow-scrolling": "touch",
                      "touch-action": "pan-y",
                      "overscroll-behavior": "contain",
                    }}
                    ref={(el) => {
                      // prevent touchmove from being eaten by parent/Kobalte handlers
                      el.addEventListener(
                        "touchmove",
                        (e) => {
                          e.stopPropagation();
                        },
                        { passive: true }
                      );
                    }}
                  >
                    {/* column 1: brand info + source management */}
                    <div class="flex flex-col p-4 wide:p-6">
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

                      {/* aggregate feed link */}
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2 mb-4 rounded transition-colors border-none bg-transparent cursor-pointer"
                        classList={{
                          "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10":
                            props.currentPath?.startsWith("/feed") ?? false,
                          "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]":
                            !(props.currentPath?.startsWith("/feed") ?? false),
                        }}
                        onClick={() => props.onNavigate?.("/feed")}
                      >
                        <Show
                          when={props.currentPath === "/feed"}
                          fallback={<Icon name="recent" size={14} />}
                        >
                          <Icon name="check" size={14} color="var(--color-accent-500)" />
                        </Show>
                        <span class="text-sm">all feeds</span>
                      </button>

                      {/* radio link — works with zero remotes */}
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2 mb-4 rounded transition-colors border-none bg-transparent cursor-pointer"
                        classList={{
                          "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10":
                            props.currentPath?.startsWith("/radio") ?? false,
                          "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]":
                            !(props.currentPath?.startsWith("/radio") ?? false),
                        }}
                        onClick={() => props.onNavigate?.("/radio")}
                      >
                        <Icon name="radioTower" size={14} />
                        <span class="text-sm">radio</span>
                      </button>

                      {/* shared links route */}
                      <button
                        class="w-full flex items-center gap-2 px-3 py-2 mb-4 rounded transition-colors border-none bg-transparent cursor-pointer"
                        classList={{
                          "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10":
                            props.currentPath?.startsWith("/shared") ?? false,
                          "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]":
                            !(props.currentPath?.startsWith("/shared") ?? false),
                        }}
                        onClick={() => props.onNavigate?.(routes.shared())}
                      >
                        <Icon name="share" size={14} />
                        <span class="text-sm">shared</span>
                      </button>

                      {/* source selector */}
                      <div class="mb-4">
                        <h4 class="text-xs text-[var(--color-text-muted)] uppercase tracking-wide font-medium m-0 mb-2">
                          music source
                        </h4>
                        <div class="space-y-1">
                          {/* local library option - hidden in tauri mode */}
                          <Show when={!isCharnelMode()}>
                            <button
                              class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded transition-colors border-none bg-transparent"
                              classList={{
                                "text-[var(--color-text-primary)] bg-[var(--color-accent-500)]/10 cursor-default":
                                  isLocalSourceActive(),
                                "text-[var(--color-text-secondary)] cursor-pointer hover:bg-[var(--color-accent-500)]/10":
                                  isAggregateFeedRoute() ||
                                  isRadioRoute() ||
                                  isSharedRoute() ||
                                  (!!props.currentSourceName &&
                                    props.currentSourceName !== "local library"),
                              }}
                              disabled={!!isLocalSourceActive()}
                              onClick={() => props.onSwitchToLocal?.()}
                            >
                              <Show
                                when={isLocalSourceActive()}
                                fallback={
                                  <span class="w-2 h-2 rounded-full bg-[var(--color-accent-primary)]" />
                                }
                              >
                                <Icon name="check" size={14} color="var(--color-accent-500)" />
                              </Show>
                              <span>local library</span>
                            </button>
                          </Show>

                          {/* remote sources */}
                          <Show when={props.remotes && props.remotes.length > 0}>
                            <div class="pt-1 border-t border-[var(--color-border-subtle)] mt-2">
                              <For each={props.remotes}>
                                {(remote) => {
                                  const isRechecking = () => recheckingRemoteIds().has(remote.id);
                                  const isCurrentSource = () =>
                                    !isAggregateFeedRoute() && props.currentSourceId === remote.id;
                                  const offlineTitle = () => {
                                    if (!remote.isOffline) return undefined;
                                    const lastChecked = remote.lastChecked
                                      ? `last checked ${formatRelativeTime(remote.lastChecked)}`
                                      : "never checked";
                                    return `${lastChecked} - click to retry`;
                                  };
                                  return (
                                    <div class="relative flex items-center gap-1">
                                      <button
                                        class="flex-1 min-w-0 px-3 py-2 text-left text-sm flex items-center gap-2 rounded transition-colors border-none bg-transparent"
                                        classList={{
                                          "text-[var(--color-text-primary)] bg-[var(--color-accent-500)]/10 cursor-default":
                                            isCurrentSource(),
                                          "text-[var(--color-text-secondary)] cursor-pointer hover:bg-[var(--color-accent-500)]/10":
                                            !isCurrentSource() && !isRechecking(),
                                          "opacity-60": remote.isOffline && !isRechecking(),
                                          "cursor-wait": isRechecking(),
                                        }}
                                        disabled={isCurrentSource() || isRechecking()}
                                        onClick={() => handleRemoteClick(remote)}
                                        title={offlineTitle()}
                                      >
                                        <Show
                                          when={isCurrentSource()}
                                          fallback={
                                            <Show
                                              when={isRechecking()}
                                              fallback={
                                                <span
                                                  class="w-2 h-2 rounded-full"
                                                  classList={{
                                                    "bg-[var(--color-status-error)]":
                                                      remote.isOffline,
                                                    "bg-[var(--color-status-success)]":
                                                      !remote.isOffline,
                                                  }}
                                                />
                                              }
                                            >
                                              <Icon
                                                name="loader"
                                                size={12}
                                                color="var(--color-text-secondary)"
                                                className="animate-spin"
                                              />
                                            </Show>
                                          }
                                        >
                                          <Icon
                                            name="check"
                                            size={14}
                                            color="var(--color-accent-500)"
                                          />
                                        </Show>
                                        <RemoteServerImage
                                          remote={remote}
                                          class={`w-4 h-4 rounded object-cover flex-shrink-0 ${remote.isOffline ? "opacity-50 grayscale" : ""}`}
                                        />
                                        <span class="truncate">{remote.name}</span>
                                        <Show when={remote.isCharnelManaged}>
                                          <Icon
                                            name="home"
                                            size={14}
                                            color="var(--color-text-muted)"
                                            className="flex-shrink-0 ml-1"
                                          />
                                        </Show>
                                        <Show when={remote.peerAddr}>
                                          <span class="px-1.5 py-0.5 text-[10px] font-medium bg-purple-600/20 text-purple-400 rounded">
                                            p2p
                                          </span>
                                        </Show>
                                        <Show when={remote.isLocal && !remote.isCharnelManaged}>
                                          <span class="px-1.5 py-0.5 text-[10px] font-medium bg-blue-600/20 text-blue-400 rounded">
                                            local
                                          </span>
                                        </Show>
                                        <Show when={remote.isOffline && !isRechecking()}>
                                          <span class="text-xs text-[var(--color-status-error)] ml-auto">
                                            offline
                                          </span>
                                        </Show>
                                      </button>
                                      <Show when={remoteContextActions(remote).length > 0}>
                                        <RowActionsMenu
                                          actions={remoteContextActions(remote)}
                                          isOpen={openMenuFor() === remote.id}
                                          onToggle={() =>
                                            setOpenMenuFor(
                                              openMenuFor() === remote.id ? null : remote.id
                                            )
                                          }
                                          onClose={() => setOpenMenuFor(null)}
                                        />
                                      </Show>
                                    </div>
                                  );
                                }}
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

                        {/* settings link */}
                        <Show when={!isCharnelMode()}>
                          <button
                            class="w-full flex items-center gap-2 px-3 py-2 mb-4 rounded transition-colors border-none bg-transparent text-sm cursor-pointer text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                            onClick={() => props.onNavigate?.(routes.settingsStorage())}
                          >
                            <Icon name="settings" size={16} /> settings
                          </button>
                        </Show>
                      </div>
                    </div>

                    {/* column 2: recent playlists */}
                    <div class="flex flex-col p-4 wide:p-6 border-t wide:border-t-0 wide:border-l border-[var(--color-border-subtle)]">
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
                                    thumbnailSize={50}
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

          {/* view selector flyout - hidden when search is expanded on small screens, hidden on aggregate feed and radio */}
          <Show
            when={
              !isAggregateFeedRoute() &&
              !isRadioRoute() &&
              !isSharedRoute() &&
              props.viewOptions?.length &&
              (!isNarrow() || !searchExpanded())
            }
          >
            <div class="order-1">
              <ViewSelector
                views={props.viewOptions!}
                currentTitle={props.pageTitle}
                currentCount={props.pageCount}
                onNavigate={(path) => props.onNavigate?.(path)}
                isNarrow={isNarrow()}
              />
            </div>
          </Show>

          {/* icon row + search - distributed across remaining space on narrow */}
          <div
            class="flex items-center flex-1 order-2"
            classList={{
              "gap-3": !isNarrow(),
              "justify-around gap-1": isNarrow(),
            }}
          >
            {/* browser history back/forward - hidden when search expanded on small */}
            <Show when={canGoBack() && (!isNarrow() || !searchExpanded())}>
              <button
                class={`${iconBtnPad()} rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0 order-1 text-white/60 hover:text-white`}
                onClick={() => window.history.back()}
                title="back"
                aria-label="go back"
              >
                <Icon name="arrowLeft" size={iconBtnSize()} />
              </button>
            </Show>
            <Show when={canGoForward() && (!isNarrow() || !searchExpanded())}>
              <button
                class={`${iconBtnPad()} rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0 order-1 text-white/60 hover:text-white`}
                onClick={() => window.history.forward()}
                title="forward"
                aria-label="go forward"
              >
                <Icon name="arrowRight" size={iconBtnSize()} />
              </button>
            </Show>

            {/* search - last item on right, grows to fill remaining space (hidden on aggregate feed + radio) */}
            <Show when={!isAggregateFeedRoute() && !isRadioRoute() && !isSharedRoute()}>
              <div
                class="order-last"
                classList={{
                  "flex-1": !isNarrow() || searchExpanded(),
                }}
              >
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
            </Show>

            {/* sort controls - when view has sorting, hidden when search expanded on small, hidden on aggregate feed + radio */}
            <Show
              when={
                !isAggregateFeedRoute() &&
                !isRadioRoute() &&
                !isSharedRoute() &&
                info().sortFields?.length &&
                (!isNarrow() || !searchExpanded())
              }
            >
              <div
                class="relative flex-shrink-0 order-2"
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
                  class={`${iconBtnPad()} rounded transition-colors border-none bg-transparent cursor-pointer`}
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
                  <Icon name="sort" size={iconBtnSize()} />
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

            {/* tag filter icon - when view has tags, hidden when search expanded on small, hidden on radio */}
            <Show
              when={
                !isRadioRoute() &&
                info().availableTags?.length &&
                (!isNarrow() || !searchExpanded())
              }
            >
              <div
                class="relative flex-shrink-0 order-2"
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
                  class={`${iconBtnPad()} rounded transition-colors border-none bg-transparent cursor-pointer`}
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
                  <Icon name="tag" size={iconBtnSize()} />
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
                                <span>#{tag.label}</span>
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

            {/* feed type filter icon - when view has feed types, hidden when search expanded on small */}
            <Show when={info().feedTypeOptions?.length && (!isNarrow() || !searchExpanded())}>
              <div
                class="relative flex-shrink-0 order-2"
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
                  class={`${iconBtnPad()} rounded transition-colors border-none bg-transparent cursor-pointer`}
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
                  <Icon name="filter" size={iconBtnSize()} />
                </button>
                <Show when={feedFilterOpen()}>
                  <div class="absolute top-full left-0 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-[1001] min-w-[180px]">
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

            {/* my items toggle - when view supports it, hidden when search expanded on small */}
            <Show when={info().onToggleMyItems && (!isNarrow() || !searchExpanded())}>
              <button
                class={`${iconBtnPad()} rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0 order-2`}
                classList={{
                  "text-[var(--color-accent-500)]": info().myItemsOnly,
                  "text-white/60 hover:text-white": !info().myItemsOnly,
                }}
                onClick={() => info().onToggleMyItems?.()}
                title={info().myItemsOnly ? "showing my items only" : "showing all items"}
              >
                <Icon name="user" size={iconBtnSize()} />
              </button>
            </Show>

            {/* back to top - shown after scroll threshold, after all filter controls, hidden when search expanded on small */}
            <Show
              when={
                info().showBackToTop && info().onBackToTop && (!isNarrow() || !searchExpanded())
              }
            >
              <button
                class={`${iconBtnPad()} rounded transition-all border-none bg-transparent cursor-pointer text-white/60 hover:text-white flex-shrink-0 animate-in fade-in duration-200 order-2`}
                onClick={() => info().onBackToTop?.()}
                title="back to top"
              >
                <Icon name="chevronUp" size={iconBtnSize()} />
              </button>
            </Show>
          </div>
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
                    #{filter.tag}
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

      {/* qr code modal for remote rows */}
      <QrCodeModal
        isOpen={qrPayload() !== null}
        onClose={() => setQrPayload(null)}
        payload={qrPayload()?.payload ?? ""}
        title={qrPayload() ? `qr code: ${qrPayload()!.name}` : "qr code"}
        subtitle="scan to open this source"
      />

      {/* delete remote confirm dialog */}
      <ConfirmDialog
        isOpen={pendingDelete() !== null}
        onClose={() => {
          if (!deleting()) setPendingDelete(null);
        }}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        title="delete remote"
        message={`are you sure you want to delete "${pendingDelete()?.name ?? ""}"? this will remove the remote and clear its cached data.`}
        confirmText="delete"
        cancelText="cancel"
        variant="danger"
        loading={deleting()}
        alertVariant="warning"
      />
    </>
  );
}
