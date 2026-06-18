// storybook story for MusicBrainzPanel
//
// uses MusicBrainzBrowserClient to call mb ws/2 directly from the browser -
// no freqhole backend needed. enter an album title + artist and search live.
//
// note: mb enforces a 1 req/sec rate limit. the browser client enforces a
// 1.1 sec gap between requests so you won't hit it under normal story use.
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MusicBrainzPanel } from "../src/components/musicbrainz/MusicBrainzPanel";
import { MusicBrainzBrowserClient } from "../src/lib/musicbrainzBrowserClient";
import type { Song } from "../src/music/services/storage/types";

const meta = {
  title: "Components/MusicBrainz/MusicBrainzPanel",
  component: MusicBrainzPanel,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div class="bg-[var(--color-bg-primary)] min-h-screen p-0">
        <div class="max-w-2xl mx-auto">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof MusicBrainzPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

// -------------------------------------------------------------------------
// mock song shape - the panel only uses id, title, duration_seconds,
// disc_number, track_number, and track_artist (via MusicBrainzTrackComparison)
// -------------------------------------------------------------------------

function mockSong(id: string, title: string, track_number: number, duration_seconds: number): Song {
  return {
    id,
    title,
    track_number,
    disc_number: null,
    duration_seconds,
    album_id: "album-mock",
    album_title: "",
    artist_id: "artist-mock",
    artist_name: "",
    track_artist: null,
    bpm: null,
    year: null,
    genre: null,
    file_path: null,
    file_type: null,
    file_size: null,
    is_favorite: false,
    rating: null,
    play_count: 0,
    last_played_at: null,
    created_at: 0,
    updated_at: 0,
  } as unknown as Song;
}

const lovelessSongs: Song[] = [
  mockSong("s1", "only shallow", 1, 274),
  mockSong("s2", "loomer", 2, 240),
  mockSong("s3", "touched", 3, 56),
  mockSong("s4", "to here knows when", 4, 264),
  mockSong("s5", "when you sleep", 5, 349),
  mockSong("s6", "i only said", 6, 301),
  mockSong("s7", "come in alone", 7, 224),
  mockSong("s8", "sometimes", 8, 163),
  mockSong("s9", "blown", 9, 153),
];

const souvlakiSongs: Song[] = [
  mockSong("t1", "alison", 1, 247),
  mockSong("t2", "machine gun", 2, 235),
  mockSong("t3", "40 days", 3, 298),
  mockSong("t4", "sing", 4, 287),
  mockSong("t5", "here she comes", 5, 345),
  mockSong("t6", "souvlaki space station", 6, 395),
  mockSong("t7", "when the sun hits", 7, 312),
  mockSong("t8", "altogether", 8, 288),
  mockSong("t9", "dagger", 9, 247),
  mockSong("t10", "melon yellow", 10, 302),
  mockSong("t11", "blindness", 11, 396),
];

// -------------------------------------------------------------------------
// shared browser client instance
// -------------------------------------------------------------------------

const mbClient = new MusicBrainzBrowserClient();

// -------------------------------------------------------------------------
// stories
// -------------------------------------------------------------------------

// loveless - live search pre-filled
export const Loveless: Story = {
  render: () => {
    const [updated, setUpdated] = createSignal(0);
    return (
      <MusicBrainzPanel
        albumId="loveless-mock-id"
        albumTitle="loveless"
        artistId="mbv-mock-id"
        artistName="my bloody valentine"
        albumType="album"
        songs={lovelessSongs}
        onAlbumUpdated={() => {
          setUpdated((n) => n + 1);
          console.log("album updated (call #", updated() + 1, ")");
        }}
        mbSearchFn={(p) => mbClient.searchReleases(p)}
        mbGetReleaseFn={(mbid) => mbClient.getRelease(mbid)}
      />
    );
  },
};

// souvlaki by slowdive
export const Souvlaki: Story = {
  render: () => (
    <MusicBrainzPanel
      albumId="souvlaki-mock-id"
      albumTitle="souvlaki"
      artistId="slowdive-mock-id"
      artistName="slowdive"
      albumType="album"
      songs={souvlakiSongs}
      onAlbumUpdated={() => console.log("album updated")}
      mbSearchFn={(p) => mbClient.searchReleases(p)}
      mbGetReleaseFn={(mbid) => mbClient.getRelease(mbid)}
    />
  ),
};

// blank slate - no pre-filled values, user types their own query
export const BlankSearch: Story = {
  render: () => {
    const [songs, setSongs] = createSignal<Song[]>([]);
    return (
      <div class="flex flex-col gap-4">
        <div class="px-4 pt-4 flex items-center gap-3">
          <label class="body-xs text-[var(--color-text-muted)]">mock track count:</label>
          <input
            type="number"
            min={0}
            max={30}
            value={songs().length}
            onInput={(e) => {
              const n = parseInt(e.currentTarget.value) || 0;
              setSongs(
                Array.from({ length: n }, (_, i) =>
                  mockSong(`s${i}`, `track ${i + 1}`, i + 1, 200 + i * 10)
                )
              );
            }}
            class="w-16 body-small bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-2 py-1 text-[var(--color-text-primary)]"
          />
          <span class="body-xs text-[var(--color-text-muted)]">tracks</span>
        </div>
        <MusicBrainzPanel
          albumId="blank-mock-id"
          albumTitle=""
          artistId=""
          artistName=""
          albumType="album"
          songs={songs()}
          onAlbumUpdated={() => console.log("album updated")}
          mbSearchFn={(p) => mbClient.searchReleases(p)}
          mbGetReleaseFn={(mbid) => mbClient.getRelease(mbid)}
        />
      </div>
    );
  },
};
