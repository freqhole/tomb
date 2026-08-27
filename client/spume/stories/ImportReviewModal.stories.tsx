import { createSignal, createMemo, For, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  ImportReviewModal,
  type AlbumEditorRenderProps,
} from "../src/components/modals/ImportReviewModal";
import type { ImportReviewAlbum } from "../src/components/import/ImportGroupingView";
import {
  ImportAlbumEditorPanel,
  type ImportAlbumEdit,
} from "../src/components/import/ImportAlbumEditorPanel";
import type { ImageMetadata } from "../src/music/services/storage/types";
import { MusicBrainzBrowserClient } from "../src/lib/musicbrainzBrowserClient";

const meta = {
  title: "Components/Overlays/ImportReviewModal",
  component: ImportReviewModal,
  tags: ["autodocs"],
} satisfies Meta<typeof ImportReviewModal>;

export default meta;
type Story = StoryObj<typeof meta>;

// -------------------------------------------------------------------------
// shared mock data
// -------------------------------------------------------------------------

const albums: ImportReviewAlbum[] = [
  {
    id: "a1",
    title: "loveless",
    artist: "my bloody valentine",
    songs: [
      { id: "s1", title: "only shallow", trackNumber: 1, durationSeconds: 274 },
      { id: "s2", title: "loomer", trackNumber: 2, durationSeconds: 240 },
      { id: "s3", title: "touched", trackNumber: 3, durationSeconds: 56 },
      { id: "s4", title: "to here knows when", trackNumber: 4, durationSeconds: 264 },
      { id: "s5", title: "when you sleep", trackNumber: 5, durationSeconds: 349 },
      { id: "s6", title: "i only said", trackNumber: 6, durationSeconds: 301 },
      { id: "s7", title: "come in alone", trackNumber: 7, durationSeconds: 224 },
      { id: "s8", title: "sometimes", trackNumber: 8, durationSeconds: 163 },
      { id: "s9", title: "blown", trackNumber: 9, durationSeconds: 153 },
    ],
  },
  {
    id: "a2",
    title: "lofi beats vol. 3",
    artist: "various",
    songs: [
      { id: "l1", title: "midnight study", trackNumber: 1, durationSeconds: 222 },
      { id: "l2", title: "rainy afternoon", trackNumber: 2, durationSeconds: 247 },
      { id: "l3", title: "coffee shop vibes", trackNumber: 3, durationSeconds: 191 },
      { id: "l4", title: "late night coding", trackNumber: 4, durationSeconds: 268 },
    ],
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

const singleAlbum: ImportReviewAlbum[] = [albums[0]];

// -------------------------------------------------------------------------
// mock artist/album suggestions for autocomplete demo
// -------------------------------------------------------------------------

const MOCK_ARTISTS = [
  "my bloody valentine",
  "slowdive",
  "ride",
  "cocteau twins",
  "mazzy star",
  "beach house",
  "grouper",
  "various",
];

const MOCK_ALBUMS = [
  "loveless",
  "isn't anything",
  "souvlaki",
  "nowhere",
  "heaven or las vegas",
  "so tonight that i might see",
  "teen dream",
  "depression cherry",
];

// lightweight mock autocomplete - shows filtered suggestions from static list.
// in production, these would be the real ArtistAutocomplete / AlbumAutocomplete.
function MockAutocomplete(props: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  suggestions: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const filtered = createMemo(() => {
    const q = props.value.trim().toLowerCase();
    if (!q) return props.suggestions.slice(0, 6);
    return props.suggestions.filter((s) => s.toLowerCase().includes(q)).slice(0, 6);
  });

  const inputClass =
    "body-small bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-2 py-1.5 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-500)] transition-colors w-full disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div class="relative">
      <input
        class={inputClass}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      <Show when={open() && !props.disabled && filtered().length > 0}>
        <div class="absolute z-50 w-full mt-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] shadow-lg overflow-hidden">
          <For each={filtered()}>
            {(s) => (
              <button
                class="w-full text-left px-3 py-2 body-small text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  props.onChange(s);
                  setOpen(false);
                }}
              >
                {s}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

function toEditState(album: ImportReviewAlbum): ImportAlbumEdit {
  return {
    title: album.title,
    artistName: album.artist ?? "",
    albumType: "album",
    artworkBlobId: null,
    artworkPreview: null,
    entityUrls: [],
    images: [],
    songs: album.songs.map((s) => ({
      id: s.id,
      title: s.title,
      trackNumber: s.trackNumber ?? null,
      discNumber: null,
      artistName: null,
      durationSeconds: s.durationSeconds ?? null,
    })),
  };
}

// shared browser client instance - used in FullEditor for the musicbrainz tab
const mbClient = new MusicBrainzBrowserClient();

// full-featured editor used in stories - wires ImportAlbumEditorPanel with
// mock autocomplete suggestions, fake image upload, and live mb search.
function FullEditor(props: AlbumEditorRenderProps) {
  const [edit, setEdit] = createSignal<ImportAlbumEdit>(toEditState(props.album));

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const newImg: ImageMetadata = {
        remote_url: e.target?.result as string,
        is_primary: edit().images!.length === 0,
        blob_type: "original",
      };
      setEdit((prev) => ({ ...prev, images: [...(prev.images ?? []), newImg] }));
    };
    reader.readAsDataURL(file);
  };

  const handleImageDelete = (index: number) => {
    setEdit((prev) => ({
      ...prev,
      images: (prev.images ?? []).filter((_, i) => i !== index),
    }));
  };

  const handleImageSetPrimary = (index: number) => {
    setEdit((prev) => ({
      ...prev,
      images: (prev.images ?? []).map((img, i) => ({ ...img, is_primary: i === index })),
    }));
  };

  return (
    <ImportAlbumEditorPanel
      value={edit()}
      onChange={setEdit}
      albumId={props.album.id}
      artistId={props.album.id + "-artist"}
      mbSearchFn={(p) => mbClient.searchReleases(p)}
      mbGetReleaseFn={(mbid) => mbClient.getRelease(mbid)}
      onAlbumUpdated={() => console.log("album updated from mb:", props.album.title)}
      onImageUpload={handleImageUpload}
      onImageDelete={handleImageDelete}
      onImageSetPrimary={handleImageSetPrimary}
      renderArtistInput={(inputProps) => (
        <MockAutocomplete
          suggestions={MOCK_ARTISTS}
          value={inputProps.value}
          onChange={inputProps.onChange}
          disabled={inputProps.disabled}
          placeholder="artist name"
        />
      )}
      renderAlbumTitleInput={(inputProps) => (
        <MockAutocomplete
          suggestions={MOCK_ALBUMS}
          value={inputProps.value}
          onChange={inputProps.onChange}
          placeholder="album title"
        />
      )}
    />
  );
}

// -------------------------------------------------------------------------
// story: full interactive flow (grouping -> metadata -> finish)
// -------------------------------------------------------------------------

export const FullFlow: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [albumList, setAlbumList] = createSignal(albums);
    const [completed, setCompleted] = createSignal(false);

    const handleMerge = (sourceIds: string[], targetId: string) => {
      setAlbumList((prev) => {
        const target = prev.find((a) => a.id === targetId)!;
        const sources = prev.filter((a) => sourceIds.includes(a.id));
        const merged = { ...target, songs: [...target.songs, ...sources.flatMap((s) => s.songs)] };
        return [merged, ...prev.filter((a) => a.id !== targetId && !sourceIds.includes(a.id))];
      });
    };

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-8">
        {completed() ? (
          <div class="flex flex-col gap-3 items-start">
            <p class="body-base text-[var(--color-text-primary)]">review complete</p>
            <button
              class="body-small text-[var(--color-accent-500)] underline"
              onClick={() => {
                setCompleted(false);
                setIsOpen(true);
              }}
            >
              start over
            </button>
          </div>
        ) : (
          <>
            <button
              class="px-4 py-2 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded body-small"
              onClick={() => setIsOpen(true)}
            >
              open import review
            </button>
            <ImportReviewModal
              isOpen={isOpen()}
              onClose={() => setIsOpen(false)}
              albums={albumList()}
              onMergeAlbums={handleMerge}
              onMoveSong={(sid, aid) => console.log("move", sid, "->", aid)}
              onCreateAlbumForSong={(sid, title, artist) => console.log("create album", title, artist, "for", sid)}
              onMarkReviewed={(id) => console.log("marked reviewed:", id)}
              onComplete={() => {
                setIsOpen(false);
                setCompleted(true);
              }}
              renderAlbumEditor={(p) => <FullEditor {...p} />}
            />
          </>
        )}
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: single album fast-path
// -------------------------------------------------------------------------

export const SingleAlbumFastPath: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);
    const [completed, setCompleted] = createSignal(false);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-8">
        {completed() ? (
          <p class="body-base text-[var(--color-text-secondary)]">review complete</p>
        ) : (
          <>
            <button
              class="px-4 py-2 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded body-small"
              onClick={() => setIsOpen(true)}
            >
              open import review
            </button>
            <ImportReviewModal
              isOpen={isOpen()}
              onClose={() => setIsOpen(false)}
              albums={singleAlbum}
              onMergeAlbums={() => {}}
              onMoveSong={() => {}}
              onCreateAlbumForSong={() => {}}
              onMarkReviewed={(id) => console.log("reviewed:", id)}
              onComplete={() => {
                setIsOpen(false);
                setCompleted(true);
              }}
              renderAlbumEditor={(p) => <FullEditor {...p} />}
            />
          </>
        )}
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: open directly at metadata stage (stage 2) - last album, finish enabled
// -------------------------------------------------------------------------

export const MetadataStageLastAlbum: Story = {
  render: () => {
    // open straight to metadata by simulating confirmed grouping
    const [isOpen, setIsOpen] = createSignal(true);

    // pre-mark all but last as reviewed so "finish review" lights up
    const twoAlbums = albums.slice(0, 2);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-8">
        <p class="body-xs text-[var(--color-text-muted)] mb-4">
          showing metadata stage with first album pre-reviewed - navigate to album 2 and mark "looks
          good" to enable finish
        </p>
        <button
          class="px-4 py-2 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded body-small mb-4"
          onClick={() => setIsOpen(true)}
        >
          open
        </button>
        <ImportReviewModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          albums={twoAlbums}
          onMergeAlbums={() => {}}
          onMoveSong={() => {}}
          onCreateAlbumForSong={() => {}}
          onMarkReviewed={(id) => console.log("reviewed:", id)}
          onComplete={() => setIsOpen(false)}
          renderAlbumEditor={(p) => <FullEditor {...p} />}
        />
      </div>
    );
  },
};
