import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  ImportGroupingView,
  type ImportReviewAlbum,
} from "../src/components/import/ImportGroupingView";

const meta = {
  title: "Components/Import/ImportGroupingView",
  component: ImportGroupingView,
  tags: ["autodocs"],
} satisfies Meta<typeof ImportGroupingView>;

export default meta;
type Story = StoryObj<typeof meta>;

// -------------------------------------------------------------------------
// mock data
// -------------------------------------------------------------------------

const lovelessSongs = [
  { id: "s1", title: "only shallow", trackNumber: 1, durationSeconds: 274 },
  { id: "s2", title: "loomer", trackNumber: 2, durationSeconds: 240 },
  { id: "s3", title: "touched", trackNumber: 3, durationSeconds: 56 },
  { id: "s4", title: "to here knows when", trackNumber: 4, durationSeconds: 264 },
  { id: "s5", title: "when you sleep", trackNumber: 5, durationSeconds: 349 },
  { id: "s6", title: "i only said", trackNumber: 6, durationSeconds: 301 },
  { id: "s7", title: "come in alone", trackNumber: 7, durationSeconds: 224 },
  { id: "s8", title: "sometimes", trackNumber: 8, durationSeconds: 163 },
  { id: "s9", title: "blown", trackNumber: 9, durationSeconds: 153 },
];

const singleAlbum: ImportReviewAlbum = {
  id: "a1",
  title: "loveless",
  artist: "my bloody valentine",
  songs: lovelessSongs,
};

const lofiSongs = [
  { id: "l1", title: "midnight study", trackNumber: 1, durationSeconds: 222 },
  { id: "l2", title: "rainy afternoon", trackNumber: 2, durationSeconds: 247 },
  { id: "l3", title: "coffee shop vibes", trackNumber: 3, durationSeconds: 191 },
  { id: "l4", title: "late night coding", trackNumber: 4, durationSeconds: 268 },
  { id: "l5", title: "soft focus", trackNumber: 5, durationSeconds: 214 },
];

// over-split: same album split into two because of slightly inconsistent titles
const overSplitA: ImportReviewAlbum = {
  id: "a1",
  title: "loveless",
  artist: "my bloody valentine",
  songs: lovelessSongs.slice(0, 5),
};

const overSplitB: ImportReviewAlbum = {
  id: "a2",
  title: "loveless (remastered)",
  artist: "my bloody valentine",
  songs: lovelessSongs.slice(5),
};

// under-split: songs from a different album lumped in with loveless
const underSplitAlbum: ImportReviewAlbum = {
  id: "a1",
  title: "loveless",
  artist: "my bloody valentine",
  songs: [
    ...lovelessSongs.slice(0, 4),
    // these don't belong here
    { id: "l1", title: "midnight study", trackNumber: 5, durationSeconds: 222 },
    { id: "l2", title: "rainy afternoon", trackNumber: 6, durationSeconds: 247 },
    ...lovelessSongs.slice(4),
  ],
};

const separateAlbum: ImportReviewAlbum = {
  id: "a2",
  title: "lofi beats vol. 3",
  artist: "various",
  songs: lofiSongs.slice(2),
};

// three albums from a large playlist fetch
const threeAlbums: ImportReviewAlbum[] = [
  {
    id: "a1",
    title: "loveless",
    artist: "my bloody valentine",
    songs: lovelessSongs,
  },
  {
    id: "a2",
    title: "lofi beats vol. 3",
    artist: "various",
    songs: lofiSongs,
  },
  {
    id: "a3",
    title: "unknown album",
    artist: null,
    songs: [
      { id: "u1", title: "track 01", trackNumber: 1, durationSeconds: 183 },
      { id: "u2", title: "track 02", trackNumber: 2, durationSeconds: 210 },
    ],
  },
];

// -------------------------------------------------------------------------
// story: single album (fast-path, collapsed state)
// -------------------------------------------------------------------------

