import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { clearPageInfo, setPageInfo } from "../src/app/services/pageInfo";
import {
  setBackgroundImage,
  clearBackgroundImage,
  getBackgroundConfig,
} from "../src/app/services/backgroundImage";
import {
  registerCoachContext,
  unregisterCoachContext,
  type CoachContext,
} from "./coach/coachState";
import { Button } from "../src/components/buttons/Button";
import { IconButton } from "../src/components/buttons/IconButton";
import {
  formatDuration,
  formatNumber,
  StatsCard,
  StatsGrid,
} from "../src/components/cards/StatsCard";
import { SearchSortControls } from "../src/components/controls/SearchSortControls";
import { Icon } from "../src/components/icons/registry";
import { FavoritesLayout, type FavoriteItem } from "../src/components/layout/FavoritesLayout";
import { HeadingSection } from "../src/components/layout/HeadingSection";
import { ResponsiveMasterDetail, TwoColumnLayout } from "../src/components/layout/TwoColumnLayout";
import { DraggableRow, DraggableRowSongContent } from "../src/components/lists/DraggableRow";
import { AlphabetNav } from "../src/components/navigation/AlphabetNav";
import { TopNav } from "../src/components/navigation/TopNav";
import { TopNavSearch } from "../src/components/navigation/TopNavSearch";
import { PlayerBar } from "../src/components/player/PlayerBar";
import { QueueSidebar } from "../src/components/player/QueueSidebar";
import { VirtualAlbumGrid } from "../src/components/virtualized/VirtualAlbumGrid";
import { VirtualFeedList } from "../src/components/virtualized/VirtualFeedList";
import { VirtualSongList } from "../src/components/virtualized/VirtualSongList";
import type { Song as DomainSong } from "../src/music/data/types";
import { isNarrowViewport } from "../src/config/breakpoints";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import {
  generateBulkSongs,
  generateFeedItems,
  generateQueueHistory,
  generateRadioListenHistory,
  mockAlbums,
  mockArtists,
  mockFavorites,
  mockGenres,
  mockPlaylists,
  mockRadioStations,
  mockRemotes,
  mockRemoteSongs,
  placeholderImage,
  runFakeLibraryScan,
  setDemoLibraryMode,
  demoLibraryMode,
  fakeScanProgress,
  fakeScanRunning,
  setFakeScanProgress,
  setFakeScanRunning,
  type Artist,
  type Genre,
  type Playlist,
} from "./mockData";

// alias the domain Song for compatibility with existing code
type Song = DomainSong;

const meta = {
  title: "Super Story",
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// generate reusable mock songs
const generatedSongs = generateBulkSongs(100);

// deterministic 32-bit string hash, used to derive a stable per-id song slice.
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function songsForArtist(id: string): Song[] {
  const h = hashId("artist:" + id);
  const start = h % Math.max(1, generatedSongs.length - 10);
  const len = 6 + (h % 7); // 6..12 songs, varies per artist
  return generatedSongs.slice(start, start + len);
}
// build initials from an artist name (matches real getArtistAbbreviation
// behaviour closely enough for the demo: up to two leading characters from
// the first two whitespace-separated words, uppercased).
function artistInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function songsForPlaylist(id: string): Song[] {
  const h = hashId("playlist:" + id);
  const start = h % Math.max(1, generatedSongs.length - 14);
  const len = 8 + (h % 9); // 8..16 songs, varies per playlist
  return generatedSongs.slice(start, start + len);
}
// returns a CSS background value for ~half of playlists, deterministic per id.
// uses gradients as fake "cover art" banners (no external image assets).
function playlistBanner(id: string): string | null {
  const h = hashId("banner:" + id);
  if (h % 2 === 0) return null; // ~half get no banner
  const palettes = [
    "linear-gradient(135deg, #ff006e 0%, #8338ec 50%, #3a86ff 100%)",
    "linear-gradient(135deg, #f72585 0%, #b5179e 50%, #560bad 100%)",
    "linear-gradient(135deg, #06ffa5 0%, #1b9aaa 50%, #003049 100%)",
    "linear-gradient(135deg, #fb8500 0%, #ffb703 50%, #ffd60a 100%)",
    "linear-gradient(135deg, #2d00f7 0%, #6a00f4 50%, #f20089 100%)",
    "linear-gradient(135deg, #001233 0%, #023e8a 50%, #0096c7 100%)",
  ];
  return palettes[h % palettes.length];
}

type Route =
  | "songs"
  | "albums"
  | "artists"
  | "genres"
  | "playlists"
  | "favorites"
  | "feed"
  | "radio"
  | "remotes"
  | "album-detail"
  | "shares";

// alias the shared placeholder helper for brevity
const placeholderSvg = placeholderImage;

// shared query client for stories — VirtualFeedList's FavoriteToggle needs this
const storyQueryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false } },
});

