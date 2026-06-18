// focused per-album editor for the import review flow.
// covers the fields most likely to need fixing after an automated import:
// album title, artist, album type, artwork, and per-song title/track/disc/artist.
//
// purely presentational - no api calls. the caller (ImportReviewModal) owns state
// and passes onChange callbacks. designed to be plugged into the renderAlbumEditor
// render prop.
import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js";
import type { ImageMetadata, Song } from "../../music/services/storage/types";
import { formatDuration } from "../../utils/formatDuration";
import { EntityUrlz, type EntityUrlFormItem } from "../forms/EntityUrlz";
import { EntityImages } from "../layout/EntityImages";
import { MediaImage } from "../media/MediaImage";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import { MusicBrainzPanel } from "../musicbrainz/MusicBrainzPanel";
import { AlbumTaxonsEditor } from "../modals/AlbumTaxonsEditor";
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
  releaseDate?: string | null;
  label?: string | null;
  genres?: string[];
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
  /** when provided, a taxons tab is added alongside metadata + musicbrainz */
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
  /** called after MusicBrainzPanel syncs metadata or imports artwork, or after
   *  taxon apply - triggers a refetch of the album in the parent */
  onAlbumUpdated?: () => void;
  /** canonical album title from the source album object, bypassing the edit()
   *  signal layer. used for search input pre-fill on album navigation so the
   *  reset effect gets the new album's title synchronously. */
  canonicalAlbumTitle?: string;
  canonicalArtistName?: string;
  /** optional existing artwork for display (url + blob id + server id) */
  existingArtworkUrl?: string | null;
  existingArtworkBlobId?: string | null;
  existingArtworkServerId?: string | null;
  /** explicit api client to use for sub-components (taxons, etc.) instead of
   *  falling back to getTaxonomyClient() / getCurrentRemote().
   *  pass this when the review is for a remote that may not be the current
   *  active one (e.g. opened via deep-link while on a different route). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiClient?: any;
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

const ALBUM_TYPES: { value: AlbumType; label: string }[] = [
  { value: "album", label: "album" },
  { value: "single", label: "single" },
  { value: "compilation", label: "compilation" },
];

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
      {/* main row: title + duration */}
      <div class="flex items-center gap-2 px-3 pt-2 pb-1 bg-[var(--color-bg-primary)]">
        <input
          class={`${inputClass} flex-1 min-w-0`}
          value={props.song.title}
          onInput={(e) => update({ title: e.currentTarget.value })}
          placeholder="track title"
          aria-label="track title"
        />
        <span class="body-xs text-[var(--color-text-muted)] flex-shrink-0 w-10 text-right tabular-nums">
          {formatDuration(props.song.durationSeconds)}
        </span>
      </div>

      {/* sub-row: track / disc numbers + lyrics toggle */}
      <div class="flex items-center gap-3 px-3 pb-2 bg-[var(--color-bg-primary)]">
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <label class="body-xs text-[var(--color-text-muted)]">track</label>
          <input
            type="number"
            min={1}
            value={props.song.trackNumber ?? ""}
            onInput={(e) => update({ trackNumber: parseInt(e.currentTarget.value) || null })}
            class="w-10 text-center body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[var(--color-text-primary)]"
            aria-label="track number"
          />
        </div>

        <Show when={props.song.discNumber != null}>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <label class="body-xs text-[var(--color-text-muted)]">disc</label>
            <input
              type="number"
              min={1}
              value={props.song.discNumber ?? ""}
              onInput={(e) => update({ discNumber: parseInt(e.currentTarget.value) || null })}
              class="w-10 text-center body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[var(--color-text-primary)]"
              aria-label="disc number"
            />
            <button
              class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
              title="remove disc number"
              onClick={() => update({ discNumber: null })}
              aria-label="remove disc number"
            >
              x
            </button>
          </div>
        </Show>

        <Show when={props.song.discNumber == null}>
          <button
            class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-shrink-0 transition-colors"
            onClick={() => update({ discNumber: 1 })}
          >
            +disc
          </button>
        </Show>

        <span class="flex-1" />

        <button
          class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] flex-shrink-0 transition-colors"
          onClick={() => setLyricsOpen((o) => !o)}
          aria-expanded={lyricsOpen()}
          title={lyricsOpen() ? "hide lyrics" : "edit lyrics"}
        >
          {lyricsOpen() ? "hide lyrics" : "lyrics"}
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
  // reset to metadata tab when navigating to a different album.
  // albumIdMemo has equality semantics (===) so the effect only fires when the
  // id string actually changes - NOT on every refetch that invalidates currentAlbum().
  // without the memo, on(() => props.albumId, ...) re-runs on every resource
  // refresh because props.albumId reads currentAlbum() which invalidates on
  // every new array reference, even when the album id is unchanged.
  const albumIdMemo = createMemo(() => props.albumId);
  createEffect(on(albumIdMemo, () => setActiveTab("metadata"), { defer: true }));

  const handleTabChange = (tab: string) => {
    const prev = activeTab();
    setActiveTab(tab);
    // only refetch when leaving musicbrainz - MB may have updated title/artist/artwork
    // taxons don't change the metadata form fields, so no refetch needed there
    if (prev === "musicbrainz" && tab === "metadata") {
      props.onAlbumUpdated?.();
    }
  };

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
    <div class="flex flex-col gap-5 pt-2">
      {/* artwork row: on mobile stack art above fields; on sm+ show side by side */}
      <div class="flex flex-col sm:flex-row gap-4 items-start">
        {/* upload picker for new artwork - only shown when no managed images or no albumId */}
        <Show when={!props.value.images || props.value.images.length === 0}>
          <div class="flex gap-3 items-start flex-shrink-0">
            <Show when={props.existingArtworkBlobId ?? props.existingArtworkUrl}>
              <MediaImage
                remoteBlobId={props.existingArtworkBlobId ?? undefined}
                remoteServerId={props.existingArtworkServerId ?? undefined}
                imageUrl={props.existingArtworkUrl ?? undefined}
                alt="current artwork"
                size="sm"
                thumbnailSize={200}
                class="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover flex-shrink-0"
                showFallback
                domainType="album"
              />
            </Show>
            <ArtworkPicker preview={props.value.artworkPreview} onFile={handleArtworkFile} />
          </div>
        </Show>

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

      {/* album images - when available, replaces the standalone picker above */}
      <Show when={props.value.images !== undefined}>
        <EntityImages
          images={props.value.images ?? []}
          onUpload={props.onImageUpload ?? props.onArtworkFilePicked}
          onDelete={props.onImageDelete}
          onSetPrimary={props.onImageSetPrimary}
          compact
        />
      </Show>
    </div>
  );

  // when albumId is present, wrap in tabs so mb lookup + taxons are accessible
  if (!props.albumId) {
    return metadataContent;
  }

  return (
    <Tabs activeTab={activeTab()} onTabChange={handleTabChange}>
      <TabList>
        <Tab id="metadata" label="metadata" />
        <Tab id="taxons" label="taxons" />
        <Tab id="musicbrainz" label="musicbrainz" />
      </TabList>
      <TabPanel id="metadata">{metadataContent}</TabPanel>
      <TabPanel id="taxons">
        <div class="py-2">
          <AlbumTaxonsEditor
            albumId={props.albumId}
            apiClient={props.apiClient}
          />
        </div>
      </TabPanel>
      <TabPanel id="musicbrainz">
        <MusicBrainzPanel
          albumId={props.albumId}
          albumTitle={props.value.title}
          artistId={props.artistId ?? ""}
          artistName={props.value.artistName}
          albumType={props.value.albumType}
          releaseDate={props.value.releaseDate ?? undefined}
          label={props.value.label ?? undefined}
          genres={props.value.genres}
          songs={mbSongs()}
          onAlbumUpdated={props.onAlbumUpdated ?? (() => {})}
          mbSearchFn={props.mbSearchFn}
          mbGetReleaseFn={props.mbGetReleaseFn}
          canonicalAlbumTitle={props.canonicalAlbumTitle}
          canonicalArtistName={props.canonicalArtistName}
        />
      </TabPanel>
    </Tabs>
  );
}
