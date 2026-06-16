// focused per-album editor for the import review flow.
// covers the fields most likely to need fixing after an automated import:
// album title, artist, album type, artwork, and per-song title/track/disc/artist.
//
// purely presentational - no api calls. the caller (ImportReviewModal) owns state
// and passes onChange callbacks. designed to be plugged into the renderAlbumEditor
// render prop.
import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import type { ImageMetadata, Song } from "../../music/services/storage/types";
import { EntityUrlz, type EntityUrlFormItem } from "../forms/EntityUrlz";
import { EntityImages } from "../layout/EntityImages";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import { MusicBrainzPanel } from "../musicbrainz/MusicBrainzPanel";
import type { MbSearchReleasesResponse, MbReleaseDetail } from "../../music/data/types";

// -------------------------------------------------------------------------
// types
// -------------------------------------------------------------------------

export type AlbumType = "album" | "single" | "compilation";

export interface ImportReviewSongEdit {
  id: string;
  title: string;
  trackNumber: number | null;
  discNumber: number | null;
  /** only relevant when album type is "compilation" */
  artistName: string | null;
  durationSeconds: number | null;
  lyrics?: string | null;
}

export interface ImportAlbumEdit {
  title: string;
  artistName: string;
  albumType: AlbumType;
  /** blob id of a newly uploaded artwork file, or null if unchanged */
  artworkBlobId: string | null;
  /** data-url preview of a pending artwork upload, or null */
  artworkPreview: string | null;
  entityUrls: EntityUrlFormItem[];
  /** managed images (same shape as ImageMetadata for compatibility with EntityImages) */
  images?: ImageMetadata[];
  songs: ImportReviewSongEdit[];
}