export const SingleAlbum: Story = {
  render: () => {
    const [done, setDone] = createSignal(false);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-6 max-w-xl">
        {done() ? (
          <p class="body-base text-[var(--color-text-secondary)]">
            confirmed - advancing to metadata stage
          </p>
        ) : (
          <ImportGroupingView
            albums={[singleAlbum]}
            onMerge={(src, tgt) => console.log("merge", src, "->", tgt)}
            onMoveSong={(sid, aid) => console.log("move song", sid, "->", aid)}
            onCreateAlbumForSong={(sid, title, artist) => console.log("create album", title, artist, "for", sid)}
            onConfirm={() => setDone(true)}
          />
        )}
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: over-split (two albums that should be merged)
// -------------------------------------------------------------------------

export const OverSplit: Story = {
  render: () => {
    const [albums, setAlbums] = createSignal([overSplitA, overSplitB]);
    const [done, setDone] = createSignal(false);

    const handleMerge = (sourceIds: string[], targetId: string) => {
      setAlbums((prev) => {
        const target = prev.find((a) => a.id === targetId)!;
        const sources = prev.filter((a) => sourceIds.includes(a.id));
        const mergedSongs = [...target.songs, ...sources.flatMap((s) => s.songs)];
        const merged = { ...target, songs: mergedSongs };
        return [merged, ...prev.filter((a) => a.id !== targetId && !sourceIds.includes(a.id))];
      });
    };

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-6">
        {done() ? (
          <p class="body-base text-[var(--color-text-secondary)]">
            grouping confirmed - advancing to metadata stage
          </p>
        ) : (
          <ImportGroupingView
            albums={albums()}
            onMerge={handleMerge}
            onMoveSong={(sid, aid) => console.log("move song", sid, "->", aid)}
            onCreateAlbumForSong={(sid, title, artist) => console.log("create album", title, artist, "for", sid)}
            onConfirm={() => setDone(true)}
          />
        )}
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: under-split (songs from different albums lumped together)
// -------------------------------------------------------------------------

export const UnderSplit: Story = {
  render: () => {
    const [albums, setAlbums] = createSignal([underSplitAlbum, separateAlbum]);
    const [done, setDone] = createSignal(false);

    const handleMoveSong = (songId: string, toAlbumId: string) => {
      setAlbums((prev) => {
        const fromAlbum = prev.find((a) => a.songs.some((s) => s.id === songId))!;
        const toAlbum = prev.find((a) => a.id === toAlbumId)!;
        const song = fromAlbum.songs.find((s) => s.id === songId)!;
        return prev.map((a) => {
          if (a.id === fromAlbum.id) return { ...a, songs: a.songs.filter((s) => s.id !== songId) };
          if (a.id === toAlbum.id) return { ...a, songs: [...a.songs, song] };
          return a;
        });
      });
    };

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-6">
        {done() ? (
          <p class="body-base text-[var(--color-text-secondary)]">
            grouping confirmed - advancing to metadata stage
          </p>
        ) : (
          <ImportGroupingView
            albums={albums()}
            onMerge={(src, tgt) => console.log("merge", src, "->", tgt)}
            onMoveSong={handleMoveSong}
            onCreateAlbumForSong={(sid, title, artist) => console.log("create album", title, artist, "for", sid)}
            onConfirm={() => setDone(true)}
          />
        )}
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: three albums from a large playlist fetch
// -------------------------------------------------------------------------

export const ThreeAlbums: Story = {
  render: () => {
    const [albums, setAlbums] = createSignal(threeAlbums);
    const [done, setDone] = createSignal(false);

    const handleMerge = (sourceIds: string[], targetId: string) => {
      setAlbums((prev) => {
        const target = prev.find((a) => a.id === targetId)!;
        const sources = prev.filter((a) => sourceIds.includes(a.id));
        const mergedSongs = [...target.songs, ...sources.flatMap((s) => s.songs)];
        return [
          { ...target, songs: mergedSongs },
          ...prev.filter((a) => a.id !== targetId && !sourceIds.includes(a.id)),
        ];
      });
    };

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-6">
        {done() ? (
          <p class="body-base text-[var(--color-text-secondary)]">grouping confirmed</p>
        ) : (
          <ImportGroupingView
            albums={albums()}
            onMerge={handleMerge}
            onMoveSong={(sid, aid) => console.log("move song", sid, "->", aid)}
            onCreateAlbumForSong={(sid, title, artist) => console.log("create album", title, artist, "for", sid)}
            onConfirm={() => setDone(true)}
          />
        )}
      </div>
    );
  },
};
