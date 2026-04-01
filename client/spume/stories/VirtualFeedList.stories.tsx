import { createMemo, createSignal, For, Show } from "solid-js";
import { QueryClientProvider, QueryClient } from "@tanstack/solid-query";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { VirtualFeedList } from "../src/components/virtualized/VirtualFeedList";
import type { FeedItem, FeedItemType } from "../src/music/data/types";

// deterministic pseudo-random
function seededRand(seed: number): number {
  let x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const userNames = ["nancy", "sluggo", "fritzi", "rollo", "butch", "irma", "oona goosepimple", "phil fumble"];
const songTitles = [
  "midnight sun",
  "blue in green",
  "a love supreme",
  "so what",
  "take five",
  "giant steps",
  "round midnight",
  "all blues",
  "freddie freeloader",
  "my favorite things",
  "naima",
  "watermelon man",
  "cantaloupe island",
  "maiden voyage",
  "speak no evil",
  "footprints",
  "stolen moments",
];
const albumTitles = [
  "kind of blue",
  "time out",
  "head hunters",
  "bitches brew",
  "the black saint",
  "mingus ah um",
  "moanin'",
  "somethin' else",
];
const artistNames = [
  "miles davis",
  "dave brubeck",
  "herbie hancock",
  "john coltrane",
  "thelonious monk",
  "wayne shorter",
  "charles mingus",
];
const genres = ["jazz", "bebop", "modal", "hard bop", "fusion", "cool jazz", "post-bop"];
const feedTypes: FeedItemType[] = [
  "recent_listen",
  "recent_favorite",
  "recent_album",
  "recent_rating",
  "recent_playlist",
  "listen_session",
];

function generateFeedItems(
  page: number,
  pageSize = 30,
  remote?: { id: string; name: string },
): FeedItem[] {
  const items: FeedItem[] = [];
  const baseTs = Date.now() - page * pageSize * 120000;

  // mix remote identity into seed so each remote gets different data
  const remoteSalt = remote ? remote.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 1000 : 0;

  for (let i = 0; i < pageSize; i++) {
    const globalIdx = page * pageSize + i;
    const base = globalIdx + remoteSalt;
    const r1 = seededRand(base * 7);
    const r2 = seededRand(base * 13);
    const r3 = seededRand(base * 19);
    const r4 = seededRand(base * 23);
    const r5 = seededRand(base * 31);
    const r6 = seededRand(base * 37);

    const feedType = feedTypes[Math.floor(r1 * feedTypes.length)];
    const user = userNames[Math.floor(r2 * userNames.length)];
    const song = songTitles[Math.floor(r3 * songTitles.length)];
    const album = albumTitles[Math.floor(r4 * albumTitles.length)];
    const artist = artistNames[Math.floor(r5 * artistNames.length)];
    const genre = genres[Math.floor(r6 * genres.length)];
    const ts = baseTs - i * 120000;
    const isSession = feedType === "listen_session";
    const isAlbum = feedType === "recent_album";
    const isPlaylist = feedType === "recent_playlist";
    const hasRating = feedType === "recent_rating";

    items.push({
      id: remote ? `${remote.id}-feed-${globalIdx}` : `feed-${globalIdx}`,
      feed_type: feedType,
      song_id: !isSession && !isAlbum && !isPlaylist ? `song-${Math.floor(r3 * 200)}` : null,
      album_id: !isPlaylist ? `album-${Math.floor(r4 * 100)}` : null,
      artist_id: `artist-${Math.floor(r5 * 50)}`,
      playlist_id: isPlaylist ? `playlist-${Math.floor(r3 * 20)}` : null,
      title: isSession
        ? `${artist} session`
        : isAlbum
          ? album
          : isPlaylist
            ? `${user}'s ${genre} mix`
            : song,
      subtitle: null,
      images: null,
      created_at: ts,
      user_id: `user-${Math.floor(r2 * userNames.length)}`,
      username: user,
      play_count: feedType === "recent_listen" ? Math.floor(r6 * 50) + 1 : null,
      rating: hasRating ? Math.floor(r6 * 5) + 1 : null,
      target_type: null,
      session_id: isSession ? `session-${globalIdx}` : null,
      session_type: isSession ? "album" : null,
      session_status: isSession ? (r6 > 0.5 ? "completed" : "active") : null,
      progress_percent: isSession ? Math.floor(r6 * 100) : null,
      songs_completed: isSession ? Math.floor(r6 * 12) : null,
      total_songs: isSession ? 12 : null,
      artist_name: artist,
      album_title: isPlaylist ? null : album,
      genre,
      genre_id: `genre-${genre}`,
      year: 1955 + Math.floor(r3 * 40),
      song_count: isAlbum ? Math.floor(r4 * 12) + 3 : null,
      songs_added: null,
      total_duration_ms: isSession || isAlbum ? Math.floor(r5 * 3600000) + 600000 : null,
      image_count: null,
      urls: null,
      description: isPlaylist ? "a curated selection of deep cuts" : null,
      tags: r6 > 0.7 ? [genre, "vinyl", "remastered"].slice(0, Math.floor(r4 * 3) + 1) : null,
      is_favorite: r3 > 0.7,
      is_initial_add: isAlbum ? r5 > 0.5 : true,
      collage_images: null,
      entity_created_at: null,
      remote_id: remote?.id ?? null,
      remote_name: remote?.name ?? null,
    });
  }

  return items;
}

// shared query client for stories — FavoriteToggle needs this
const storyQueryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false } },
});

