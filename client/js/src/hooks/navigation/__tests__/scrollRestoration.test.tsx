import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@solidjs/testing-library";
import { createSignal, createEffect } from "solid-js";
import { useGridScrollRestoration } from "../useGridScrollRestoration";

// Mock router hooks to avoid SSR issues
vi.mock("@solidjs/router", () => ({
  useLocation: () => ({
    pathname: "/",
    search: "",
  }),
  useNavigate: () => vi.fn(),
}));

// Mock history state for testing
const mockHistoryState = new Map<string, any>();

// Mock history API
const mockHistory = {
  state: {},
  replaceState: (state: any, title: string, url: string) => {
    mockHistory.state = state;
  },
  pushState: (state: any, title: string, url: string) => {
    mockHistory.state = state;
  },
};

// Mock scroll container that behaves like infinite grid
function createScrollableElement() {
  const element = document.createElement("div");
  element.style.height = "200px";
  element.style.overflow = "auto";

  const content = document.createElement("div");
  content.style.height = "2000px";
  content.textContent = "Scrollable content";
  element.appendChild(content);

  return element;
}

describe("Scroll Restoration Integration Tests", () => {
  beforeEach(() => {
    mockHistoryState.clear();
    mockHistory.state = {};

    // Mock window.history
    Object.defineProperty(window, "history", {
      value: mockHistory,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("user navigation flow: songs -> artists -> back to songs", async () => {
    let currentRoute = "/songs";
    let songsScrollElement: HTMLElement | null = null;
    let artistsScrollElement: HTMLElement | null = null;

    // Test component that renders different views based on route
    const TestApp = () => {
      const [route, setRoute] = createSignal(currentRoute);

      const SongsView = () => {
        const [element, setElement] = createSignal<HTMLElement | null>(null);
        const scrollRestoration = useGridScrollRestoration({
          gridId: "songs",
          enabled: true,
        });

        createEffect(() => {
          const el = element();
          if (el) {
            scrollRestoration.setScrollElement(el);
            songsScrollElement = el;
          }
        });

        const scrollableEl = createScrollableElement();
        setElement(scrollableEl);

        return <div data-testid="songs-view">{scrollableEl}</div>;
      };

      const ArtistsView = () => {
        const [element, setElement] = createSignal<HTMLElement | null>(null);
        const scrollRestoration = useGridScrollRestoration({
          gridId: "artists",
          enabled: true,
        });

        createEffect(() => {
          const el = element();
          if (el) {
            scrollRestoration.setScrollElement(el);
            artistsScrollElement = el;
          }
        });

        const scrollableEl = createScrollableElement();
        setElement(scrollableEl);

        return <div data-testid="artists-view">{scrollableEl}</div>;
      };

      // Simulate navigation
      const navigate = (newRoute: string) => {
        currentRoute = newRoute;
        setRoute(newRoute);
      };

      return (
        <div>
          <button onClick={() => navigate("/songs")}>Songs</button>
          <button onClick={() => navigate("/artists")}>Artists</button>

          {route() === "/songs" && <SongsView />}
          {route() === "/artists" && <ArtistsView />}
        </div>
      );
    };

    render(() => <TestApp />);

    // Wait for initial render
    await new Promise((resolve) => setTimeout(resolve, 100));

    // STEP 1: Scroll in songs view
    expect(songsScrollElement).toBeTruthy();
    if (songsScrollElement) {
      songsScrollElement.scrollTop = 500;
      fireEvent.scroll(songsScrollElement);

      // Wait for debounced save
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // STEP 2: Navigate to artists
    fireEvent.click(screen.getByText("Artists"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // STEP 3: Scroll in artists view
    expect(artistsScrollElement).toBeTruthy();
    if (artistsScrollElement) {
      artistsScrollElement.scrollTop = 300;
      fireEvent.scroll(artistsScrollElement);

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // STEP 4: Navigate back to songs - should restore scroll
    fireEvent.click(screen.getByText("Songs"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check if scroll position was restored
    expect(songsScrollElement?.scrollTop).toBe(500);
  });

  test("scroll restoration saves to browser history state", async () => {
    let scrollElement: HTMLElement | null = null;

    const TestComponent = () => {
      const [element, setElement] = createSignal<HTMLElement | null>(null);

      const scrollRestoration = useGridScrollRestoration({
        gridId: "history-test",
        enabled: true,
      });

      createEffect(() => {
        const el = element();
        if (el) {
          scrollRestoration.setScrollElement(el);
          scrollElement = el;
        }
      });

      const scrollableEl = createScrollableElement();
      setElement(scrollableEl);

      return <div data-testid="scroll-container">{scrollableEl}</div>;
    };

    render(() => <TestComponent />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Scroll the element
    expect(scrollElement).toBeTruthy();
    if (scrollElement) {
      scrollElement.scrollTop = 750;
      fireEvent.scroll(scrollElement);

      // Wait for save to history
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check that scroll state was saved to history
      const savedState = mockHistory.state["scroll_history-test"];
      expect(savedState).toBeTruthy();
      expect(savedState.top).toBe(750);
      expect(savedState.left).toBe(0);
    }
  });

  test("different grid IDs maintain separate scroll positions", async () => {
    let songsElement: HTMLElement | null = null;
    let albumsElement: HTMLElement | null = null;

    const MultiGridComponent = () => {
      const [songs, setSongs] = createSignal<HTMLElement | null>(null);
      const [albums, setAlbums] = createSignal<HTMLElement | null>(null);

      const songsScrollRestoration = useGridScrollRestoration({
        gridId: "songs-grid",
        enabled: true,
      });

      const albumsScrollRestoration = useGridScrollRestoration({
        gridId: "albums-grid",
        enabled: true,
      });

      createEffect(() => {
        const el = songs();
        if (el) {
          songsScrollRestoration.setScrollElement(el);
          songsElement = el;
        }
      });

      createEffect(() => {
        const el = albums();
        if (el) {
          albumsScrollRestoration.setScrollElement(el);
          albumsElement = el;
        }
      });

      const songsScrollable = createScrollableElement();
      const albumsScrollable = createScrollableElement();

      setSongs(songsScrollable);
      setAlbums(albumsScrollable);

      return (
        <div>
          <div data-testid="songs-grid">{songsScrollable}</div>
          <div data-testid="albums-grid">{albumsScrollable}</div>
        </div>
      );
    };

    render(() => <MultiGridComponent />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Set different scroll positions
    expect(songsElement).toBeTruthy();
    expect(albumsElement).toBeTruthy();

    if (songsElement && albumsElement) {
      songsElement.scrollTop = 400;
      albumsElement.scrollTop = 600;

      fireEvent.scroll(songsElement);
      fireEvent.scroll(albumsElement);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify different state keys were used
      const songsState = mockHistory.state["scroll_songs-grid"];
      const albumsState = mockHistory.state["scroll_albums-grid"];

      expect(songsState?.top).toBe(400);
      expect(albumsState?.top).toBe(600);
    }
  });

  test("scroll restoration handles disabled state correctly", async () => {
    let scrollElement: HTMLElement | null = null;

    const DisabledScrollComponent = () => {
      const [element, setElement] = createSignal<HTMLElement | null>(null);

      const scrollRestoration = useGridScrollRestoration({
        gridId: "disabled-grid",
        enabled: false, // Disabled
      });

      createEffect(() => {
        const el = element();
        if (el) {
          scrollRestoration.setScrollElement(el);
          scrollElement = el;
        }
      });

      const scrollableEl = createScrollableElement();
      setElement(scrollableEl);

      return <div data-testid="disabled-grid">{scrollableEl}</div>;
    };

    render(() => <DisabledScrollComponent />);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Scroll and trigger save
    expect(scrollElement).toBeTruthy();
    if (scrollElement) {
      scrollElement.scrollTop = 200;
      fireEvent.scroll(scrollElement);

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not have saved anything to history state
      const saved = mockHistory.state["scroll_disabled-grid"];
      expect(saved).toBeFalsy();
    }
  });

  test("browser history state persistence on navigation", async () => {
    let scrollElement: HTMLElement | null = null;

    // Simulate existing scroll state in history
    mockHistory.state = {
      "scroll_history-restore": {
        top: 800,
        left: 0,
      },
    };

    const HistoryTestComponent = () => {
      const [element, setElement] = createSignal<HTMLElement | null>(null);

      const scrollRestoration = useGridScrollRestoration({
        gridId: "history-restore",
        enabled: true,
      });

      createEffect(() => {
        const el = element();
        if (el) {
          scrollRestoration.setScrollElement(el);
          scrollElement = el;
        }
      });

      const scrollableEl = createScrollableElement();
      setElement(scrollableEl);

      return <div data-testid="history-test">{scrollableEl}</div>;
    };

    render(() => <HistoryTestComponent />);

    // Wait for restoration to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have restored the saved position from history state
    expect(scrollElement?.scrollTop).toBe(800);
  });
});
