import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { clearPageInfo, setPageInfo } from "../src/app/services/pageInfo";
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
import WalkCanvas from "../src/components/graph/WalkCanvas";
import { createWalkerDriver } from "../src/components/graph/drivers/GraphDriver";
import { MOCK_GRAPH } from "../src/components/graph/mockData";
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
  setFakeScanProgress,
  fakeScanRunning,
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

type Route =
  | "library"
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
  const [currentRoute, setCurrentRoute] = createSignal<Route>("library");
  const [_topNavOpen, setTopNavOpen] = createSignal(false);
  // tracks pointer over the TopNav root so the inner TopNavSearch knows
  // when to auto-collapse on hover-out (matches real-app behavior)
  const [topNavHovered, setTopNavHovered] = createSignal(false);
  // single walker driver shared by the embedded library WalkCanvas
  const superStoryDriver = createWalkerDriver();

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

  // demo-only: a single shared <audio> element backs the fake playerbar so
  // play/pause/volume toggles produce real sound. file is staged at
  // /demo/summa-samba.mp3 by the freqhole.net public dir.
  let demoAudio: HTMLAudioElement | null = null;
  const ensureAudio = () => {
    if (demoAudio) return demoAudio;
    if (typeof Audio === "undefined") return null;
    demoAudio = new Audio("/demo/summa-samba.mp3");
    demoAudio.loop = true;
    demoAudio.volume = volume();
    demoAudio.addEventListener("pause", () => {
      if (isPlaying()) setIsPlaying(false);
    });
    demoAudio.addEventListener("play", () => {
      if (!isPlaying()) setIsPlaying(true);
    });
    return demoAudio;
  };
  createEffect(() => {
    const a = ensureAudio();
    if (!a) return;
    if (isPlaying()) {
      void a.play().catch(() => {
        // autoplay blocked; reflect that in the ui state
        setIsPlaying(false);
      });
    } else {
      a.pause();
    }
  });
  createEffect(() => {
    const a = demoAudio;
    if (a) a.volume = Math.max(0, Math.min(1, volume()));
  });
  onCleanup(() => {
    if (demoAudio) {
      demoAudio.pause();
      demoAudio.src = "";
      demoAudio = null;
    }
  });

  // responsive: track if viewport is narrow (<= 800px)
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  // track viewport height for virtualized list sizing
  const [viewportHeight, setViewportHeight] = createSignal(window.innerHeight);

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(isNarrowViewport());
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  // available height for virtualized lists/grids inside main content area.
  // accounts for: TopNav (~60px), HeadingSection + margins (~60px), player bar (~80px).
  const listHeight = () => Math.max(320, viewportHeight() - 180);
  const gridHeight = () => Math.max(320, viewportHeight() - 140);

  // compute page title and count based on current route
  const pageInfo = () => {
    switch (currentRoute()) {
      case "library":
        return { title: "library graph", count: undefined };
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
  // demo-only: knock-flow phase for the add-remote modal.
  // phases: "id-form" | "loading" | "request-form" | "pending" | "approved"
  const [knockPhase, setKnockPhase] = createSignal<
    "id-form" | "loading" | "request-form" | "pending" | "approved"
  >("id-form");
  // demo-only: spotlight one anchor by dimming everything else. null = off.
  // signals are written by the coach context but not yet consumed visually;
  // rendering an overlay is a future enhancement.
  const [, setSpotlightAnchor] = createSignal<string | null>(null);
  const [, setSpotlightIntensity] = createSignal(0);
  // demo-only: track the library graph container size so WalkCanvas can be
  // rendered with explicit pixel dims (its default is position:fixed which
  // escapes the SuperStory layout entirely).
  const [libGraphSize, setLibGraphSize] = createSignal({ w: 0, h: 0 });
  // selected node id for the library graph detail popover overlay.
  const [libGraphSelectedId, setLibGraphSelectedId] = createSignal<string | null>(null);
  // scripted walk path used by coach `walkLibraryGraph` (local -> genres ->
  // electronic -> pan sonic). pivots are applied at progress thresholds; the
  // final step opens the artist detail popover.
  const LIB_WALK_PATH = [
    { p: 0.05, pivot: "remote::local" },
    { p: 0.3, pivot: "relation::local::genres" },
    { p: 0.55, pivot: "value::genres::electronic" },
    { p: 0.8, pivot: "artist::local::a38" },
  ] as const;
  let lastLibWalkStep = -1;
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

      // --- scroll-driven animation hooks ----------------------------------
      setScanProgress: (p) => {
        const clamped = Math.max(0, Math.min(1, p));
        setFakeScanProgress(clamped);
        // mark running so the progress bar's Show condition becomes true
        // for any 0 < p < 1. when p reaches 1, mark complete + flip mode.
        if (clamped <= 0) {
          setFakeScanRunning(false);
        } else if (clamped >= 1) {
          setFakeScanRunning(false);
          setDemoLibraryMode("populated");
        } else {
          setFakeScanRunning(true);
        }
      },
      setSpotlight: (anchor, intensity) => {
        setSpotlightAnchor(anchor ?? null);
        setSpotlightIntensity(Math.max(0, Math.min(1, intensity ?? (anchor ? 1 : 0))));
      },
      setListProgress: (anchor, p) => {
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const el = root.querySelector(`[data-coach-anchor='${anchor}']`) as HTMLElement | null;
        if (!el) return;
        // walk self + descendants to find first scrollable element
        const candidates: HTMLElement[] = [
          el,
          ...Array.from(el.querySelectorAll<HTMLElement>("*")),
        ];
        const scroller = candidates.find((n) => n.scrollHeight > n.clientHeight + 4);
        if (!scroller) return;
        const max = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTop = Math.max(0, Math.min(max, max * p));
      },
      setSearchQuery: (text) => {
        setSearchDemoQuery(text);
        setSearchDemoActive(true);
        setSearchValue(text);
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const anchor = root.querySelector("[data-coach-anchor='topnavSearch']");
        const input = anchor?.querySelector("input") as HTMLInputElement | null;
        if (input) {
          const proto = Object.getPrototypeOf(input);
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          setter?.call(input, text);
        }
      },
      setSelectedListItem: (anchor, idx) => {
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const el = root.querySelector(`[data-coach-anchor='${anchor}']`) as HTMLElement | null;
        if (!el) return;
        const items = el.querySelectorAll<HTMLElement>(
          "[data-coach-item], li button, [role='listitem'], li[role='option']"
        );
        const item = items[idx];
        if (item) item.click();
      },
      setInputValue: (anchor, text) => {
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const target = root.querySelector(`[data-coach-anchor='${anchor}']`) as HTMLElement | null;
        if (!target) return;
        const input =
          (target as HTMLInputElement | HTMLTextAreaElement).tagName === "INPUT" ||
          (target as HTMLInputElement | HTMLTextAreaElement).tagName === "TEXTAREA"
            ? (target as HTMLInputElement | HTMLTextAreaElement)
            : (target.querySelector("input, textarea") as
                | HTMLInputElement
                | HTMLTextAreaElement
                | null);
        if (!input) return;
        const proto = Object.getPrototypeOf(input);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      },
      setKnockPhase: (phase) => {
        const valid = ["id-form", "loading", "request-form", "pending", "approved"] as const;
        if ((valid as readonly string[]).includes(phase)) {
          setKnockPhase(phase as (typeof valid)[number]);
        }
      },
      setQueueTab: (tab) => {
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const sidebar = root.querySelector(
          "[data-coach-anchor='queueSidebar']"
        ) as HTMLElement | null;
        if (!sidebar) return;
        const buttons = sidebar.querySelectorAll<HTMLButtonElement>("button");
        const targetText = tab === "queue" ? "queue" : "history";
        const btn = Array.from(buttons).find((b) =>
          (b.textContent || "").trim().toLowerCase().startsWith(targetText)
        );
        if (btn && btn.getAttribute("aria-selected") !== "true") btn.click();
      },
      setTopNavMenuOpen: (open) => {
        const root =
          (typeof document !== "undefined" &&
            document.querySelector("freqhole-coach-demo")?.shadowRoot) ||
          document;
        const trigger = root.querySelector(
          "[data-coach-anchor='topnavMenuTrigger'], [data-coach-anchor='topnav-menu-trigger']"
        ) as HTMLElement | null;
        if (!trigger) return;
        const isOpen = trigger.getAttribute("aria-expanded") === "true";
        if (open !== isOpen) trigger.click();
      },
      walkLibraryGraph: (p) => {
        const clamped = Math.max(0, Math.min(1, p));
        // figure out the highest-progress entry we've crossed.
        let target = -1;
        for (let i = 0; i < LIB_WALK_PATH.length; i++) {
          if (clamped >= LIB_WALK_PATH[i].p) target = i;
        }
        // reset to root when scrubbing back before the first threshold
        if (target < 0) {
          if (lastLibWalkStep !== -1) {
            superStoryDriver.repivot("root", true);
            setLibGraphSelectedId(null);
            lastLibWalkStep = -1;
          }
          return;
        }
        if (target === lastLibWalkStep) return;
        // when scrubbing backwards, repivot from root then walk forward to
        // the target to keep the breadcrumb consistent.
        if (target < lastLibWalkStep) {
          superStoryDriver.repivot("root", true);
          for (let i = 0; i <= target; i++) {
            superStoryDriver.repivot(LIB_WALK_PATH[i].pivot);
          }
        } else {
          for (let i = lastLibWalkStep + 1; i <= target; i++) {
            superStoryDriver.repivot(LIB_WALK_PATH[i].pivot);
          }
        }
        lastLibWalkStep = target;
        // open the artist detail popover at the final step.
        setLibGraphSelectedId(
          target === LIB_WALK_PATH.length - 1 ? LIB_WALK_PATH[LIB_WALK_PATH.length - 1].pivot : null
        );
      },
    };
    registerCoachContext(ctx);
    onCleanup(() => unregisterCoachContext());
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
        setPageInfo({
          title: "playlists",
          count: mockPlaylists.length,
          sortFields: playlistSortFields,
          defaultSortBy: "updated_at",
          defaultSortDirection: "desc",
          ...baseSort,
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
    <div class="h-full" data-coach-anchor="artistsView">
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

            <div class="flex-1 overflow-y-auto">
              <For each={sortedArtists()}>
                {(artist) => (
                  <button
                    class={`
                      w-full px-6 py-3 text-left transition-colors border-l-2
                      ${
                        ctx.selectedItem()?.id === artist.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                    onClick={() => ctx.selectItem(artist)}
                  >
                    <div class="font-medium">{artist.name}</div>
                    <div class="text-xs text-[var(--color-text-tertiary)]">
                      {formatNumber(artist.songCount)} songs · {artist.albumCount} albums
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
        renderDetail={(ctx) => (
          <Show when={ctx.selectedItem()}>
            {(artist) => (
              <div class="flex flex-col h-full">
                {/* sticky header with back button + title */}
                <HeadingSection
                  title={artist().name}
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
                    <StatsGrid columns={5} gap="md" class="mb-3 wide:mb-6">
                      <StatsCard
                        label="songs"
                        value={formatNumber(artist().songCount)}
                        icon="music"
                      />
                      <StatsCard
                        label="albums"
                        value={formatNumber(artist().albumCount)}
                        icon="album"
                      />
                      <StatsCard
                        label="duration"
                        value={formatDuration(artist().totalDuration)}
                        icon="recent"
                      />
                      <StatsCard
                        label="avg rating"
                        value={artist().avgRating.toFixed(1)}
                        icon="star"
                        subtitle="out of 5.0"
                      />
                      <StatsCard
                        label="genres"
                        value={artist().genres[0]}
                        subtitle={artist().genres.slice(1).join(", ")}
                      />
                    </StatsGrid>
                  </div>

                  {/* top songs list */}
                  <div class="px-3 wide:px-6 pb-4">
                    <div class="mb-3 flex items-center justify-between">
                      <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">
                        top songs
                      </h3>
                    </div>
                    <div class="space-y-1">
                      <For each={generatedSongs.slice(0, 10)}>
                        {(song) => (
                          <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                            <IconButton
                              icon="play"
                              size="sm"
                              variant="ghost"
                              aria-label="play song"
                            />
                            <div class="flex-1 min-w-0">
                              <div class="body-small text-[var(--color-text-primary)] truncate">
                                {song.title}
                              </div>
                              <div class="caption truncate">{song.album_title}</div>
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
                  <Button variant="primary" onClick={() => console.log("play all songs")}>
                    <span class="hidden wide:inline">play all</span>
                    <span class="wide:hidden">play</span>
                  </Button>
                  <Button variant="secondary" onClick={() => console.log("shuffle")}>
                    shuffle
                  </Button>
                  <Button variant="ghost" onClick={() => console.log("add to queue")}>
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
              <svg
                class="w-24 h-24 mx-auto mb-4 opacity-30"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
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
    </div>
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
    <div class="h-full" data-coach-anchor="playlistsView">
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

            <div class="flex-1 overflow-y-auto">
              <For each={mockPlaylists}>
                {(playlist) => (
                  <button
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
              <div class="flex flex-col h-full">
                {/* sticky header with back button + title */}
                <HeadingSection
                  title={playlist().name}
                  variant="detail"
                  sticky
                  border
                  showBackButton={ctx.isNarrow() && ctx.showingDetail()}
                  onBack={() => ctx.onBack()}
                />

                {/* scrollable content area */}
                <div class="flex-1 overflow-y-auto">
                  {/* stats section */}
                  <div class="p-3 wide:p-6 flex gap-4">
                    <StatsCard
                      label="songs"
                      value={formatNumber(playlist().songCount)}
                      variant="compact"
                    />
                    <StatsCard
                      label="duration"
                      value={formatDuration(playlist().duration)}
                      variant="compact"
                    />
                    <StatsCard
                      label="created"
                      value={new Date(playlist().createdAt).toLocaleDateString()}
                      variant="compact"
                    />
                  </div>

                  {/* songs list */}
                  <div class="px-3 wide:px-6 pb-4">
                    <div class="mb-3 flex items-center justify-between">
                      <h3 class="text-lg font-semibold text-[var(--color-text-primary)]">songs</h3>
                      <div class="text-sm text-[var(--color-text-secondary)]">drag to reorder</div>
                    </div>
                    <div class="space-y-1">
                      <For each={playlistSongs()}>
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
                    <div class="mt-4 text-xs text-[var(--color-text-tertiary)]">
                      {playlistSongs().length} songs • {selectedSongIds().size} selected
                    </div>
                  </div>
                </div>

                {/* sticky action buttons */}
                <div class="sticky bottom-0 z-10 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-tertiary)] px-3 wide:px-6 py-2 wide:py-3 flex gap-2 wide:gap-3">
                  <Button variant="primary">play</Button>
                  <Button variant="secondary">shuffle</Button>
                  <Button variant="ghost">edit</Button>
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
    </div>
  );

  // ===== SONGS VIEW =====
  const songsView = () => (
    <div class="p-3" data-coach-anchor="songsList">
      <div class="ml-0 wide:ml-[100px]">
        <HeadingSection title="songs" count={generatedSongs.length} hideOnNarrow />
      </div>
      <div class="mt-2 wide:mt-6">
        <VirtualSongList
          songs={generatedSongs}
          height={listHeight()}
          onSongClick={(song) => {
            setCurrentSong(song);
          }}
          onSongDoubleClick={(song) => {
            setCurrentSong(song);
            setIsPlaying(true);
          }}
        />
      </div>
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
        <section class="mb-4">
          <div class="flex items-center justify-between px-2 mb-1">
            <h2 class="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)] truncate">
              local
            </h2>
          </div>
          <ul>
            <For each={mockRadioStations}>
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
                          <Show when={station.currentSong}>{(cur) => <> · {cur().title}</>}</Show>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </section>
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
        leftColumnWidth={320}
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

  // ===== ADD REMOTE MODAL (stub) =====
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
              add remote server
            </h2>
            <p class="text-xs text-[var(--color-text-secondary)] mb-4">
              paste a node id or share url to browse a friend's library.
            </p>
            <input
              type="text"
              placeholder="freqhole://..."
              data-coach-anchor="knockNodeIdInput"
              class="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] font-mono"
            />
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
            <div class="flex flex-col items-center justify-center py-10 gap-4">
              <div class="w-8 h-8 border-2 border-[var(--color-accent-500,#d63384)] border-t-transparent rounded-full animate-spin" />
              <p class="text-sm text-[var(--color-text-secondary)]">contacting carp.basement…</p>
            </div>
          </Show>

          <Show when={knockPhase() === "request-form"}>
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
              request access
            </h2>
            <p class="text-xs text-[var(--color-text-secondary)] mb-4">
              carp.basement is private. send a knock with your name + a note.
            </p>
            <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
              your name
            </label>
            <input
              type="text"
              placeholder="dj ..."
              data-coach-anchor="knockNameInput"
              class="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] mb-3"
            />
            <label class="block text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
              note
            </label>
            <textarea
              rows="3"
              placeholder="hey..."
              data-coach-anchor="knockMessageInput"
              class="w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            />
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
            <div class="flex flex-col items-center justify-center py-6 gap-3">
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">
                waiting on carp
              </h2>
              <p class="text-xs text-[var(--color-text-secondary)] text-center max-w-xs">
                your knock is sent. once carp approves, hit refresh to complete the connection.
              </p>
              <button
                type="button"
                data-coach-anchor="knockRefreshButton"
                class="mt-2 px-4 py-2 text-sm rounded bg-[var(--color-accent-500,#d63384)] text-white"
                onClick={() => setKnockPhase("approved")}
              >
                refresh status
              </button>
            </div>
          </Show>

          <Show when={knockPhase() === "approved"}>
            <div class="flex flex-col items-center justify-center py-8 gap-3">
              <div class="text-3xl text-green-400">✓</div>
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">access granted</h2>
              <p class="text-xs text-[var(--color-text-secondary)] text-center max-w-xs">
                carp.basement is now in your remotes list.
              </p>
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
                <input
                  type="text"
                  value={detailAlbum().title}
                  class="mt-1 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]"
                />
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
    if (route === "library") {
      // mount the same graph2 WalkCanvas used in the dedicated
      // GraphWalker story, against the same MOCK_GRAPH fixture.
      // WalkCanvas defaults to position:fixed 100vw/100vh when no width is
      // passed, which would escape the SuperStory layout and overlap the
      // topnav + playerbar. measure the host via ref + ResizeObserver and
      // pass explicit dims so it stays inside the main-content region.
      let ro: ResizeObserver | undefined;
      const attachHost = (el: HTMLDivElement) => {
        const measure = () => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            setLibGraphSize({ w: Math.round(r.width), h: Math.round(r.height) });
          }
        };
        // measure once synchronously, then again on next frame in case the
        // initial layout hasn't settled (shadow root inside astro page).
        measure();
        requestAnimationFrame(measure);
        ro?.disconnect();
        ro = new ResizeObserver(() => measure());
        ro.observe(el);
      };
      onCleanup(() => ro?.disconnect());
      return (
        <div
          ref={attachHost}
          class="w-full h-full relative bg-black overflow-hidden"
          data-coach-anchor="libraryGraph"
          style={{ "min-height": "400px" }}
        >
          <Show
            when={libGraphSize().w > 0 && libGraphSize().h > 0}
            fallback={
              <div class="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-tertiary)]">
                measuring…
              </div>
            }
          >
            <WalkCanvas
              graph={MOCK_GRAPH}
              initialPivot="root"
              driver={superStoryDriver}
              width={libGraphSize().w}
              height={libGraphSize().h}
              selectedId={libGraphSelectedId()}
              onSelect={(id) => setLibGraphSelectedId(id)}
            />
            <Show when={libGraphSelectedId()}>
              {(id) => {
                const node = () => MOCK_GRAPH.nodes.find((n) => n.id === id());
                const roleLabel = () => {
                  const r = node()?.role;
                  if (r === "artist") return "artist";
                  if (r === "album") return "album";
                  if (r === "value") return "taxon";
                  if (r === "relation") return "relation";
                  if (r === "remote") return "remote";
                  if (r === "root") return "root";
                  return r ?? "node";
                };
                return (
                  <div
                    class="absolute left-3 z-10 pointer-events-auto max-w-xs"
                    style={{ bottom: "96px" }}
                  >
                    <div class="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-md shadow-lg p-3 text-[var(--color-text-primary)]">
                      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-0.5">
                        {roleLabel()}
                      </div>
                      <div class="text-sm font-medium truncate">{node()?.label ?? id()}</div>
                      <Show when={node()?.childCount}>
                        <div class="text-xs text-[var(--color-text-secondary)] mt-1">
                          {node()!.childCount} item{node()!.childCount === 1 ? "" : "s"}
                        </div>
                      </Show>
                      <button
                        type="button"
                        class="mt-2 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                        onClick={() => setLibGraphSelectedId(null)}
                      >
                        close
                      </button>
                    </div>
                  </div>
                );
              }}
            </Show>
          </Show>
        </div>
      );
    }
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
        return artistsView();
      case "genres":
        return genresView();
      case "playlists":
        return playlistsView();
      case "feed":
        return feedView();
      case "radio":
        return radioView();
      default:
        return artistsView();
    }
  };

  const playerBarHeight = () => "var(--player-height)";

  return (
    <QueryClientProvider client={storyQueryClient}>
      <div
        class="h-full min-h-screen wide:min-h-0 flex flex-col bg-[var(--color-bg-primary)]"
        style={{ "--player-bar-height": playerBarHeight(), height: "100%" }}
      >
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

          {/* demo-only fake suggestions flyout. the real one lives in
              SearchInput, behind a debounced input handler + portal mount,
              and was a nightmare to drive reliably from a script. so for
              the coach demo we just render a static lookalike here. */}
          <Show when={searchDemoActive()}>
            <div
              class="fixed bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded shadow-lg overflow-hidden"
              style={{
                top: "calc(var(--nav-height, 56px) + 8px)",
                right: isNarrow() ? "0" : "16px",
                left: isNarrow() ? "0" : "auto",
                width: isNarrow() ? "100vw" : "320px",
                "border-radius": isNarrow() ? "0" : undefined,
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
          </Show>
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
              historyEntries={generateQueueHistory(12, generatedSongs as DomainSong[])}
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