const meta = {
  title: "Components/Virtualized/VirtualFeedList",
  component: VirtualFeedList,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <QueryClientProvider client={storyQueryClient}>
        <div style={{ width: "620px", height: "700px" }}>
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof VirtualFeedList>;

export default meta;
type Story = StoryObj<typeof meta>;

// endless scroll — loads more pages as you scroll down
function EndlessScrollDemo() {
  const [page, setPage] = createSignal(0);
  const [items, setItems] = createSignal<FeedItem[]>(generateFeedItems(0));
  const [loadingMore, setLoadingMore] = createSignal(false);

  const handleNearEnd = () => {
    if (loadingMore()) return;
    setLoadingMore(true);
    const nextPage = page() + 1;
    setTimeout(() => {
      const older = generateFeedItems(nextPage);
      setItems((prev) => [...prev, ...older]);
      setPage(nextPage);
      setLoadingMore(false);
    }, 800);
  };

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
      <VirtualFeedList
        items={items()}
        height={700}
        onNearEnd={handleNearEnd}
        scrollKey="story-feed"
        onItemClick={(item) => console.log("clicked:", item.id, item.title)}
        onGenreClick={(genreId) => console.log("genre:", genreId)}
      />
      {loadingMore() && (
        <div
          style={{
            padding: "8px",
            "text-align": "center",
            "font-size": "12px",
            color: "#888",
          }}
        >
          loading more...
        </div>
      )}
    </div>
  );
}

export const Default: Story = {
  name: "aggregate feed (multi-remote)",
  render: () => <AggregateFeedDemo />,
};

export const SingleRemote: Story = {
  name: "single remote",
  render: () => <EndlessScrollDemo />,
};

export const Empty: Story = {
  name: "empty feed",
  args: {
    items: [],
    height: 700,
  },
};

// mock remotes
const mockRemotes = [
  { id: "home-pi", name: "home pi" },
  { id: "work-server", name: "work server" },
  { id: "laptop-local", name: "laptop" },
];

// aggregate feed — multiple remotes with toggle buttons
function AggregateFeedDemo() {
  const [activeRemotes, setActiveRemotes] = createSignal<Set<string>>(
    new Set(mockRemotes.map((r) => r.id)),
  );
  const [pages, setPages] = createSignal<Record<string, number>>(
    Object.fromEntries(mockRemotes.map((r) => [r.id, 0])),
  );
  const [allItems, setAllItems] = createSignal<FeedItem[]>([]);
  const [loadingMore, setLoadingMore] = createSignal(false);

  // initialize
  (() => {
    const initial = mockRemotes
      .flatMap((r) => generateFeedItems(0, 15, r))
      .sort((a, b) => b.created_at - a.created_at);
    setAllItems(initial);
  })();

  const filteredItems = createMemo(() => {
    const active = activeRemotes();
    return allItems().filter((item) => !item.remote_id || active.has(item.remote_id));
  });

  const toggleRemote = (remoteId: string) => {
    setActiveRemotes((prev) => {
      const next = new Set(prev);
      if (next.has(remoteId)) {
        if (next.size <= 1) return prev;
        next.delete(remoteId);
      } else {
        next.add(remoteId);
      }
      return next;
    });
  };

  const handleNearEnd = () => {
    if (loadingMore()) return;
    setLoadingMore(true);
    // load next page from all active remotes
    const active = activeRemotes();
    setTimeout(() => {
      const newPages = { ...pages() };
      const newItems: FeedItem[] = [];
      for (const remote of mockRemotes) {
        if (!active.has(remote.id)) continue;
        newPages[remote.id] = (newPages[remote.id] ?? 0) + 1;
        newItems.push(...generateFeedItems(newPages[remote.id], 15, remote));
      }
      setPages(newPages);
      setAllItems((prev) =>
        [...prev, ...newItems].sort((a, b) => b.created_at - a.created_at),
      );
      setLoadingMore(false);
    }, 600);
  };

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column" }}>
      {/* remote toggle strip */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": "1px solid rgba(255,255,255,0.1)",
          "flex-shrink": "0",
        }}
      >
        <For each={mockRemotes}>
          {(remote) => {
            const isActive = () => activeRemotes().has(remote.id);
            const count = () =>
              allItems().filter((i) => i.remote_id === remote.id).length;
            return (
              <button
                style={{
                  padding: "4px 12px",
                  "border-radius": "8px",
                  "font-size": "13px",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  background: isActive() ? "var(--color-accent-500, #6366f1)" : "rgba(255,255,255,0.08)",
                  color: isActive() ? "#fff" : "rgba(255,255,255,0.4)",
                }}
                onClick={() => toggleRemote(remote.id)}
              >
                {remote.name}
                <Show when={count() > 0}>
                  <span
                    style={{
                      "margin-left": "6px",
                      padding: "1px 6px",
                      "border-radius": "9999px",
                      "font-size": "11px",
                      background: isActive() ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.05)",
                    }}
                  >
                    {count()}
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>

      <div style={{ flex: "1", "min-height": "0" }}>
        <VirtualFeedList
          items={filteredItems()}
          height={648}
          onNearEnd={handleNearEnd}
          scrollKey="story-aggregate-feed"
          onItemClick={(item) =>
            console.log("clicked:", item.id, item.title, "from:", item.remote_name)
          }
          onGenreClick={(genreId) => console.log("genre:", genreId)}
        />
      </div>
      <Show when={loadingMore()}>
        <div
          style={{
            padding: "8px",
            "text-align": "center",
            "font-size": "12px",
            color: "#888",
          }}
        >
          loading more...
        </div>
      </Show>
    </div>
  );
}