export interface ImportAlbumEditorPanelProps {
  value: ImportAlbumEdit;
  onChange: (next: ImportAlbumEdit) => void;
  /** called when user picks an artwork file. caller should upload and set artworkBlobId. */
  onArtworkFilePicked?: (file: File) => void;
  /** image management callbacks - wire to real upload when available */
  onImageUpload?: (file: File) => void | Promise<void>;
  onImageDelete?: (index: number) => void | Promise<void>;
  onImageSetPrimary?: (index: number) => void | Promise<void>;
  /** optional render prop for artist autocomplete - defaults to plain text input */
  renderArtistInput?: (inputProps: {
    value: string;
    onChange: (v: string) => void;
    disabled: boolean;
  }) => JSX.Element;
  /** optional render prop for album title autocomplete - defaults to plain text input */
  renderAlbumTitleInput?: (inputProps: {
    value: string;
    onChange: (v: string) => void;
  }) => JSX.Element;
  /** when provided, a musicbrainz tab is added alongside the metadata tab */
  albumId?: string;
  artistId?: string;
  /** override fns for MusicBrainzPanel - use MusicBrainzBrowserClient for storybook / local-library use */
  mbSearchFn?: (params: {
    artist: string | null;
    release: string | null;
    limit: number;
    offset: number | null;
  }) => Promise<MbSearchReleasesResponse | null>;
  mbGetReleaseFn?: (mbid: string) => Promise<MbReleaseDetail | null>;
  /** called after MusicBrainzPanel syncs metadata or imports artwork */
  onAlbumUpdated?: () => void;
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

const ALBUM_TYPES: { value: AlbumType; label: string }[] = [
  { value: "album", label: "album" },
  { value: "single", label: "single" },
  { value: "compilation", label: "compilation" },
];

function fmtDuration(secs: number | null | undefined): string {
  if (secs == null) return "";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function labelInput(label: string, children: JSX.Element) {
  return (
    <div class="flex flex-col gap-1">
      <label class="body-xs text-[var(--color-text-muted)]">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "body-small bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-2 py-1.5 text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-500)] transition-colors w-full";

// -------------------------------------------------------------------------
// artwork picker
// -------------------------------------------------------------------------

function ArtworkPicker(props: { preview: string | null; onFile: (file: File) => void }) {
  let inputRef!: HTMLInputElement;

  return (
    <div class="flex flex-col gap-2">
      <div
        class="w-24 h-24 rounded-lg border-2 border-dashed border-[var(--color-border-default)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent-500)] transition-colors overflow-hidden flex-shrink-0"
        onClick={() => inputRef.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.click()}
        aria-label="upload artwork"
      >
        <Show
          when={props.preview}
          fallback={
            <div class="flex flex-col items-center gap-1 text-[var(--color-text-muted)] p-2">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span class="body-xs text-center leading-tight">add art</span>
            </div>
          }
        >
          <img src={props.preview!} alt="artwork preview" class="w-full h-full object-cover" />
        </Show>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        class="hidden"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) props.onFile(file);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------------------
// song row editor
// -------------------------------------------------------------------------

function SongRowEditor(props: {
  song: ImportReviewSongEdit;
  isCompilation: boolean;
  onChange: (next: ImportReviewSongEdit) => void;
}) {
  const [lyricsOpen, setLyricsOpen] = createSignal(false);
  const update = (patch: Partial<ImportReviewSongEdit>) =>
    props.onChange({ ...props.song, ...patch });

  return (
    <div class="border-b border-[var(--color-border-subtle)] last:border-b-0">
      {/* main row */}
      <div class="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-primary)]">
        {/* disc / track */}
        <div class="flex items-center gap-1 flex-shrink-0">
          <Show when={props.song.discNumber != null}>
            <input
              type="number"
              min={1}
              value={props.song.discNumber ?? ""}
              onInput={(e) => update({ discNumber: parseInt(e.currentTarget.value) || null })}
              class="w-8 text-center body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[var(--color-text-primary)]"
              title="disc number"
              aria-label="disc number"
            />
            <span class="body-xs text-[var(--color-text-muted)]">-</span>
          </Show>
          <input
            type="number"
            min={1}
            value={props.song.trackNumber ?? ""}
            onInput={(e) => update({ trackNumber: parseInt(e.currentTarget.value) || null })}
            class="w-8 text-center body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[var(--color-text-primary)]"
            title="track number"
            aria-label="track number"
          />
        </div>

        {/* disc toggle button - only shown until a disc number is added */}
        <Show when={props.song.discNumber == null}>
          <button
            class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-shrink-0 transition-colors"
            title="add disc number"
            onClick={() => update({ discNumber: 1 })}
          >
            +disc
          </button>
        </Show>

        {/* title */}
        <input
          class={`${inputClass} flex-1 min-w-0`}
          value={props.song.title}
          onInput={(e) => update({ title: e.currentTarget.value })}
          placeholder="track title"
          aria-label="track title"
        />

        {/* duration (read-only display) */}
        <span class="body-xs text-[var(--color-text-muted)] flex-shrink-0 w-10 text-right">
          {fmtDuration(props.song.durationSeconds)}
        </span>

        {/* lyrics toggle */}
        <button
          class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-shrink-0 transition-colors px-1"
          onClick={() => setLyricsOpen((o) => !o)}
          aria-expanded={lyricsOpen()}
          title={lyricsOpen() ? "hide lyrics" : "edit lyrics"}
        >
          lyrics
        </button>
      </div>

      {/* per-song artist on its own line (compilation only) */}
      <Show when={props.isCompilation}>
        <div class="px-3 pb-2 bg-[var(--color-bg-primary)]">
          <input
            class={`${inputClass}`}
            value={props.song.artistName ?? ""}
            onInput={(e) => update({ artistName: e.currentTarget.value || null })}
            placeholder="track artist"
            aria-label="track artist"
          />
        </div>
      </Show>

      {/* collapsible lyrics textarea */}
      <Show when={lyricsOpen()}>
        <div class="px-3 pb-2 bg-[var(--color-bg-primary)]">
          <textarea
            class={`${inputClass} min-h-[100px] resize-y`}
            value={props.song.lyrics ?? ""}
            onInput={(e) => update({ lyrics: e.currentTarget.value || null })}
            placeholder="lyrics..."
            aria-label="lyrics"
          />
        </div>
      </Show>
    </div>
  );
}

// -------------------------------------------------------------------------
// main export
// -------------------------------------------------------------------------

export function ImportAlbumEditorPanel(props: ImportAlbumEditorPanelProps) {
  const isCompilation = createMemo(() => props.value.albumType === "compilation");
  const [activeTab, setActiveTab] = createSignal("metadata");

  const updateAlbum = (patch: Partial<ImportAlbumEdit>) =>
    props.onChange({ ...props.value, ...patch });

  const updateSong = (songId: string, next: ImportReviewSongEdit) =>
    props.onChange({
      ...props.value,
      songs: props.value.songs.map((s) => (s.id === songId ? next : s)),
    });

  const handleArtworkFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      updateAlbum({ artworkPreview: e.target?.result as string });
    };
    reader.readAsDataURL(file);
    props.onArtworkFilePicked?.(file);
  };

  // map import review songs to the shape MusicBrainzPanel expects
  const mbSongs = createMemo(
    () =>
      props.value.songs.map((s) => ({
        id: s.id,
        title: s.title,
        disc_number: s.discNumber,
        track_number: s.trackNumber,
        duration_seconds: s.durationSeconds,
        track_artist: s.artistName,
      })) as unknown as Song[]
  );

  const metadataContent = (
    <div class="flex flex-col gap-5">
      {/* artwork + album fields side by side */}
      <div class="flex gap-4 items-start">
        <ArtworkPicker preview={props.value.artworkPreview} onFile={handleArtworkFile} />

        <div class="flex-1 flex flex-col gap-3 min-w-0">
          {labelInput(
            "album title",
            props.renderAlbumTitleInput ? (
              props.renderAlbumTitleInput({
                value: props.value.title,
                onChange: (v) => updateAlbum({ title: v }),
              })
            ) : (
              <input
                class={inputClass}
                value={props.value.title}
                onInput={(e) => updateAlbum({ title: e.currentTarget.value })}
                placeholder="album title"
              />
            )
          )}

          {labelInput(
            "artist",
            props.renderArtistInput ? (
              props.renderArtistInput({
                value: props.value.artistName,
                onChange: (v) => updateAlbum({ artistName: v }),
                disabled: isCompilation(),
              })
            ) : (
              <input
                class={inputClass}
                value={props.value.artistName}
                onInput={(e) => updateAlbum({ artistName: e.currentTarget.value })}
                placeholder="artist name"
                disabled={isCompilation()}
                title={isCompilation() ? "compilation albums use per-track artists" : undefined}
              />
            )
          )}

          {labelInput(
            "type",
            <div class="flex gap-1 flex-wrap">
              <For each={ALBUM_TYPES}>
                {(t) => (
                  <button
                    class={`px-3 py-1 rounded body-xs border transition-colors ${
                      props.value.albumType === t.value
                        ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] border-[var(--color-accent-500)]"
                        : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] border-[var(--color-border-default)] hover:border-[var(--color-accent-400)]"
                    }`}
                    aria-pressed={props.value.albumType === t.value}
                    onClick={() => updateAlbum({ albumType: t.value })}
                  >
                    {t.label}
                  </button>
                )}
              </For>
            </div>
          )}
        </div>
      </div>

      {/* compilation notice */}
      <Show when={isCompilation()}>
        <p class="body-xs text-[var(--color-text-muted)] -mt-2">
          compilation - each track can have its own artist name
        </p>
      </Show>

      {/* song list */}
      <div class="flex flex-col gap-0">
        <div class="flex items-center justify-between mb-1.5">
          <span class="body-xs text-[var(--color-text-muted)]">
            {props.value.songs.length} track{props.value.songs.length !== 1 ? "s" : ""}
          </span>
          <Show when={isCompilation()}>
            <span class="body-xs text-[var(--color-text-muted)]">track artist</span>
          </Show>
        </div>

        <div class="rounded-lg border border-[var(--color-border-default)] overflow-hidden">
          <For each={props.value.songs}>
            {(song) => (
              <SongRowEditor
                song={song}
                isCompilation={isCompilation()}
                onChange={(next) => updateSong(song.id, next)}
              />
            )}
          </For>

          <Show when={props.value.songs.length === 0}>
            <div class="px-3 py-4 text-center">
              <p class="body-xs text-[var(--color-text-muted)]">no tracks</p>
            </div>
          </Show>
        </div>
      </div>

      {/* entity urls */}
      <EntityUrlz
        urls={props.value.entityUrls}
        onChange={(urls) => updateAlbum({ entityUrls: urls })}
      />

      {/* album images - rendered when caller opts in via images prop */}
      <Show when={props.value.images !== undefined}>
        <EntityImages
          images={props.value.images ?? []}
          onUpload={props.onImageUpload}
          onDelete={props.onImageDelete}
          onSetPrimary={props.onImageSetPrimary}
          compact
        />
      </Show>
    </div>
  );

  // when albumId is present, wrap in tabs so mb lookup is accessible alongside metadata editing
  if (!props.albumId) {
    return metadataContent;
  }

  return (
    <Tabs activeTab={activeTab()} onTabChange={setActiveTab}>
      <TabList>
        <Tab id="metadata" label="metadata" />
        <Tab id="musicbrainz" label="musicbrainz" />
      </TabList>
      <TabPanel id="metadata">{metadataContent}</TabPanel>
      <TabPanel id="musicbrainz">
        <MusicBrainzPanel
          albumId={props.albumId}
          albumTitle={props.value.title}
          artistId={props.artistId ?? ""}
          artistName={props.value.artistName}
          albumType={props.value.albumType}
          songs={mbSongs()}
          onAlbumUpdated={props.onAlbumUpdated ?? (() => {})}
          mbSearchFn={props.mbSearchFn}
          mbGetReleaseFn={props.mbGetReleaseFn}
        />
      </TabPanel>
    </Tabs>
  );
}