const artistSortFields = [
  { value: "name", label: "name", description: "sort by artist name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  { value: "albumCount", label: "albums", description: "sort by album count" },
];

const genreSortFields = [
  { value: "name", label: "name", description: "sort by genre name" },
  { value: "songCount", label: "songs", description: "sort by song count" },
  {
    value: "artistCount",
    label: "artists",
    description: "sort by artist count",
  },
];

/**
 * comprehensive demo showcasing all major components working together:
 * - top navigation bar with main sections
 * - two-column layout with alphabet navigation
 * - artist list with sorting and selection
 * - artist detail panel with stats cards
 * - draggable playlist rows
 * - interactive buttons and controls
 */
// extracted render body so the standalone build (stories/coach/standalone.tsx)
// and the storybook story can both mount the same UI.
export function FullAppDemoBody() {
  // navigation state
  const [currentRoute, setCurrentRoute] = createSignal<Route>("songs");
  const [_topNavOpen, setTopNavOpen] = createSignal(false);
  // tracks pointer over the TopNav root so the inner TopNavSearch knows
  // when to auto-collapse on hover-out (matches real-app behavior)
  const [topNavHovered, setTopNavHovered] = createSignal(false);
  // open state for the demo's FAKE topnav brand-menu flyout. the real
  // TopNav's kobalte-driven menu doesn't behave reliably inside the
  // coach-demo shadow DOM (autoFocusMenu state never flips, hover/click
  // race conditions, etc.), so we render our own static lookalike overlay
  // anchored to the brand-icon trigger's bounding rect. driven by the
  // coach script (via setTopNavMenuOpen) and by user clicks on the brand
  // icon (intercepted in capture phase).
  const [topNavMenuOpen, setTopNavMenuOpenSignal] = createSignal(false);

  // player state
  // start with no current song + empty queue so the playerbar is hidden until
  // the demo's queue step (or any user action) seeds playback.
  const [currentSong, setCurrentSong] = createSignal<Song | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [volume, setVolume] = createSignal(0.75);
  const [currentTime, setCurrentTime] = createSignal(45);
  const [queueOpen, setQueueOpen] = createSignal(false);
  const [queueSongs, setQueueSongs] = createSignal<Song[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = createSignal(0);

  // responsive: track if viewport is narrow (<= 800px)
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  // track viewport height for virtualized list sizing.
  // when this story is hosted inside the coach-demo web component the
  // window may be much taller than the host element. use the host's
  // clientHeight when available so absolute-positioned children (like
  // VirtualSongList's bottom-pinned header row) don't overflow the frame.
  let storyRootEl: HTMLDivElement | undefined;
  const measuredHeight = () => {
    if (storyRootEl && storyRootEl.clientHeight > 0) return storyRootEl.clientHeight;
    return window.innerHeight;
  };
  const [viewportHeight, setViewportHeight] = createSignal(window.innerHeight);

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(isNarrowViewport());
      setViewportHeight(measuredHeight());
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));

    // observe the host element so we pick up coach-demo frame sizing.
    let ro: ResizeObserver | undefined;
    if (storyRootEl && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => setViewportHeight(measuredHeight()));
      ro.observe(storyRootEl);
    }
    // initial measure once mounted (clientHeight is 0 until layout).
    queueMicrotask(() => setViewportHeight(measuredHeight()));
    onCleanup(() => ro?.disconnect());
  });

  // available height for virtualized lists/grids inside main content area.
  // the parent main-content wrapper already reserves player bar space via
  // `padding-bottom: var(--player-bar-height)`, so DON'T subtract
  // playerBarPx() again here — doing so would shrink the grid by 2x the
  // player bar height. we only account for: TopNav (~60px) and the
  // heading + p-3 padding chrome inside each view (~80px / ~40px).
  const isPlayerBarVisible = () => !!currentSong() || queueSongs().length > 0;
  // literal pixel value matching the real PlayerBar's natural height. used
  // for the css custom property (padding-bottom reservation on the main
  // content wrapper). don't reference `var(--player-height)` here — that
  // variable is defined by the real app's AppLayout but NOT inside the
  // coach-demo shadow DOM, so it would resolve to an invalid value and
  // silently drop the padding.
  const PLAYER_BAR_PX = 80;
  const playerBarPx = () => (isPlayerBarVisible() ? PLAYER_BAR_PX : 0);
  const listHeight = () => Math.max(320, viewportHeight() - 60 - 80);
  const gridHeight = () => Math.max(320, viewportHeight() - 60 - 40);

  // compute page title and count based on current route
  const pageInfo = () => {
    switch (currentRoute()) {
      case "songs":
        return { title: "songs", count: generatedSongs.length };
      case "albums":
        return { title: "albums", count: mockAlbums.length };
      case "artists":
        return { title: "artists", count: mockArtists.length };
      case "genres":
        return { title: "genres", count: mockGenres.length };
      case "playlists":
        return { title: "playlists", count: mockPlaylists.length };
      case "favorites":
        return { title: "favorites", count: mockFavorites.length };
      case "feed":
        return { title: "feed", count: undefined };
      case "radio":
        return { title: "radio", count: mockRadioStations.length };
      default:
        return { title: undefined, count: undefined };
    }
  };

  // artists view state
  const [_selectedArtist, _setSelectedArtist] = createSignal<Artist | null>(mockArtists[0]);
  const [artistSortBy, setArtistSortBy] = createSignal("name");
  const [artistSortDirection, setArtistSortDirection] = createSignal<"asc" | "desc">("asc");
  const [currentLetter, setCurrentLetter] = createSignal<string | undefined>();
  const [playlistSongs, setPlaylistSongs] = createSignal<Song[]>(generatedSongs.slice(0, 10));
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = createSignal<number | null>(null);
  const [selectedSongIds, setSelectedSongIds] = createSignal<Set<string>>(new Set());

  // genres view state
  const [_selectedGenre, _setSelectedGenre] = createSignal<Genre | null>(mockGenres[0]);
  const [genreSortBy, setGenreSortBy] = createSignal("name");
  const [genreSortDirection, setGenreSortDirection] = createSignal<"asc" | "desc">("asc");

  // playlists view state
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<Playlist | null>(mockPlaylists[0]);

  // search state
  const [searchValue, setSearchValue] = createSignal("");
  // when running inside the coach demo's shadow root, we mount the search
  // suggestions flyout into the shadow root itself so its tailwind / theme
  // styles apply (default Portal mount = document.body, which sits outside
  // the shadow scope and renders the flyout unstyled + mis-positioned).
  const [flyoutMount, setFlyoutMount] = createSignal<Node | undefined>(undefined);
  // demo-only: when true, a fake search-suggestions flyout is rendered over
  // the topnav (see fakeSearchFlyout below). way simpler than driving the
  // real SearchInput's debounced + portal-mounted flyout from a script.
  const [searchDemoActive, setSearchDemoActive] = createSignal(false);
  const [searchDemoQuery, setSearchDemoQuery] = createSignal("");
  // scroll-driven spotlight: { anchor: data-coach-anchor name, intensity: 0..1 }.
  // null anchor clears the spotlight overlay. driven by step.onProgress hooks.
  const [coachSpotlight, setCoachSpotlight] = createSignal<{
    anchor: string;
    intensity: number;
  } | null>(null);
  // bounding rect of the spotlit element, refreshed each animation frame
  // while the overlay is active so it tracks resizes / scrolls.
  const [spotlightRect, setSpotlightRect] = createSignal<DOMRect | null>(null);
  // bounding rect of the topnav search input, used to position the fake
  // demo flyout directly underneath it.
  const [searchInputRect, setSearchInputRect] = createSignal<DOMRect | null>(null);
  // bounding rect of the topnav brand-icon trigger. used to position the
  // demo's fake brand-menu flyout. updated on every animation frame while
  // the menu is open (same pattern as searchInputRect).
  const [topNavTriggerRect, setTopNavTriggerRect] = createSignal<DOMRect | null>(null);
  const mockSearchSuggestions = () => {
    const query = searchValue().toLowerCase();
    if (!query || query.length < 2) return [];

    // filter mock data based on search query
    const artistSuggestions = mockArtists
      .filter((a) => a.name.toLowerCase().includes(query))
      .slice(0, 3)
      .map((a) => ({
        id: `artist-${a.id}`,
        text: a.name,
        category: "artists",
        highlight: a.name.replace(new RegExp(`(${query})`, "gi"), "<mark>$1</mark>"),
        count: a.songCount,
      }));

    const songSuggestions = generatedSongs
      .filter(
        (s) => s.title.toLowerCase().includes(query) || s.artist_name?.toLowerCase().includes(query)
      )
      .slice(0, 3)
      .map((s) => ({
        id: `song-${s.id}`,
        text: s.title,
        category: "songs",
        highlight: s.title.replace(new RegExp(`(${query})`, "gi"), "<mark>$1</mark>"),
      }));

    const albumSuggestions = mockAlbums
      .filter((a) => a.title.toLowerCase().includes(query))
      .slice(0, 3)
      .map((a) => ({
        id: `album-${a.id}`,
        text: a.title,
        category: "albums",
        highlight: a.title.replace(new RegExp(`(${query})`, "gi"), "<mark>$1</mark>"),
      }));

    return [...artistSuggestions, ...songSuggestions, ...albumSuggestions];
  };

  // sort artists
  const sortedArtists = () => {
    const artists = [...mockArtists];
    const field = artistSortBy() as keyof Artist;
    const dir = artistSortDirection();

    artists.sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      if (typeof aVal === "string" && typeof bVal === "string") {
        return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return dir === "asc" ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });

    return artists;
  };

  // sort genres
  const sortedGenres = () => {
    const genres = [...mockGenres];
    const field = genreSortBy() as keyof Genre;
    const dir = genreSortDirection();

    genres.sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      if (typeof aVal === "string" && typeof bVal === "string") {
        return dir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return dir === "asc" ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });

    return genres;
  };

  // get disabled letters for alphabet nav
  const disabledLetters = () => {
    const letters = new Set<string>();
    const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");

    allLetters.forEach((letter) => {
      const hasArtist = sortedArtists().some((artist) => {
        const firstChar = artist.name.charAt(0).toUpperCase();
        if (letter === "#") {
          return !/[A-Z]/.test(firstChar);
        }
        return firstChar === letter;
      });
      if (!hasArtist) {
        letters.add(letter);
      }
    });

    return letters;
  };

  // drag and drop handlers for playlist
  const handleDragStart = (index: number) => (e: DragEvent) => {
    setDraggedIndex(index);
    e.dataTransfer!.effectAllowed = "move";
  };

  const handleDragOver = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    setDropTargetIndex(index);
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = (dropIndex: number) => (e: DragEvent) => {
    e.preventDefault();
    const dragIndex = draggedIndex();

    if (dragIndex === null || dragIndex === dropIndex) {
      setDraggedIndex(null);
      setDropTargetIndex(null);
      return;
    }

    const reordered = [...playlistSongs()];
    const [draggedSong] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, draggedSong);

    setPlaylistSongs(reordered);
    setDraggedIndex(null);
    setDropTargetIndex(null);
  };

  const handleSongClick = (song: Song) => () => {
    const newSelected = new Set(selectedSongIds());
    if (newSelected.has(song.id)) {
      newSelected.delete(song.id);
    } else {
      newSelected.add(song.id);
    }
    setSelectedSongIds(newSelected);
  };

  const handleRemoveSong = (song: Song) => (e: MouseEvent) => {
    e.stopPropagation();
    setPlaylistSongs(playlistSongs().filter((s) => s.id !== song.id));
  };

  // route handlers
  const navigateTo = (route: Route) => {
    setCurrentRoute(route);
    setTopNavOpen(false); // close topnav after navigation
  };

  // --- coach context ---------------------------------------------------
  // expose imperative hooks for the scroll-coach demo. only some surfaces
  // exist in this story (route, queue) — the rest are stubs/no-ops.
  const [activeModal, setActiveModal] = createSignal<string | null>(null);
  // knock-flow phase for the story-only "add remote" modal. drives a
  // multi-step demo of the friend-mounting flow without touching real spume
  // internals. phases: id-form | loading | request-form | pending | approved
  const [knockPhase, setKnockPhase] = createSignal<string>("id-form");
  onMount(() => {
    // detect whether we're embedded inside the <freqhole-coach-demo> shadow
    // root (standalone web component build). if so, route the search flyout
    // portal into the shadow root so it stays styled.
    if (typeof document !== "undefined") {
      const host = document.querySelector("freqhole-coach-demo");
      if (host?.shadowRoot) setFlyoutMount(host.shadowRoot);
    }
    const ctx: CoachContext = {
      setLibraryMode: (m) => setDemoLibraryMode(m === "empty" ? "empty" : "populated"),
      setRoute: (r) => navigateTo(r as Route),
      setQueueOpen: (o) => setQueueOpen(o),
      openModal: (n) => setActiveModal(n),
      closeModal: (n) => setActiveModal((cur) => (cur === n ? null : cur)),
      closeAllModals: () => setActiveModal(null),
      openSearch: (query) => {
        // find the topnav anchor inside the (possibly shadow-rooted) demo
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const anchor = root.querySelector("[data-coach-anchor='topnavSearch']");
        if (!anchor) return;
        // mark the topnav as hovered (some sub-components use this)
        setTopNavHovered(true);
        // click the search icon button — TopNavSearch's handleIconClick does
        // setIsExpanded(true) + setIsLocked(true) + focuses inputRef. this
        // gives us the visible expanded input. flyout is faked separately
        // (see fakeSearchFlyout below) — the real one is too tangled with
        // debounced events + portal mounts to drive reliably from a script.
        const iconBtn = anchor.querySelector("button[title^='search']") as HTMLButtonElement | null;
        // monkey-patch HTMLInputElement.focus to always preventScroll. the
        // browser's auto-scroll-into-view fights with our scroll-coach.
        const HTMLInputProto = HTMLInputElement.prototype;
        const origFocus = HTMLInputProto.focus;
        HTMLInputProto.focus = function (opts?: FocusOptions) {
          return origFocus.call(this, { ...(opts || {}), preventScroll: true });
        };
        iconBtn?.click();
        setTimeout(() => {
          HTMLInputProto.focus = origFocus;
        }, 200);
        if (typeof query !== "string") {
          setSearchDemoActive(false);
          setSearchDemoQuery("");
          return;
        }
        // populate the input value visually (purely cosmetic — no need to
        // dispatch input events because we render our own flyout).
        setSearchDemoQuery(query);
        setSearchDemoActive(true);
        requestAnimationFrame(() => {
          const input = anchor.querySelector("input") as HTMLInputElement | null;
          if (!input) return;
          const proto = Object.getPrototypeOf(input);
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          setter?.call(input, query);
          setSearchValue(query);
        });
      },
      closeSearch: () => {
        setTopNavHovered(false);
        setSearchValue("");
        setSearchDemoActive(false);
        setSearchDemoQuery("");
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const anchor = root.querySelector("[data-coach-anchor='topnavSearch']");
        if (!anchor) return;
        const input = anchor.querySelector("input") as HTMLInputElement | null;
        const wrapper = anchor.querySelector("div.overflow-hidden") as HTMLElement | null;
        const looksOpen =
          (wrapper && wrapper.style.maxWidth !== "0px" && wrapper.style.maxWidth !== "") ||
          (input && (input === document.activeElement || input.value.length > 0));
        if (input) {
          const proto = Object.getPrototypeOf(input);
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          setter?.call(input, "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.blur();
        }
        if (looksOpen) {
          const iconBtn = anchor.querySelector(
            "button[title^='search']"
          ) as HTMLButtonElement | null;
          iconBtn?.click();
        }
      },
      seedNowPlaying: (enabled) => {
        if (enabled) {
          // pick a track + a small queue so the playerbar has content
          setCurrentSong(generatedSongs[0]);
          setQueueSongs(generatedSongs.slice(1, 16));
          setIsPlaying(true);
        } else {
          setIsPlaying(false);
          setCurrentSong(null);
          setQueueSongs([]);
        }
      },
      runFakeScan: ({ durationMs, flipToPopulated }) =>
        runFakeLibraryScan({ durationMs, flipToPopulated }),

      // --- scroll-driven animation hooks ---
      setScanProgress: (p) => {
        const clamped = Math.max(0, Math.min(1, p));
        setFakeScanProgress(clamped);
        setFakeScanRunning(clamped > 0 && clamped < 1);
      },
      setSpotlight: (anchor, intensity = 1) => {
        if (!anchor) {
          setCoachSpotlight(null);
          setSpotlightRect(null);
          return;
        }
        setCoachSpotlight({ anchor, intensity: Math.max(0, Math.min(1, intensity)) });
      },
      setListProgress: (anchor, p) => {
        if (typeof document === "undefined") return;
        const root = document.querySelector("freqhole-coach-demo")?.shadowRoot || document;
        // support `${anchor}:detail` to target the detail-scroll inside a
        // master-detail view (artists / playlists).
        const wantDetail = anchor.endsWith(":detail");
        const baseAnchor = wantDetail ? anchor.replace(/:detail$/, "") : anchor;
        const el = root.querySelector(`[data-coach-anchor='${baseAnchor}']`) as HTMLElement | null;
        if (!el) return;
        const isScrollable = (e: HTMLElement) =>
          e.scrollHeight > e.clientHeight + 1 &&
          /(auto|scroll)/.test(getComputedStyle(e).overflowY);
        const candidates: HTMLElement[] = [];
        if (wantDetail) {
          const detail = el.querySelector("[data-coach-detail-scroll]") as HTMLElement | null;
          if (detail && isScrollable(detail)) candidates.push(detail);
        } else {
          // prefer explicit hooks: data-coach-list (master list) wins over
          // detail; otherwise pick the first scrollable descendant.
          const list = el.querySelector("[data-coach-list]") as HTMLElement | null;
          if (list && isScrollable(list)) candidates.push(list);
          if (!candidates.length && isScrollable(el)) candidates.push(el);
          if (!candidates.length) {
            const found = Array.from(el.querySelectorAll<HTMLElement>("*")).find(isScrollable);
            if (found) candidates.push(found);
          }
        }
        const target = candidates[0];
        if (!target) return;
        const max = target.scrollHeight - target.clientHeight;
        target.scrollTop = Math.max(0, Math.min(max, max * p));
      },
      setSearchQuery: (text) => {
        setSearchDemoQuery(text);
        setSearchValue(text);
        setSearchDemoActive(text.length > 0);
        // also poke the real DOM input so the visible value updates char-by-char
        if (typeof document === "undefined") return;
        const root = document.querySelector("freqhole-coach-demo")?.shadowRoot || document;
        const input = root.querySelector(
          "[data-coach-anchor='topnavSearch'] input"
        ) as HTMLInputElement | null;
        if (!input) return;
        const proto = Object.getPrototypeOf(input);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(input, text);
      },
      setSelectedListItem: (anchor, idx) => {
        if (typeof document === "undefined") return;
        const root = document.querySelector("freqhole-coach-demo")?.shadowRoot || document;
        const el = root.querySelector(`[data-coach-anchor='${anchor}']`) as HTMLElement | null;
        if (!el) return;
        const items = Array.from(el.querySelectorAll<HTMLElement>("[data-coach-item]"));
        if (!items.length) return;
        const clamped = Math.max(0, Math.min(items.length - 1, idx));
        const target = items[clamped];
        if (!target) return;
        // only click if not already selected (avoids re-renders / scroll resets)
        const alreadyActive = target.className.includes("border-[var(--color-accent-500)]");
        if (!alreadyActive) target.click();
      },
      setInputValue: (anchor, text) => {
        if (typeof document === "undefined") return;
        const root = document.querySelector("freqhole-coach-demo")?.shadowRoot || document;
        const input = root.querySelector(
          `[data-coach-anchor='${anchor}'] input, [data-coach-anchor='${anchor}'] textarea`
        ) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!input) return;
        const proto = Object.getPrototypeOf(input);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(input, text);
      },
      setKnockPhase: (phase) => setKnockPhase(phase),
      setQueueTab: (tab) => {
        if (typeof document === "undefined") return;
        const root = document.querySelector("freqhole-coach-demo")?.shadowRoot || document;
        const sidebar = root.querySelector(
          "[data-coach-anchor='queueSidebar']"
        ) as HTMLElement | null;
        if (!sidebar) return;
        const buttons = Array.from(sidebar.querySelectorAll<HTMLButtonElement>("button"));
        const wantText = tab === "queue" ? "queue" : "history";
        // first button whose text starts with the desired tab name (handles
        // "queue (n)" suffix). avoid re-clicking already-active tab.
        const btn = buttons.find((b) =>
          (b.textContent || "").trim().toLowerCase().startsWith(wantText)
        );
        if (!btn) return;
        const isActive = btn.className.includes(
          "color-accent-500)] bg-[var(--color-accent-500)]/10"
        );
        if (!isActive) btn.click();
      },
      setTopNavMenuOpen: (open) => {
        // flips the signal that controls our fake brand-menu overlay.
        setTopNavMenuOpenSignal(open);
      },
    };
    registerCoachContext(ctx);
    onCleanup(() => unregisterCoachContext());

    // spotlight rect tracker — while a spotlight is active, re-measure the
    // anchor element on every animation frame so the cutout follows scrolls
    // / route changes / list reflows.
    let rafId = 0;
    const measure = () => {
      const sl = coachSpotlight();
      if (!sl) {
        setSpotlightRect(null);
      } else {
        const sroot =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const el = sroot.querySelector(`[data-coach-anchor='${sl.anchor}']`) as HTMLElement | null;
        setSpotlightRect(el ? el.getBoundingClientRect() : null);
      }
      // also track topnav search input position for the fake demo flyout
      if (searchDemoActive()) {
        const sroot =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const input = sroot.querySelector(
          "[data-coach-anchor='topnavSearch'] input"
        ) as HTMLElement | null;
        setSearchInputRect(input ? input.getBoundingClientRect() : null);
      } else {
        setSearchInputRect(null);
      }
      // and the topnav brand-icon trigger position for the fake brand menu.
      if (topNavMenuOpen()) {
        const sroot =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const trigger = sroot.querySelector(
          "[data-coach-anchor='topnavTrigger']"
        ) as HTMLElement | null;
        setTopNavTriggerRect(trigger ? trigger.getBoundingClientRect() : null);
      } else {
        setTopNavTriggerRect(null);
      }
      rafId = requestAnimationFrame(measure);
    };
    rafId = requestAnimationFrame(measure);
    onCleanup(() => cancelAnimationFrame(rafId));

    // intercept clicks anywhere in the shadow tree so we can:
    //  1. toggle our fake brand-menu overlay when the user taps the
    //     topnav brand icon (and stop kobalte from also reacting),
    //  2. close the overlay on any click outside it.
    const sroot =
      (typeof document !== "undefined" &&
        document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
      document;
    const onPointerDown = (e: Event) => {
      const path = (e as PointerEvent).composedPath?.() || [];
      const inTrigger = path.some(
        (n) =>
          n instanceof Element && n.getAttribute?.("data-coach-anchor") === "topnavTrigger"
      );
      const inOverlay = path.some(
        (n) => n instanceof Element && n.getAttribute?.("data-fake-topnav-overlay") === ""
      );
      if (inTrigger) {
        // swallow so kobalte's NavigationMenu doesn't ALSO try to open
        // its real menu underneath our fake overlay.
        e.stopPropagation();
        e.preventDefault();
        setTopNavMenuOpenSignal((prev) => !prev);
        return;
      }
      if (topNavMenuOpen() && !inOverlay) {
        setTopNavMenuOpenSignal(false);
      }
    };
    sroot.addEventListener("pointerdown", onPointerDown, { capture: true });
    onCleanup(() =>
      sroot.removeEventListener("pointerdown", onPointerDown, { capture: true } as any)
    );
  });

  // ===== per-view filter/sort mock data feeding TopNav's pageInfo store =====
  // these mirror what the real views push via setPageInfo(), letting the
  // TopNav render its sort flyout, tag filter picker, and feed-type filter
  // controls. handlers are no-ops/local state — they don't actually filter.
  const songSortFields = [
    { value: "title", label: "title", description: "song title" },
    { value: "artist_name", label: "artist", description: "artist name" },
    { value: "album_title", label: "album", description: "album title" },
    { value: "added_at", label: "added", description: "date added" },
    { value: "duration_seconds", label: "duration", description: "track length" },
  ];
  const albumSortFields = [
    { value: "title", label: "title" },
    { value: "artist_name", label: "artist" },
    { value: "year", label: "year" },
    { value: "added_at", label: "added" },
  ];
  const playlistSortFields = [
    { value: "title", label: "title" },
    { value: "song_count", label: "songs" },
    { value: "updated_at", label: "updated" },
  ];
  const favoritesSortFields = [
    { value: "added_at", label: "added" },
    { value: "title", label: "title" },
  ];
  const mockTagOptions = [
    { value: "rock", label: "rock", count: 142 },
    { value: "electronic", label: "electronic", count: 89 },
    { value: "ambient", label: "ambient", count: 47 },
    { value: "jazz", label: "jazz", count: 33 },
    { value: "favorite", label: "favorite", count: 24 },
  ];
  const mockFeedTypes = [
    { value: "recent_listen", label: "listens" },
    { value: "favorite_added", label: "favorites" },
    { value: "playlist_updated", label: "playlists" },
    { value: "rating_added", label: "ratings" },
    { value: "song_added", label: "added" },
  ];

  const [storySortBy, setStorySortBy] = createSignal("added_at");
  const [storySortDir, setStorySortDir] = createSignal<"asc" | "desc">("desc");
  const [storyTagFilters, setStoryTagFilters] = createSignal<
    { tag: string; mode: "include" | "exclude" }[]
  >([]);
  const [storyFeedTypes, setStoryFeedTypes] = createSignal<
    { type: string; mode: "include" | "exclude" }[]
  >([]);
  const [storyMyItemsOnly, setStoryMyItemsOnly] = createSignal(false);

  const tagHandlers = {
    onAddTag: (tag: string) =>
      setStoryTagFilters([...storyTagFilters(), { tag, mode: "include" as const }]),
    onRemoveTag: (tag: string) =>
      setStoryTagFilters(storyTagFilters().filter((f) => f.tag !== tag)),
    onToggleTagMode: (tag: string) =>
      setStoryTagFilters(
        storyTagFilters().map((f) =>
          f.tag === tag ? { ...f, mode: f.mode === "include" ? "exclude" : "include" } : f
        )
      ),
    onClearAllTags: () => setStoryTagFilters([]),
  };

  const feedTypeHandlers = {
    onToggleFeedType: (type: string) => {
      const cur = storyFeedTypes();
      const has = cur.find((f) => f.type === type);
      setStoryFeedTypes(
        has ? cur.filter((f) => f.type !== type) : [...cur, { type, mode: "include" as const }]
      );
    },
    onToggleFeedTypeMode: (type: string) =>
      setStoryFeedTypes(
        storyFeedTypes().map((f) =>
          f.type === type ? { ...f, mode: f.mode === "include" ? "exclude" : "include" } : f
        )
      ),
    onRemoveFeedType: (type: string) =>
      setStoryFeedTypes(storyFeedTypes().filter((f) => f.type !== type)),
    onClearFeedTypes: () => setStoryFeedTypes([]),
    onToggleMyItems: () => setStoryMyItemsOnly(!storyMyItemsOnly()),
  };

  createEffect(() => {
    const route = currentRoute();
    const baseSort = {
      sortBy: storySortBy(),
      sortDirection: storySortDir(),
      onSortChange: (field: string, dir: "asc" | "desc") => {
        setStorySortBy(field);
        setStorySortDir(dir);
      },
    };
    const baseTags = {
      availableTags: mockTagOptions,
      selectedTagFilters: storyTagFilters(),
      ...tagHandlers,
    };
    switch (route) {
      case "songs":
        setPageInfo({
          title: "songs",
          count: generatedSongs.length,
          sortFields: songSortFields,
          defaultSortBy: "added_at",
          defaultSortDirection: "desc",
          ...baseSort,
          ...baseTags,
        });
        break;
      case "albums":
        setPageInfo({
          title: "albums",
          count: mockAlbums.length,
          sortFields: albumSortFields,
          defaultSortBy: "added_at",
          defaultSortDirection: "desc",
          ...baseSort,
          ...baseTags,
        });
        break;
      case "artists":
        setPageInfo({
          title: "artists",
          count: mockArtists.length,
          sortFields: artistSortFields,
          defaultSortBy: "name",
          defaultSortDirection: "asc",
          ...baseSort,
        });
        break;
      case "genres":
        setPageInfo({
          title: "genres",
          count: mockGenres.length,
          sortFields: genreSortFields,
          defaultSortBy: "name",
          defaultSortDirection: "asc",
          ...baseSort,
        });
        break;
      case "playlists":
        // real PlaylistsView doesn't push sortFields to the topnav, so the
        // sort icon stays hidden on this route. matching that here.
        setPageInfo({
          title: "playlists",
          count: mockPlaylists.length,
        });
        break;
      case "favorites":
        setPageInfo({
          title: "favorites",
          count: mockFavorites.length,
          sortFields: favoritesSortFields,
          defaultSortBy: "added_at",
          defaultSortDirection: "desc",
          ...baseSort,
          ...baseTags,
        });
        break;
      case "feed":
        setPageInfo({
          title: "feed",
          feedTypeOptions: mockFeedTypes,
          selectedFeedTypes: storyFeedTypes(),
          myItemsOnly: storyMyItemsOnly(),
          ...feedTypeHandlers,
        });
        break;
      case "radio":
        // TopNav hides controls on /radio anyway
        setPageInfo({ title: "radio", count: mockRadioStations.length });
        break;
      default:
        clearPageInfo();
    }
  });

  onCleanup(() => clearPageInfo());

  // player handlers
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying());
  };

  const handleSkip = (direction: "prev" | "next") => {
    const song = currentSong();
    if (!song) return;

    const currentIndex = generatedSongs.findIndex((s) => s.sha256 === song.sha256);
    if (direction === "prev" && currentIndex > 0) {
      setCurrentSong(generatedSongs[currentIndex - 1]);
    } else if (direction === "next" && currentIndex < generatedSongs.length - 1) {
      setCurrentSong(generatedSongs[currentIndex + 1]);
    }
  };

  const handleQueueSongClick = (index: number) => {
    const song = queueSongs()[index];
    if (song) {
      setCurrentSong(song);
      setIsPlaying(true);
      setCurrentQueueIndex(index);
    }
  };

  const handleRemoveFromQueue = (index: number) => {
    setQueueSongs(queueSongs().filter((_, i) => i !== index));
    if (index < currentQueueIndex()) {
      setCurrentQueueIndex(currentQueueIndex() - 1);
    }
  };

  // ===== ARTISTS VIEW (using ResponsiveMasterDetail) =====
  const artistsView = () => (
    <ResponsiveMasterDetail<Artist>
      items={sortedArtists}
      initialSelection={mockArtists[0]}
      getItemKey={(a) => a.id}
      alphabetNav={
        artistSortBy() === "name" ? (
          <div class="mt-2 wide:mt-[60px]">
            <AlphabetNav
              currentLetter={currentLetter()}
              disabledLetters={disabledLetters()}
              onLetterClick={(letter) => {
                setCurrentLetter(letter);
                console.log("jump to letter:", letter);
              }}
              sortDirection={artistSortDirection()}
            />
          </div>
        ) : undefined
      }
      renderList={(ctx) => (
        <div class="flex flex-col h-full mt-2 wide:mt-[60px]">
          <HeadingSection
            title="artists"
            count={sortedArtists().length}
            hideOnNarrow
            controls={
              <SearchSortControls
                sortBy={artistSortBy()}
                sortDirection={artistSortDirection()}
                onSortChange={(field, direction) => {
                  setArtistSortBy(field);
                  setArtistSortDirection(direction);
                }}
                sortFields={artistSortFields}
              />
            }
          />

          <div class="flex-1 overflow-y-auto" data-coach-list>
            <For each={sortedArtists()}>
              {(artist) => {
                const initials = artistInitials(artist.name);
                return (
                  <button
                    data-coach-item={artist.id}
                    class={`
                      w-full px-4 py-3 text-left transition-colors border-l-2 flex items-center gap-3
                      ${
                        ctx.selectedItem()?.id === artist.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                    onClick={() => ctx.selectItem(artist)}
                  >
                    {/* circular avatar with image-or-initials fallback,
                        mirroring real ArtistsView list rows. */}
                    <div class="w-10 h-10 rounded-full bg-[var(--color-bg-elevated)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                      <Show
                        when={artist.images && artist.images[0]}
                        fallback={
                          <span class="text-xs font-bold text-[var(--color-text-tertiary)]">
                            {initials}
                          </span>
                        }
                      >
                        <img
                          src={artist.images![0]}
                          alt={artist.name}
                          class="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </Show>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="font-medium truncate">{artist.name}</div>
                      <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                        {formatNumber(artist.songCount)} songs · {artist.albumCount} albums
                      </div>
                    </div>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      )}
      renderDetail={(ctx) => (
        <Show when={ctx.selectedItem()}>
          {(artist) => {
            // group this artist's songs by album_title to render an
            // "albums" section like the real ArtistDetailPanel (instead of
            // a flat "top songs" list).
            const albumGroups = () => {
              const groups = new Map<
                string,
                { title: string; songs: ReturnType<typeof songsForArtist> }
              >();
              for (const s of songsForArtist(artist().id)) {
                const key = s.album_title || "unknown album";
                if (!groups.has(key)) groups.set(key, { title: key, songs: [] });
                groups.get(key)!.songs.push(s);
              }
              return Array.from(groups.values());
            };
            const initials = () => artistInitials(artist().name);
            const hasImage = () => !!(artist().images && artist().images![0]);
            return (
              <div class="flex flex-col h-full">
                {/* sticky narrow-only header (matches real wide layout
                    that has no sticky header). bg-transparent so the
                    page background can show through. */}
                <Show when={ctx.isNarrow() && ctx.showingDetail()}>
                  <HeadingSection
                    title={artist().name}
                    variant="detail"
                    sticky
                    showBackButton={true}
                    onBack={() => ctx.onBack()}
                    class="px-4 py-3 relative z-20 !bg-transparent backdrop-blur-sm"
                  />
                </Show>

                {/* scrollable content area */}
                <div class="flex-1 overflow-y-auto" data-coach-detail-scroll>
                  {/* artist header: circular avatar + name + bio + genres
                      + action buttons. wide and narrow share the same
                      content but with different alignment / sizing,
                      mirroring real ArtistDetailPanel. */}
                  <div class="p-6 space-y-4">
                    <div
                      class={`flex gap-6 ${
                        ctx.isNarrow() ? "flex-col items-center text-center" : "items-start"
                      }`}
                    >
                      {/* circular artist avatar */}
                      <div class="w-32 h-32 bg-[var(--color-bg-elevated)] rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                        <Show
                          when={hasImage()}
                          fallback={
                            <span class="text-4xl font-bold text-[var(--color-text-tertiary)]">
                              {initials()}
                            </span>
                          }
                        >
                          <img
                            src={artist().images![0]}
                            alt={artist().name}
                            class="w-full h-full object-cover"
                          />
                        </Show>
                      </div>

                      {/* artist info */}
                      <div
                        class={`flex flex-col gap-2 min-w-0 flex-1 ${
                          ctx.isNarrow() ? "items-center" : "justify-center"
                        }`}
                      >
                        <Show when={!ctx.isNarrow()}>
                          <h1 class="text-3xl font-bold text-[var(--color-text-primary)]">
                            {artist().name}
                          </h1>
                        </Show>

                        {/* genre pills */}
                        <div
                          class={`flex flex-wrap gap-1.5 ${ctx.isNarrow() ? "justify-center" : ""}`}
                        >
                          <For each={artist().genres}>
                            {(genre) => (
                              <span class="px-2 py-0.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded-full text-xs">
                                {genre}
                              </span>
                            )}
                          </For>
                        </div>

                        {/* action buttons */}
                        <div class="flex items-center gap-2 flex-wrap">
                          <IconButton
                            icon="edit"
                            size="sm"
                            variant="ghost"
                            onClick={() => {}}
                            aria-label="edit artist"
                          />
                          <Button variant="primary" size="sm">
                            play all
                          </Button>
                          <Button variant="secondary" size="sm">
                            shuffle
                          </Button>
                          <Button variant="ghost" size="sm">
                            +queue
                          </Button>
                          <IconButton
                            icon="favoriteOutline"
                            size="sm"
                            variant="ghost"
                            onClick={() => {}}
                            aria-label="favorite"
                          />
                        </div>
                      </div>
                    </div>

                    {/* compact stats row instead of stats card grid */}
                    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-secondary)]">
                      <span>{formatNumber(artist().songCount)} songs</span>
                      <span>{formatNumber(artist().albumCount)} albums</span>
                      <span>{formatDuration(artist().totalDuration)}</span>
                      <span>★ {artist().avgRating.toFixed(1)}</span>
                    </div>
                  </div>

                  {/* albums section — groups songs by album, like the
                      real ArtistDetailPanel's AlbumSection list. */}
                  <div class="px-4 wide:px-6 pb-6 space-y-6">
                    <For each={albumGroups()}>
                      {(album) => (
                        <div>
                          <div class="flex items-center gap-3 mb-2">
                            <div class="w-12 h-12 rounded bg-[var(--color-bg-elevated)] flex items-center justify-center flex-shrink-0 overflow-hidden">
                              <img
                                src={`https://picsum.photos/seed/${encodeURIComponent(album.title)}/120/120`}
                                alt={album.title}
                                class="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <div class="min-w-0 flex-1">
                              <h3 class="text-base font-semibold text-[var(--color-text-primary)] truncate">
                                {album.title}
                              </h3>
                              <div class="text-xs text-[var(--color-text-tertiary)]">
                                {album.songs.length} songs ·{" "}
                                {formatDuration(
                                  album.songs.reduce((acc, s) => acc + s.duration_seconds, 0)
                                )}
                              </div>
                            </div>
                            <IconButton
                              icon="play"
                              size="sm"
                              variant="ghost"
                              onClick={() => {}}
                              aria-label="play album"
                            />
                            <IconButton
                              icon="queue"
                              size="sm"
                              variant="ghost"
                              onClick={() => {}}
                              aria-label="add album to queue"
                            />
                          </div>
                          <div class="space-y-0.5 pl-[60px]">
                            <For each={album.songs}>
                              {(song, index) => (
                                <div class="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                                  <div class="w-6 text-xs text-[var(--color-text-muted)] text-right tabular-nums">
                                    {index() + 1}
                                  </div>
                                  <div class="flex-1 min-w-0 text-sm text-[var(--color-text-primary)] truncate">
                                    {song.title}
                                  </div>
                                  <div class="text-xs text-[var(--color-text-muted)] tabular-nums">
                                    {formatDuration(song.duration_seconds)}
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            );
          }}
        </Show>
      )}
      renderEmpty={() => (
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-[var(--color-text-tertiary)]">
            <svg class="w-24 h-24 mx-auto mb-4 opacity-30" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            <p class="text-xl mb-2">select an artist</p>
            <p class="text-sm text-[var(--color-text-tertiary)]">
              choose from the list to see details
            </p>
          </div>
        </div>
      )}
    />
  );

  // ===== GENRES VIEW (using ResponsiveMasterDetail) =====
  const genresView = () => (
    <ResponsiveMasterDetail<Genre>
      items={sortedGenres}
      initialSelection={mockGenres[0]}
      getItemKey={(g) => g.id}
      renderList={(ctx) => (
        <div class="flex flex-col h-full">
          <div class="mt-2 wide:mt-[60px]">
            <HeadingSection
              title="genres"
              count={sortedGenres().length}
              hideOnNarrow
              controls={
                <SearchSortControls
                  sortBy={genreSortBy()}
                  sortDirection={genreSortDirection()}
                  onSortChange={(field, direction) => {
                    setGenreSortBy(field);
                    setGenreSortDirection(direction);
                  }}
                  sortFields={genreSortFields}
                />
              }
            />
          </div>

          <div class="flex-1 overflow-y-auto">
            <For each={sortedGenres()}>
              {(genre) => (
                <button
                  class={`
                      w-full px-6 py-3 text-left transition-colors border-l-2
                      ${
                        ctx.selectedItem()?.id === genre.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                  onClick={() => ctx.selectItem(genre)}
                >
                  <div class="font-medium">{genre.name}</div>
                  <div class="text-xs text-[var(--color-text-tertiary)]">
                    {formatNumber(genre.songCount)} songs · {genre.artistCount} artists
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      )}
      renderDetail={(ctx) => (
        <Show when={ctx.selectedItem()}>
          {(genre) => (
            <div class="flex flex-col h-full">
              {/* sticky header with back button + title */}
              <HeadingSection
                title={genre().name}
                variant="detail"
                sticky
                border
                showBackButton={ctx.isNarrow() && ctx.showingDetail()}
                onBack={() => ctx.onBack()}
              />

              {/* scrollable content area */}
              <div class="flex-1 overflow-y-auto">
                {/* stats section */}
                <div class="p-3 wide:p-6">
                  <StatsGrid columns={4} gap="md">
                    <StatsCard label="songs" value={formatNumber(genre().songCount)} icon="music" />
                    <StatsCard
                      label="artists"
                      value={formatNumber(genre().artistCount)}
                      icon="artist"
                    />
                    <StatsCard
                      label="albums"
                      value={formatNumber(genre().albumCount)}
                      icon="album"
                    />
                    <StatsCard
                      label="duration"
                      value={formatDuration(genre().totalDuration)}
                      icon="recent"
                    />
                  </StatsGrid>
                </div>

                {/* top songs */}
                <div class="px-3 wide:px-6 pb-4">
                  <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
                    top songs
                  </h3>
                  <div class="space-y-1">
                    <For each={generatedSongs.slice(0, 15)}>
                      {(song) => (
                        <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                          <IconButton icon="play" size="sm" variant="ghost" aria-label="play" />
                          <div class="flex-1 min-w-0">
                            <div class="body-small text-[var(--color-text-primary)] truncate">
                              {song.title}
                            </div>
                            <div class="caption truncate">{song.artist_name}</div>
                          </div>
                          <div class="monospace caption text-[var(--color-text-muted)]">
                            {formatDuration(song.duration_seconds)}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>

              {/* sticky action buttons */}
              <div class="sticky bottom-0 z-10 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-tertiary)] px-3 wide:px-6 py-2 wide:py-3 flex gap-2 wide:gap-3">
                <Button variant="primary">
                  <span class="hidden wide:inline">play all</span>
                  <span class="wide:hidden">play</span>
                </Button>
                <Button variant="secondary">shuffle</Button>
                <Button variant="ghost">
                  <span class="hidden wide:inline">add to queue</span>
                  <span class="wide:hidden">+queue</span>
                </Button>
              </div>
            </div>
          )}
        </Show>
      )}
      renderEmpty={() => (
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-[var(--color-text-tertiary)]">
            <p class="text-xl mb-2">select a genre</p>
            <p class="text-sm">choose from the list to see details</p>
          </div>
        </div>
      )}
    />
  );

  // ===== PLAYLISTS VIEW (using ResponsiveMasterDetail - controlled mode) =====
  // uses controlled selection so TopNav "recent playlists" can select playlists
  const playlistsView = () => (
    <ResponsiveMasterDetail<Playlist>
      items={mockPlaylists}
      selection={selectedPlaylist}
      onSelectionChange={setSelectedPlaylist}
      getItemKey={(p) => p.id}
      renderList={(ctx) => (
        <div class="flex flex-col h-full">
          <div class="mt-2 wide:mt-[60px]">
            <HeadingSection title="playlists" count={mockPlaylists.length} hideOnNarrow />
          </div>

          <div class="flex-1 overflow-y-auto" data-coach-list>
            <For each={mockPlaylists}>
              {(playlist) => (
                <button
                  data-coach-item={playlist.id}
                  class={`
                      w-full px-6 py-3 text-left transition-colors border-l-2
                      ${
                        ctx.selectedItem()?.id === playlist.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                  onClick={() => ctx.selectItem(playlist)}
                >
                  <div class="font-medium">{playlist.name}</div>
                  <div class="text-xs text-[var(--color-text-tertiary)]">
                    {playlist.songCount} songs · {formatDuration(playlist.duration)}
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      )}
      renderDetail={(ctx) => (
        <Show when={ctx.selectedItem()}>
          {(playlist) => (
            <div class="flex flex-col h-full relative">
              {/* sticky header with back button + title (narrow only,
                  matching real PlaylistsView). bg-transparent so the
                  full-page background image shows through. */}
              <Show when={ctx.isNarrow() && ctx.showingDetail()}>
                <HeadingSection
                  title={playlist().name}
                  variant="detail"
                  sticky
                  showBackButton={true}
                  onBack={() => ctx.onBack()}
                  class="px-4 py-3 relative z-20 !bg-transparent backdrop-blur-sm"
                />
              </Show>

              {/* scrollable content area */}
              <div
                class={`flex-1 overflow-y-auto ${ctx.isNarrow() ? "" : "wide:overflow-y-auto"}`}
                data-coach-detail-scroll
              >
                {/* playlist header — matches real PlaylistsView layout:
                    title, description, play count, then a wrapped row with
                    songs · duration · created, then action buttons. */}
                <div class="flex-shrink-0 p-6 relative z-10">
                  <Show when={!ctx.isNarrow()}>
                    <div class="flex items-center gap-2 mb-2">
                      <h2 class="text-2xl font-bold text-[var(--color-text-primary)]">
                        {playlist().name}
                      </h2>
                    </div>
                  </Show>

                  <p class="text-sm text-[var(--color-text-secondary)] mb-3">
                    a curated mix from your library.
                  </p>

                  <p class="text-xs text-[var(--color-text-muted)] mb-3">
                    played {12 + (playlist().songCount % 30)} times
                  </p>

                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-secondary)] mb-4">
                    <span>
                      {playlist().songCount}{" "}
                      {playlist().songCount === 1 ? "song" : "songs"}
                    </span>
                    <span>{formatDuration(playlist().duration)}</span>
                    <div class="basis-full wide:hidden" />
                    <span>created {new Date(playlist().createdAt).toLocaleDateString()}</span>
                  </div>

                  {/* action buttons row */}
                  <div class="flex gap-2 sticky top-0 py-2 z-10">
                    <IconButton
                      icon="edit"
                      size="default"
                      variant="ghost"
                      onClick={() => {}}
                      aria-label="edit playlist"
                    />
                    <Button variant="primary">play all</Button>
                    <Button variant="secondary">add to queue</Button>
                    <IconButton
                      icon="carousel"
                      size="default"
                      onClick={() => {}}
                      aria-label="view all images"
                    />
                    <IconButton
                      icon="favoriteOutline"
                      size="default"
                      variant="ghost"
                      onClick={() => {}}
                      aria-label="favorite"
                    />
                    <IconButton
                      icon="share"
                      size="default"
                      variant="ghost"
                      onClick={() => {}}
                      aria-label="share"
                    />
                  </div>
                </div>

                {/* songs list */}
                <div class="px-3 wide:px-6 pb-4">
                  <div class="space-y-1">
                    <For each={songsForPlaylist(playlist().id)}>
                      {(song, index) => (
                        <DraggableRow
                          id={song.id}
                          index={index()}
                          isDragging={draggedIndex() === index()}
                          isDropTarget={dropTargetIndex() === index()}
                          isSelected={selectedSongIds().has(song.id)}
                          onDragStart={handleDragStart(index())}
                          onDragOver={handleDragOver(index())}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop(index())}
                          onClick={handleSongClick(song)}
                        >
                          <DraggableRowSongContent
                            title={song.title}
                            artist={song.artist_name}
                            album={song.album_title}
                            durationSeconds={song.duration_seconds}
                            actions={
                              <>
                                <IconButton
                                  icon="queue"
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e: MouseEvent) => {
                                    e.stopPropagation();
                                  }}
                                  aria-label="add to queue"
                                />
                                <IconButton
                                  icon="delete"
                                  size="sm"
                                  variant="ghost"
                                  onClick={handleRemoveSong(song)}
                                  aria-label="remove"
                                />
                              </>
                            }
                          />
                        </DraggableRow>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Show>
      )}
      renderEmpty={() => (
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-[var(--color-text-tertiary)]">
            <p class="text-xl mb-2">select a playlist</p>
            <p class="text-sm">choose from the list to see details</p>
          </div>
        </div>
      )}
    />
  );

  // ===== SONGS VIEW =====
  // mirrors the real SongsView: no local HeadingSection (the title goes
  // through pageInfo into TopNav), no outer padding. instead of computing
  // the list height from window/viewport (which double-counts the player
  // bar — its parent already reserves space via padding-bottom on the
  // main content wrapper), measure the songs view container directly via
  // ResizeObserver and feed that into VirtualSongList. result: the
  // bottom-pinned header sits flush against the player bar (or against
  // the viewport bottom when no player is visible).
  let songsContainerEl: HTMLDivElement | undefined;
  const [songsContainerHeight, setSongsContainerHeight] = createSignal(320);
  const measureSongsContainer = () => {
    if (!songsContainerEl) return;
    const h = songsContainerEl.clientHeight;
    if (h > 0) setSongsContainerHeight(h);
  };
  onMount(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureSongsContainer());
    // observe lazily once the container mounts; songsContainerEl is set in
    // the JSX ref below, but we attach the observer through a microtask
    // chain so it picks up whenever the songs view (re)mounts.
    const interval = window.setInterval(() => {
      if (songsContainerEl) {
        ro.observe(songsContainerEl);
        measureSongsContainer();
        window.clearInterval(interval);
      }
    }, 50);
    onCleanup(() => {
      window.clearInterval(interval);
      ro.disconnect();
    });
  });
  const songsView = () => (
    <div
      ref={(el) => {
        songsContainerEl = el;
        queueMicrotask(measureSongsContainer);
      }}
      class="h-full w-full"
      data-coach-anchor="songsList"
    >
      <VirtualSongList
        songs={generatedSongs}
        // songsContainerHeight comes from a ResizeObserver on this same
        // container, which already excludes the parent wrapper's
        // padding-bottom (now correctly set to PLAYER_BAR_PX), so don't
        // subtract again here — that would double-count the player bar.
        height={Math.max(320, songsContainerHeight())}
        onSongClick={(song) => {
          setCurrentSong(song);
        }}
        onSongDoubleClick={(song) => {
          setCurrentSong(song);
          setIsPlaying(true);
        }}
      />
    </div>
  );

  // ===== ALBUMS VIEW =====
  const albumsView = () => (
    <div class="p-3" data-coach-anchor="albumsGrid">
      <div class="ml-0 wide:ml-[100px]">
        <HeadingSection title="albums" count={mockAlbums.length} hideOnNarrow />
      </div>
      <div class="mt-2 wide:mt-0">
        <VirtualAlbumGrid
          albums={mockAlbums.map((a) => ({
            id: a.id,
            title: a.title,
            domainType: "album" as const,
            imageUrl: placeholderSvg(a.id, a.title),
            artist: a.artist,
            album: a.title,
            year: a.year,
            trackCount: a.trackCount,
            totalDuration: formatDuration(a.duration),
            genres: "rock",
            playCount: 100,
          }))}
          height={gridHeight()}
          cardSize="medium"
          showYear={true}
          onAlbumClick={(album) => {
            console.log("album clicked:", album.title);
          }}
          onAlbumPlay={(album) => {
            console.log("play album:", album.title);
          }}
        />
      </div>
    </div>
  );

  // ===== FAVORITES VIEW =====
  const [favoritesList, setFavoritesList] = createSignal<FavoriteItem[]>(mockFavorites);
  const getFavoriteId = (item: FavoriteItem): string => {
    if (item.type === "song") return item.id;
    if (item.type === "album") return item.album_id;
    if (item.type === "artist") return item.artist_id;
    if (item.type === "playlist") return item.playlist_id;
    return "";
  };
  const favoritesView = () => (
    <div class="h-full ml-0 wide:ml-[100px]" data-coach-anchor="favoritesGrid">
      <FavoritesLayout
        favorites={favoritesList()}
        height={listHeight() + 60}
        onSongClick={(song) => {
          setCurrentSong(song as DomainSong);
        }}
        onSongPlay={(song) => {
          setCurrentSong(song as DomainSong);
          setIsPlaying(true);
        }}
        onSongFavoriteToggle={(songId, isFavorite) => {
          if (!isFavorite) {
            setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== songId));
          }
        }}
        onAlbumClick={(album) => console.log("album click:", album)}
        onAlbumPlay={(album) => console.log("album play:", album)}
        onAlbumFavoriteToggle={(albumId, isFavorite) => {
          if (!isFavorite) {
            setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== albumId));
          }
        }}
        onArtistClick={(artist) => console.log("artist click:", artist)}
        onArtistPlay={(artist) => console.log("artist play:", artist)}
        onArtistFavoriteToggle={(artistId, isFavorite) => {
          if (!isFavorite) {
            setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== artistId));
          }
        }}
        onPlaylistClick={(playlist) => {
          navigateTo("playlists");
          const found = mockPlaylists.find((p) => p.id === playlist.playlist_id);
          if (found) setSelectedPlaylist(found);
        }}
        onPlaylistPlay={(playlist) => console.log("playlist play:", playlist)}
        onPlaylistFavoriteToggle={(playlistId, isFavorite) => {
          if (!isFavorite) {
            setFavoritesList((prev) => prev.filter((fav) => getFavoriteId(fav) !== playlistId));
          }
        }}
        onArtistNavigate={(artistId) => console.log("navigate to artist:", artistId)}
        onAlbumNavigate={(albumId) => console.log("navigate to album:", albumId)}
        onGenreClick={(genre) => console.log("genre click:", genre)}
      />
    </div>
  );

  // ===== FEED VIEW =====
  // mix of "my feed" (one source) and "all feed" (multiple remotes). we render
  // the aggregate (all) feed so users can see remote attribution badges.
  const feedItems = () => {
    const items = mockRemotes.flatMap((remote) => generateFeedItems(0, 12, remote));
    // interleave by created_at so they appear chronologically
    return items.sort((a, b) => b.created_at - a.created_at);
  };
  const feedView = () => (
    <div class="p-3" data-coach-anchor="feedList">
      <div class="ml-0 wide:ml-[100px]">
        <HeadingSection title="all feed" count={feedItems().length} hideOnNarrow />
      </div>
      <div class="mt-2 wide:mt-6">
        <VirtualFeedList
          items={feedItems()}
          height={listHeight()}
          onItemClick={(item) => console.log("feed item:", item.id, item.title)}
          onGenreClick={(genreId) => console.log("genre:", genreId)}
          onAddToQueue={(item) => console.log("add to queue:", item.title)}
          scrollKey="super-story-feed"
        />
      </div>
    </div>
  );

  // ===== RADIO VIEW =====
  const [selectedStation, setSelectedStation] = createSignal(mockRadioStations[0]);
  const [showRadioDetail, setShowRadioDetail] = createSignal(false);
  const radioListens = generateRadioListenHistory(25);
  const listensForSelected = () => {
    const sel = selectedStation();
    if (!sel) return [] as ReturnType<typeof generateRadioListenHistory>;
    return radioListens.filter((l) => l.stationId === sel.id);
  };

  const tuneStation = (station: (typeof mockRadioStations)[number]) => {
    setSelectedStation(station);
    setShowRadioDetail(true);
    if (station.currentSong) {
      const songStub = {
        id: `radio-${station.id}-current`,
        sha256: `radio-${station.id}-current`,
        title: station.currentSong.title,
        artist_name: station.currentSong.artist,
        album_title: station.currentSong.album,
        duration_seconds: 240,
        is_favorite: false,
      } as unknown as DomainSong;
      setCurrentSong(songStub);
      setIsPlaying(true);
    }
  };

  const radioLeftColumn = () => (
    <div class="flex flex-col h-full min-h-0 pt-2 wide:pt-[60px]" data-coach-anchor="radioStations">
      <header class="flex items-center justify-between gap-2 px-3 py-3">
        <h1 class="text-lg font-bold">
          radio station<span class="text-[var(--color-accent-500)]">z</span>
        </h1>
        <button
          type="button"
          class="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)]"
        >
          refresh
        </button>
      </header>
      <div class="flex-1 min-h-0 overflow-y-auto p-2">
        <For
          each={[
            {
              label: "local",
              stations: mockRadioStations.filter((s) => s.id !== "radio-carps-basement"),
            },
            {
              label: "carp's basement",
              stations: mockRadioStations.filter((s) => s.id === "radio-carps-basement"),
            },
          ]}
        >
          {(group) => (
            <Show when={group.stations.length > 0}>
              <section class="mb-4">
                <div class="flex items-center justify-between px-2 mb-1">
                  <h2 class="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] truncate">
                    {group.label}
                  </h2>
                </div>
                <ul>
                  <For each={group.stations}>
                    {(station) => {
                      const isCurrent = () => selectedStation()?.id === station.id;
                      return (
                        <li>
                          <button
                            type="button"
                            class="w-full text-left flex items-center gap-2 p-2 rounded transition"
                            classList={{
                              "bg-[var(--color-accent-500)]/20": isCurrent(),
                              "hover:bg-[var(--color-bg-hover)]": !isCurrent(),
                            }}
                            onClick={() => tuneStation(station)}
                          >
                            <div class="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
                              <img
                                src={station.thumbnailUrl}
                                alt=""
                                class="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <div class="flex-1 min-w-0">
                              <div class="text-sm font-medium truncate">{station.name}</div>
                              <div class="text-[11px] text-[var(--color-text-tertiary)] truncate">
                                {station.listenerCount} listening
                                <Show when={station.currentSong}>
                                  {(cur) => <> · {cur().title}</>}
                                </Show>
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </section>
            </Show>
          )}
        </For>
      </div>
    </div>
  );

  const radioRightColumn = () => (
    <div class="flex flex-col h-full min-h-0">
      <Show
        when={selectedStation()}
        fallback={
          <div class="flex-1 overflow-y-auto flex flex-col items-center text-center p-8 text-[var(--color-text-tertiary)]">
            <div class="w-32 h-32 rounded-lg bg-gradient-to-tr from-magenta-900 to-purple-700 flex items-center justify-center mb-4">
              <span class="text-xs font-bold tracking-widest opacity-60 text-white">
                <Icon name="radioTower" size={64} />R A D I O
              </span>
            </div>
            <p class="text-sm max-w-xs mb-8">
              pick a station from the list to tune in && tune out.
            </p>
          </div>
        }
      >
        {(station) => (
          <div class="flex-1 min-h-0 overflow-y-auto">
            <div class="px-6 pb-6 pt-3 wide:pt-6 max-w-3xl mx-auto w-full h-full min-h-0 flex flex-col">
              <header class="flex items-center gap-4 mb-6">
                <div class="flex-shrink-0">
                  <div class="w-32 h-32 sm:w-40 sm:h-40 rounded-lg overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900">
                    <img src={station().thumbnailUrl} alt="" class="w-full h-full object-cover" />
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-3 mb-1 min-h-8">
                    <div class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      now playing
                    </div>
                    <button
                      type="button"
                      class="wide:hidden text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] flex items-center gap-1 flex-shrink-0"
                      onClick={() => setShowRadioDetail(false)}
                      aria-label="back to station list"
                    >
                      <span aria-hidden="true">←</span> back
                    </button>
                  </div>
                  <Show when={station().currentSong} fallback={<div>—</div>}>
                    {(np) => (
                      <>
                        <div class="text-2xl font-bold truncate">{np().title}</div>
                        <div class="text-base text-[var(--color-text-secondary)] truncate">
                          {np().artist} — {np().album}
                        </div>
                      </>
                    )}
                  </Show>
                  <div class="mt-3 text-sm text-[var(--color-text-tertiary)]">
                    <div class="font-medium">{station().name}</div>
                    <Show when={station().description}>
                      <div class="text-xs">{station().description}</div>
                    </Show>
                    <div class="text-xs mt-1">
                      {station().listenerCount} listener
                      {station().listenerCount === 1 ? "" : "s"} · {station().codec} ·{" "}
                      {station().play_mode}
                    </div>
                    <button
                      type="button"
                      class="mt-2 text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] transition-colors"
                    >
                      share
                    </button>
                  </div>
                </div>
              </header>

              <div class="flex-1 min-h-0">
                <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
                  recent listens
                </h3>
                <div class="space-y-1">
                  <For each={listensForSelected().length > 0 ? listensForSelected() : radioListens}>
                    {(listen) => (
                      <div class="flex items-center gap-3 p-2 bg-[var(--color-bg-secondary)] rounded text-sm">
                        <span class="text-xs px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] shrink-0">
                          {listen.stationName}
                        </span>
                        <div class="flex-1 min-w-0">
                          <div class="text-[var(--color-text-primary)] truncate">
                            {listen.artistName} — {listen.songTitle}
                          </div>
                          <div class="caption truncate">{listen.albumTitle}</div>
                        </div>
                        <div class="monospace caption text-[var(--color-text-muted)] shrink-0">
                          {formatDuration(listen.durationSeconds)}
                        </div>
                        <div class="caption text-[var(--color-text-tertiary)] shrink-0">
                          {Math.floor((Date.now() - listen.playedAt) / 60_000)}m ago
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );

  const radioView = () => (
    <div class="ml-0 wide:ml-[100px] h-full">
      <TwoColumnLayout
        leftColumn={radioLeftColumn()}
        rightColumn={radioRightColumn()}
        leftColumnWidth={240}
        showDetail={showRadioDetail()}
        onBack={() => setShowRadioDetail(false)}
      />
    </div>
  );

  // determine which view to show
  const ROUTES_WITH_LIBRARY: Route[] = [
    "songs",
    "albums",
    "artists",
    "genres",
    "playlists",
    "favorites",
  ];
  const emptyLibraryView = () => (
    <div class="flex h-full w-full items-center justify-center p-6">
      <div class="text-center max-w-md">
        <div class="mb-6 flex justify-center">
          <Icon name="freqhole" size={160} color="var(--color-accent-500)" />
        </div>
        <h1 class="text-3xl font-bold text-[var(--color-text-primary)] mb-3">
          welcome to freqhole
        </h1>
        <p class="text-[var(--color-text-secondary)] mb-5 leading-snug">
          get started by adding music, connecting to a remote server, or tuning into a radio
          station.
        </p>
        <div class="flex gap-3 justify-center flex-wrap">
          <button
            type="button"
            data-coach-anchor="addMusicButton"
            class="px-4 py-2 text-sm rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border-default)]"
            onClick={() => runFakeLibraryScan({ durationMs: 1500 })}
          >
            add music
          </button>
          <button
            type="button"
            data-coach-anchor="addRemoteButton"
            class="px-4 py-2 text-sm rounded-md bg-[var(--color-accent-500,#d63384)] text-white hover:opacity-90"
            onClick={() => setActiveModal("add-remote")}
          >
            add remote
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border-default)]"
            onClick={() => navigateTo("radio")}
          >
            listen to radio
          </button>
        </div>
        <div class="mt-4 text-sm text-[var(--color-text-muted)] italic">...or go to settings</div>
        <Show when={fakeScanRunning() || fakeScanProgress() >= 1}>
          <div class="mt-6 mx-auto max-w-xs">
            <div class="text-xs text-[var(--color-text-secondary)] mb-1.5 text-left">
              <Show
                when={fakeScanRunning()}
                fallback={
                  <span class="text-[var(--color-accent-500,#d63384)]">
                    scan complete · 247 songs added
                  </span>
                }
              >
                scanning local files… {Math.round(fakeScanProgress() * 100)}%
              </Show>
            </div>
            <div class="h-1.5 w-full rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
              <div
                class="h-full bg-[var(--color-accent-500,#d63384)] transition-[width]"
                style={{ width: `${Math.round(fakeScanProgress() * 100)}%` }}
              />
            </div>
          </div>
        </Show>
      </div>
    </div>
  );

  // ===== REMOTES VIEW (stub) =====
  // NOTE: no internal `overflow-y-auto` here — on mobile that creates a touch
  // target that swallows page-scroll swipes, freezing the user on this step.
  // the parent already clips, so excess content just truncates (fine for demo).
  const remotesView = () => (
    <div class="p-3 ml-0 wide:ml-[100px]" data-coach-anchor="remotesList">
      <HeadingSection title="remotes" count={mockRemotes.length} hideOnNarrow />
      <div class="mt-4 space-y-3">
        <For each={mockRemotes}>
          {(remote) => (
            <div class="flex items-center justify-between rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-2">
              <div>
                <div class="text-sm font-medium text-[var(--color-text-primary)]">
                  {remote.name}
                </div>
                <div class="text-xs text-[var(--color-text-tertiary)]">
                  {remote.id === "remote-carps-basement"
                    ? `${mockRemoteSongs.length} songs · dub, jazz, library oddities`
                    : "connected"}
                </div>
              </div>
              <span class="text-[10px] uppercase tracking-wider text-[var(--color-accent-500,#d63384)]">
                online
              </span>
            </div>
          )}
        </For>
      </div>
      <h3 class="mt-8 mb-2 text-sm font-semibold text-[var(--color-text-secondary)]">
        recently shared from carp's basement
      </h3>
      <div class="space-y-2">
        <For each={mockRemoteSongs}>
          {(s) => (
            <div class="flex items-center gap-3 rounded-md bg-[var(--color-bg-secondary)] px-3 py-2">
              <img
                src={s.thumbnailUrl}
                alt=""
                class="w-10 h-10 rounded object-cover flex-shrink-0"
              />
              <div class="min-w-0 flex-1">
                <div class="text-sm text-[var(--color-text-primary)] truncate">{s.title}</div>
                <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                  {s.artist} — {s.album} · {s.year}
                </div>
              </div>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-primary)] text-[var(--color-text-tertiary)]">
                {s.genre}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );

  // ===== ADD REMOTE / KNOCK FLOW MODAL (story-only) =====
  // multi-phase mock of the "mount a friend's library" flow. real spume
  // implementation is more involved; this story renders a fake modal whose
  // contents switch on `knockPhase()`, driven by coach script slides.
  const addRemoteModal = () => (
    <Show when={activeModal() === "add-remote"}>
      <div
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60"
        onClick={() => setActiveModal(null)}
      >
        <div
          class="w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1a1a1a)] p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <Show when={knockPhase() === "id-form"}>
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
              add a remote
            </h2>
            <p class="text-xs text-[var(--color-text-secondary)] mb-4">
              paste a node id or share url from a friend.
            </p>
            <div data-coach-anchor="knockNodeIdInput">
              <input
                type="text"
                placeholder="freqhole://…"
                class="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] font-mono"
              />
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
                onClick={() => setActiveModal(null)}
              >
                cancel
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded bg-[var(--color-accent-500,#d63384)] text-white"
                onClick={() => setKnockPhase("loading")}
              >
                connect
              </button>
            </div>
          </Show>

          <Show when={knockPhase() === "loading"}>
            <div class="flex flex-col items-center text-center py-6">
              <div class="w-12 h-12 rounded-full border-4 border-[var(--color-accent-500,#d63384)] border-t-transparent animate-spin mb-4" />
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">knocking…</h2>
              <p class="text-xs text-[var(--color-text-secondary)] mt-2">
                reaching out to carp.basement
              </p>
            </div>
          </Show>

          <Show when={knockPhase() === "request-form"}>
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
              request access
            </h2>
            <p class="text-xs text-[var(--color-text-secondary)] mb-4">
              this remote requires approval. send a knock with a quick note so the host knows it's
              you.
            </p>
            <label class="block text-xs text-[var(--color-text-secondary)] mb-1">your name</label>
            <div data-coach-anchor="knockNameInput" class="mb-3">
              <input
                type="text"
                placeholder="dj edward"
                class="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              />
            </div>
            <label class="block text-xs text-[var(--color-text-secondary)] mb-1">
              message (optional)
            </label>
            <div data-coach-anchor="knockMessageInput" class="mb-1">
              <textarea
                rows={3}
                placeholder="hey carp, mind if i borrow your dub crates?"
                class="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] resize-none"
              />
            </div>
            <div class="mt-4 flex justify-end gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
                onClick={() => setActiveModal(null)}
              >
                cancel
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded bg-[var(--color-accent-500,#d63384)] text-white"
                onClick={() => setKnockPhase("pending")}
              >
                send knock
              </button>
            </div>
          </Show>

          <Show when={knockPhase() === "pending"}>
            <div class="text-center py-2">
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                request sent
              </h2>
              <p class="text-xs text-[var(--color-text-secondary)] mb-5">
                waiting for carp to approve. you can keep using freqhole — the remote will mount
                automatically once they accept.
              </p>
              <div class="flex items-center justify-center gap-2 mb-3 text-xs text-[var(--color-text-tertiary)]">
                <span class="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                <span>pending — carp's basement</span>
              </div>
              <div class="flex justify-center">
                <button
                  type="button"
                  data-coach-anchor="knockRefreshButton"
                  class="px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                  onClick={() => setKnockPhase("approved")}
                >
                  refresh
                </button>
              </div>
            </div>
          </Show>

          <Show when={knockPhase() === "approved"}>
            <div class="text-center py-4">
              <div class="w-12 h-12 mx-auto rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                <svg
                  class="w-6 h-6 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="3"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">approved!</h2>
              <p class="text-xs text-[var(--color-text-secondary)]">mounting carp's basement…</p>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );

  // ===== ALBUM DETAIL VIEW (stub) =====
  // pick an album that the "pink" search matches, so the search -> album-detail
  // step transition feels natural.
  const detailAlbum = () => mockAlbums.find((a) => /pink/i.test(a.artist)) || mockAlbums[0];
  const detailTracks = () => generatedSongs.slice(0, 9);
  const albumDetailView = () => {
    const a = detailAlbum();
    return (
      <div class="p-4 ml-0 wide:ml-[100px]" data-coach-anchor="albumDetail">
        <div class="flex flex-col wide:flex-row gap-5 mb-5">
          <img
            src={placeholderSvg(a.id, a.title)}
            alt=""
            class="w-44 h-44 rounded-md object-cover flex-shrink-0 shadow-lg border border-[var(--color-border-default)]"
          />
          <div class="flex-1 min-w-0">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
              album
            </div>
            <h1 class="text-2xl font-bold text-[var(--color-text-primary)] mb-1 truncate">
              {a.title}
            </h1>
            <div class="text-sm text-[var(--color-text-secondary)] mb-1">{a.artist}</div>
            <div class="text-xs text-[var(--color-text-tertiary)] mb-4">
              {a.year} · {a.trackCount} tracks · {formatDuration(a.duration)}
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded bg-[var(--color-accent-500,#d63384)] text-white"
                onClick={() => setIsPlaying(true)}
              >
                play
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)]"
                onClick={() => setActiveModal("album-edit")}
              >
                edit
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)]"
                onClick={() => setActiveModal("share")}
              >
                share
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-xs rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)]"
              >
                favorite
              </button>
            </div>
          </div>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-[var(--color-text-secondary)] mb-2">tracks</h3>
          <div class="space-y-1">
            <For each={detailTracks()}>
              {(t, i) => (
                <div class="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-[var(--color-bg-secondary)] text-sm">
                  <span class="w-6 text-right text-xs text-[var(--color-text-tertiary)] font-mono">
                    {i() + 1}
                  </span>
                  <span class="flex-1 min-w-0 truncate text-[var(--color-text-primary)]">
                    {t.title}
                  </span>
                  <span class="text-xs text-[var(--color-text-tertiary)] font-mono">
                    {formatDuration(t.duration_seconds ?? 180)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    );
  };

  // ===== SHARES VIEW (stub) — list of shares received =====
  const mockReceivedShares = [
    {
      id: "rs-1",
      from: "carp",
      title: "the dark side of the moon",
      type: "album",
      receivedAgo: "2 hrs ago",
      status: "mounted",
    },
    {
      id: "rs-2",
      from: "lou",
      title: "midnight blue",
      type: "playlist",
      receivedAgo: "yesterday",
      status: "mounted",
    },
    {
      id: "rs-3",
      from: "carp",
      title: "basement.fm",
      type: "station",
      receivedAgo: "3 days ago",
      status: "mounted",
    },
    {
      id: "rs-4",
      from: "ren",
      title: "summer mixtape '24",
      type: "playlist",
      receivedAgo: "1 wk ago",
      status: "expired",
    },
  ];
  const sharesView = () => (
    <div class="p-3 ml-0 wide:ml-[100px]" data-coach-anchor="sharesList">
      <HeadingSection title="shares" count={mockReceivedShares.length} hideOnNarrow />
      <p class="text-xs text-[var(--color-text-tertiary)] mb-3 max-w-prose">
        every share you've ever received. accept new ones, re-mount old ones, or just go look up
        what someone sent you that one time.
      </p>
      <div class="space-y-2">
        <For each={mockReceivedShares}>
          {(s) => (
            <div class="flex items-center gap-3 rounded-md bg-[var(--color-bg-secondary)] px-3 py-2 border border-[var(--color-border-default)]">
              <div class="w-9 h-9 rounded bg-[var(--color-bg-tertiary)] flex items-center justify-center text-[10px] uppercase text-[var(--color-text-tertiary)] font-bold">
                {s.type[0]}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm text-[var(--color-text-primary)] truncate">{s.title}</div>
                <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                  {s.type} · from {s.from} · {s.receivedAgo}
                </div>
              </div>
              <span
                class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                classList={{
                  "bg-[var(--color-accent-500,#d63384)] text-white": s.status === "mounted",
                  "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]":
                    s.status !== "mounted",
                }}
              >
                {s.status}
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );

  // ===== ALBUM EDIT MODAL (stub) =====
  const albumEditModal = () => (
    <Show when={activeModal() === "album-edit"}>
      <div
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-3"
        data-coach-anchor="albumEditModal"
        onClick={() => setActiveModal(null)}
      >
        <div
          class="w-full max-w-2xl rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1a1a1a)] p-5 shadow-2xl max-h-[90%] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">edit album</h2>
          <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
            edit metadata by hand or pull canonical info from musicbrainz.
          </p>
          <div class="grid grid-cols-1 wide:grid-cols-2 gap-4">
            <div class="space-y-3">
              <label class="block">
                <span class="text-xs text-[var(--color-text-secondary)]">title</span>
                <div data-coach-anchor="albumEditTitle">
                  <input
                    type="text"
                    value={detailAlbum().title}
                    class="mt-1 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                  />
                </div>
              </label>
              <label class="block">
                <span class="text-xs text-[var(--color-text-secondary)]">artist</span>
                <input
                  type="text"
                  value={detailAlbum().artist}
                  class="mt-1 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                />
              </label>
              <label class="block">
                <span class="text-xs text-[var(--color-text-secondary)]">year</span>
                <input
                  type="number"
                  value={detailAlbum().year}
                  class="mt-1 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                />
              </label>
              <label class="block">
                <span class="text-xs text-[var(--color-text-secondary)]">genre</span>
                <input
                  type="text"
                  value="dub"
                  class="mt-1 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                />
              </label>
            </div>
            <div class="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3">
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wider">
                  musicbrainz
                </h3>
                <button
                  type="button"
                  class="text-[10px] px-2 py-1 rounded bg-[var(--color-accent-500,#d63384)] text-white"
                >
                  fetch
                </button>
              </div>
              <p class="text-[11px] text-[var(--color-text-tertiary)] mb-3 leading-snug">
                pull cover art, year, track titles, credits — all from the open musicbrainz
                database. one click and your messy rip is canonical.
              </p>
              <div class="space-y-1.5">
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  <span class="text-[var(--color-text-secondary)]">cover art match (96%)</span>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  <span class="text-[var(--color-text-secondary)]">9/9 tracks matched</span>
                </div>
                <div class="flex items-center gap-2 text-xs">
                  <span class="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
                  <span class="text-[var(--color-text-secondary)]">2 alternate releases</span>
                </div>
              </div>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              onClick={() => setActiveModal(null)}
            >
              cancel
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded bg-[var(--color-accent-500,#d63384)] text-white"
              onClick={() => setActiveModal(null)}
            >
              save
            </button>
          </div>
        </div>
      </div>
    </Show>
  );

  // ===== SHARE MODAL (stub) — sender side =====
  const shareModal = () => (
    <Show when={activeModal() === "share"}>
      <div
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-3"
        data-coach-anchor="shareModal"
        onClick={() => setActiveModal(null)}
      >
        <div
          class="w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1a1a1a)] p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">share album</h2>
          <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
            send this link to a friend. they paste it into freqhole and your album shows up
            alongside theirs — streamed live from your machine when they listen.
          </p>
          <div class="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3 mb-3">
            <div class="flex items-center gap-3">
              <img
                src={placeholderSvg(detailAlbum().id, detailAlbum().title)}
                alt=""
                class="w-12 h-12 rounded object-cover"
              />
              <div class="min-w-0">
                <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {detailAlbum().title}
                </div>
                <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                  {detailAlbum().artist}
                </div>
              </div>
            </div>
          </div>
          <label class="block text-xs text-[var(--color-text-secondary)] mb-1">share link</label>
          <div class="flex gap-2 mb-4">
            <input
              type="text"
              readOnly
              value="freqhole://you/share/album/dark-side-of-the-moon/3f9c2"
              class="flex-1 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] font-mono"
            />
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded bg-[var(--color-accent-500,#d63384)] text-white"
            >
              copy
            </button>
          </div>
          <div class="flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)] mb-4">
            <label class="flex items-center gap-1.5">
              <input type="checkbox" checked class="accent-[var(--color-accent-500)]" />
              expires in 7 days
            </label>
            <label class="flex items-center gap-1.5">
              <input type="checkbox" class="accent-[var(--color-accent-500)]" />
              require approval
            </label>
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              onClick={() => setActiveModal(null)}
            >
              done
            </button>
          </div>
        </div>
      </div>
    </Show>
  );

  // ===== RESOLVE SHARE MODAL (stub) — receiver side =====
  const resolveShareModal = () => (
    <Show when={activeModal() === "resolve-share"}>
      <div
        class="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-3"
        onClick={() => setActiveModal(null)}
      >
        <div
          class="w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated,#1a1a1a)] p-5 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-accent-500,#d63384)] text-white">
              new share
            </span>
            <span class="text-xs text-[var(--color-text-tertiary)]">from carp</span>
          </div>
          <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
            carp shared an album with you
          </h2>
          <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
            mount it now to start listening, or save it for later — it'll always be in your shares
            list.
          </p>
          <div class="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-3 mb-4">
            <div class="flex items-center gap-3">
              <img
                src={placeholderSvg(detailAlbum().id, detailAlbum().title)}
                alt=""
                class="w-14 h-14 rounded object-cover"
              />
              <div class="min-w-0">
                <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {detailAlbum().title}
                </div>
                <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                  {detailAlbum().artist} · {detailAlbum().year}
                </div>
                <div class="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                  {detailAlbum().trackCount} tracks
                </div>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
              onClick={() => setActiveModal(null)}
            >
              save for later
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded bg-[var(--color-accent-500,#d63384)] text-white"
              onClick={() => setActiveModal(null)}
            >
              mount
            </button>
          </div>
        </div>
      </div>
    </Show>
  );

  const mainContent = () => {
    const route = currentRoute();
    if (route === "remotes") return remotesView();
    if (route === "album-detail") return albumDetailView();
    if (route === "shares") return sharesView();
    if (demoLibraryMode() === "empty" && ROUTES_WITH_LIBRARY.includes(route)) {
      return emptyLibraryView();
    }
    switch (route) {
      case "songs":
        return songsView();
      case "albums":
        return albumsView();
      case "favorites":
        return favoritesView();
      case "artists":
        return (
          <div class="h-full" data-coach-anchor="artistsView">
            {artistsView()}
          </div>
        );
      case "genres":
        return genresView();
      case "playlists":
        return (
          <div class="h-full" data-coach-anchor="playlistsView">
            {playlistsView()}
          </div>
        );
      case "feed":
        return feedView();
      case "radio":
        return radioView();
      default:
        return artistsView();
    }
  };

  const playerBarHeight = () => (isPlayerBarVisible() ? `${PLAYER_BAR_PX}px` : "0px");

  // playlist view sets a full-page background image (mirrors real spume's
  // setBackgroundImage() service in AppLayout). uses picsum at viewport
  // resolution so the bg isn't pixelated. deterministic per playlist id.
  const playlistBackgroundUrl = () => {
    if (currentRoute() !== "playlists") return null;
    const p = selectedPlaylist();
    if (!p) return null;
    const seed = encodeURIComponent(p.id);
    return `https://picsum.photos/seed/${seed}/1600/1000`;
  };

  // mirror real PlaylistsView: when a playlist is selected on the playlists
  // route, push the bg into the global service so TwoColumnLayout (and any
  // other component that reads getBackgroundConfig) flips to transparent.
  // clear it on route change / unmount.
  createEffect(() => {
    const url = playlistBackgroundUrl();
    if (url) {
      setBackgroundImage({ imageUrl: url, overlayOpacity: 0.6 });
    } else {
      clearBackgroundImage();
    }
  });
  onCleanup(() => clearBackgroundImage());

  return (
    <QueryClientProvider client={storyQueryClient}>
      <div
        ref={storyRootEl}
        class="h-full min-h-screen wide:min-h-0 flex flex-col"
        classList={{
          "bg-[var(--color-bg-primary)]": !getBackgroundConfig(),
          "bg-transparent": !!getBackgroundConfig(),
        }}
        style={{ "--player-bar-height": playerBarHeight(), height: "100%" }}
      >
        {/* full-page background image (when set by a view). matches the
            real app's bgConfig render in AppLayout exactly. */}
        <Show when={getBackgroundConfig()}>
          {(config) => (
            <>
              <div
                class="fixed inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-500 pointer-events-none"
                style={{
                  "background-image": `url(${config().imageUrl})`,
                  "z-index": "-2",
                }}
              />
              <div
                class="fixed inset-0 bg-black transition-opacity duration-500 pointer-events-none"
                style={{ opacity: config().overlayOpacity ?? 0.7, "z-index": "-1" }}
              />
            </>
          )}
        </Show>
        {/* top navigation — hidden during the empty/welcome state so the
            empty-library hero is unencumbered. */}
        <Show when={demoLibraryMode() !== "empty"}>
          <div
            data-coach-anchor="topnavSearch"
            onMouseEnter={() => setTopNavHovered(true)}
            onMouseLeave={() => setTopNavHovered(false)}
          >
            <TopNav
              brandName="freqhole"
              brandTagline="your music library"
              currentPath={`/${currentRoute()}`}
              currentSourceName="local library"
              currentSourceId={null}
              remotes={mockRemotes
                .filter((r) => r.id === "remote-carps-basement")
                .map((r) => ({ id: r.id, name: r.name, url: `https://${r.id}.example` }))}
              onSwitchToLocal={() => console.log("switch to local")}
              onSwitchToRemote={(id) => console.log("switch to remote:", id)}
              storageUsage={3.2 * 1024 * 1024 * 1024}
              storageQuota={8 * 1024 * 1024 * 1024}
              searchPlaceholder="search artists, albums, songs..."
              searchComponent={
                <TopNavSearch
                  placeholder="search artists, albums, songs..."
                  suggestions={mockSearchSuggestions()}
                  onSearchChange={setSearchValue}
                  onNavigate={(path) => console.log("navigate:", path)}
                  currentPath={`/${currentRoute()}`}
                  navHovered={topNavHovered()}
                  flyoutMount={flyoutMount()}
                />
              }
              onSearchChange={(query) => console.log("search:", query)}
              onSearchSubmit={(query) => console.log("search submit:", query)}
              mainNavSections={[
                {
                  items: [
                    {
                      label: "songs",
                      onClick: () => navigateTo("songs"),
                    },
                    {
                      label: "albums",
                      onClick: () => navigateTo("albums"),
                    },
                    {
                      label: "artists",
                      onClick: () => navigateTo("artists"),
                    },
                    {
                      label: "genres",
                      onClick: () => navigateTo("genres"),
                    },
                    {
                      label: "playlists",
                      onClick: () => navigateTo("playlists"),
                    },
                    {
                      label: "favorites",
                      onClick: () => navigateTo("favorites"),
                    },
                    {
                      label: "feed",
                      onClick: () => navigateTo("feed"),
                    },
                    {
                      label: "radio",
                      onClick: () => navigateTo("radio"),
                    },
                  ],
                },
              ]}
              recentPlaylists={mockPlaylists.slice(0, 5).map((playlist, index) => ({
                id: playlist.id,
                name: playlist.name,
                thumbnailUrl: placeholderSvg(playlist.id, playlist.name),
                updatedAt: Date.now() - index * 3600000,
                onClick: () => {
                  navigateTo("playlists");
                  setSelectedPlaylist(playlist);
                },
              }))}
              onViewAllPlaylists={() => navigateTo("playlists")}
              pageTitle={pageInfo().title}
              pageCount={pageInfo().count}
              viewOptions={[
                { label: "songs", path: "/songs", count: generatedSongs.length },
                { label: "albums", path: "/albums", count: mockAlbums.length },
                { label: "artists", path: "/artists", count: mockArtists.length },
                { label: "genres", path: "/genres", count: mockGenres.length },
                { label: "playlists", path: "/playlists", count: mockPlaylists.length },
                { label: "favorites", path: "/favorites", count: mockFavorites.length },
                { label: "feed", path: "/feed" },
                { label: "radio", path: "/radio", count: mockRadioStations.length },
              ]}
              onNavigate={(path) => {
                const route = path.replace(/^\//, "") as Route;
                if (
                  route === "songs" ||
                  route === "albums" ||
                  route === "artists" ||
                  route === "genres" ||
                  route === "playlists" ||
                  route === "favorites" ||
                  route === "feed" ||
                  route === "radio"
                ) {
                  navigateTo(route);
                }
              }}
            />
          </div>

          {/* demo-only fake brand-menu flyout. the real one (kobalte
              NavigationMenu inside TopNav) doesn't open reliably inside
              the coach-demo shadow DOM, so we render a static lookalike
              anchored to the brand-icon trigger's bounding rect. open
              state is owned by `topNavMenuOpen` and toggled by the coach
              script and by clicks on the brand icon (intercepted in the
              shared shadow-root pointerdown listener above). */}
          <Show when={topNavMenuOpen()}>
            {(_) => {
              const r = topNavTriggerRect();
              const top = r ? r.bottom + 4 : 60;
              const left = r ? Math.max(8, r.left) : 8;
              return (
                <div
                  data-fake-topnav-overlay=""
                  data-coach-anchor="remoteSourceList"
                  class="fixed bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl overflow-hidden flex flex-col"
                  style={{
                    top: `${top}px`,
                    left: `${left}px`,
                    width: "320px",
                    "max-height": "70vh",
                    "z-index": "1001",
                  }}
                >
                  {/* brand header */}
                  <div class="flex items-start justify-between p-4 border-b border-[var(--color-border-subtle)]">
                    <div>
                      <h3 class="text-lg font-bold m-0 text-[var(--color-text-primary)]">
                        freqhole
                      </h3>
                      <p class="text-xs text-[var(--color-text-muted)] m-0 mt-1">
                        your music library
                      </p>
                    </div>
                  </div>

                  {/* music source */}
                  <div class="p-4">
                    <h4 class="text-xs text-[var(--color-text-muted)] uppercase tracking-wide font-medium m-0 mb-2">
                      music source
                    </h4>
                    <div class="space-y-1">
                      <button
                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded text-[var(--color-text-primary)] bg-[var(--color-accent-500)]/10 cursor-default border-none"
                        disabled
                      >
                        <Icon name="check" size={14} color="var(--color-accent-500)" />
                        <span>local library</span>
                      </button>
                      <button
                        class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer border-none bg-transparent"
                        onClick={() => {
                          setTopNavMenuOpenSignal(false);
                          console.log("switch to remote: carps basement");
                        }}
                      >
                        <span class="w-2 h-2 rounded-full bg-[var(--color-status-success)]" />
                        <span class="truncate">carp's basement</span>
                      </button>
                    </div>
                  </div>

                  {/* nav links */}
                  <div class="px-4 pb-4 border-t border-[var(--color-border-subtle)] pt-3 space-y-0.5">
                    <For
                      each={[
                        { label: "all feeds", route: "feed" as Route },
                        { label: "radio", route: "radio" as Route },
                        { label: "playlists", route: "playlists" as Route },
                      ]}
                    >
                      {(item) => (
                        <button
                          class="w-full px-3 py-2 text-left text-sm rounded transition-colors border-none bg-transparent cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/10"
                          onClick={() => {
                            setTopNavMenuOpenSignal(false);
                            navigateTo(item.route);
                          }}
                        >
                          {item.label}
                        </button>
                      )}
                    </For>
                  </div>

                  {/* storage usage */}
                  <div class="px-4 pb-4 mt-auto">
                    <div class="flex items-center gap-2 px-3 py-2 rounded bg-[var(--color-bg-secondary)] text-xs">
                      <Icon name="database" size={14} />
                      <div class="flex flex-col">
                        <span class="text-[var(--color-text-secondary)]">3.2 GB / 8 GB</span>
                        <span class="text-[var(--color-text-tertiary)]">40% used</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }}
          </Show>

          {/* demo-only fake suggestions flyout. the real one lives in
              SearchInput, behind a debounced input handler + portal mount,
              and was a nightmare to drive reliably from a script. so for
              the coach demo we just render a static lookalike here.
              positioned under the topnav search input via tracked rect. */}
          <Show when={searchDemoActive()}>
            {(_) => {
              const r = searchInputRect();
              const top = r ? r.bottom + 4 : 60;
              const wide = !isNarrow();
              return (
                <div
                  class="fixed bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg overflow-hidden"
                  style={{
                    top: `${top}px`,
                    left: wide && r ? `${r.left}px` : "0",
                    right: wide && r ? "auto" : "0",
                    width: wide && r ? `${Math.max(r.width, 320)}px` : "100vw",
                    "border-radius": wide ? undefined : "0",
                    "z-index": "1002",
                  }}
                >
                  <div role="listbox" class="max-h-80 overflow-y-auto">
                    <For
                      each={(() => {
                        const q = searchDemoQuery().toLowerCase();
                        if (!q) return [] as { id: string; text: string; category: string }[];
                        const items: { id: string; text: string; category: string }[] = [];
                        for (const a of mockArtists) {
                          if (a.name.toLowerCase().includes(q))
                            items.push({ id: `a-${a.id}`, text: a.name, category: "artists" });
                          if (items.length >= 3) break;
                        }
                        for (const s of generatedSongs) {
                          if (s.title.toLowerCase().includes(q))
                            items.push({ id: `s-${s.id}`, text: s.title, category: "songs" });
                          if (items.length >= 6) break;
                        }
                        for (const al of mockAlbums) {
                          if (al.title.toLowerCase().includes(q))
                            items.push({ id: `al-${al.id}`, text: al.title, category: "albums" });
                          if (items.length >= 8) break;
                        }
                        return items;
                      })()}
                    >
                      {(item) => (
                        <div
                          role="option"
                          class="flex items-center gap-3 px-4 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                        >
                          <div
                            class="w-8 h-8 rounded flex-shrink-0 bg-[var(--color-bg-tertiary)]"
                            aria-hidden="true"
                          />
                          <div class="flex-1 min-w-0 truncate">{item.text}</div>
                          <div class="px-2 py-1 rounded text-xs font-medium flex-shrink-0 bg-[var(--color-accent-500)]/10 text-[var(--color-accent-500)]">
                            {item.category}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              );
            }}
          </Show>
        </Show>

        {/* coach spotlight overlay — dims everything except the bbox of the
            anchor element. uses box-shadow to paint the dimming around a
            transparent rect for clean GPU-friendly rendering. */}
        <Show when={coachSpotlight() && spotlightRect()}>
          {(_) => {
            const sl = coachSpotlight()!;
            const r = spotlightRect()!;
            const pad = 8;
            const dim = 0.7 * sl.intensity;
            return (
              <div
                aria-hidden="true"
                style={{
                  position: "fixed",
                  top: `${r.top - pad}px`,
                  left: `${r.left - pad}px`,
                  width: `${r.width + 2 * pad}px`,
                  height: `${r.height + 2 * pad}px`,
                  "border-radius": "10px",
                  "box-shadow": `0 0 0 9999px rgba(0,0,0,${dim}), 0 0 0 2px rgba(214,51,132,${0.6 * sl.intensity})`,
                  "pointer-events": "none",
                  "z-index": "1500",
                  transition: "box-shadow 0.15s ease-out",
                }}
              />
            );
          }}
        </Show>

        {/* main content area + queue */}
        <div
          class="flex-1 overflow-hidden flex"
          style={{
            "padding-top": isNarrow() ? "var(--nav-height)" : undefined,
            "padding-bottom": "var(--player-bar-height)",
          }}
        >
          {/* main content */}
          <div class="flex-1 overflow-hidden" style={{ "overscroll-behavior": "contain" }}>
            {mainContent()}
          </div>

          {/* queue sidebar - responsive: bottom sheet on narrow, sidebar on wide */}
          <div data-coach-anchor="queueSidebar" class="contents">
            <QueueSidebar
              isOpen={queueOpen()}
              variant="overlay"
              songs={queueSongs()}
              currentIndex={currentQueueIndex()}
              onClose={() => setQueueOpen(false)}
              onSongClick={handleQueueSongClick}
              onRemoveSong={handleRemoveFromQueue}
              onClearAll={() => setQueueSongs([])}
              historyEntries={generateQueueHistory(40, generatedSongs as DomainSong[])}
              onReplayHistoryEntry={(entry) => console.log("replay history entry:", entry.label)}
            />
          </div>
        </div>

        {/* player bar */}
        <Show when={currentSong()}>
          {(song) => (
            <PlayerBar
              song={{
                id: song().id,
                title: song().title,
                artist: song().artist_name,
                album: song().album_title,
                thumbnailUrl: placeholderSvg(
                  song().album_id ?? song().id,
                  song().album_title ?? song().title
                ),
                isFavorite: song().is_favorite ?? false,
              }}
              isPlaying={isPlaying()}
              volume={volume()}
              currentTime={currentTime()}
              duration={song().duration_seconds}
              queueOpen={queueOpen()}
              onPlayPause={handlePlayPause}
              onPrevious={() => handleSkip("prev")}
              onNext={() => handleSkip("next")}
              onSeek={(percentage) => {
                const duration = song().duration_seconds;
                const timeInSeconds = (percentage / 100) * duration;
                setCurrentTime(timeInSeconds);
              }}
              onVolumeChange={(vol) => setVolume(vol)}
              onQueueToggle={() => setQueueOpen(!queueOpen())}
              queueLength={queueSongs().length}
            />
          )}
        </Show>
        {addRemoteModal()}
        {albumEditModal()}
        {shareModal()}
        {resolveShareModal()}
      </div>
    </QueryClientProvider>
  );
}

export const FullAppDemo: Story = {
  render: () => <FullAppDemoBody />,
};
