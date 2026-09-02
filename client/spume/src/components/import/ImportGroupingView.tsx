// presentational component for the album-grouping stage of the import review flow.
// no api calls here - all actions are passed as props.
import { For, Show, createSignal, createMemo } from "solid-js";
import { Button } from "../buttons/Button";
import { MediaImage } from "../media/MediaImage";
import { formatDuration } from "../../utils/formatDuration";
import type { ImageMetadata } from "../../music/services/storage/types";

// -------------------------------------------------------------------------
// types
// -------------------------------------------------------------------------

export interface ImportReviewSong {
  id: string;
  title: string;
  trackNumber?: number | null;
  discNumber?: number | null;
  durationSeconds?: number | null;
}

export interface ImportReviewAlbum {
  id: string;
  title: string;
  artist?: string | null;
  artistId?: string | null;
  artworkUrl?: string | null;
  /** local or remote blob id for the primary artwork - used by MediaImage */
  artworkBlobId?: string | null;
  /** remote server id (peer_addr for P2P, remote_id for HTTP) - used by MediaImage */
  remoteServerId?: string | null;
  /** entity URLs fetched from the album record */
  entityUrls?: { id?: string; name?: string | null; url: string }[];
  /** all images from the album record - used for image management in the editor */
  images?: ImageMetadata[];
  releaseDate?: string | null;
  label?: string | null;
  genres?: string[];
  albumType?: string | null;
  songs: ImportReviewSong[];
}

export interface ImportGroupingViewProps {
  albums: ImportReviewAlbum[];
  /** called with the ids of albums to merge and the target album id */
  onMerge: (sourceIds: string[], targetId: string) => void;
  /** called when a song is moved to a different (existing) album */
  onMoveSong: (songId: string, toAlbumId: string) => void;
  /** called when a song is moved to a brand-new album (created inline,
   * resolved find-or-create server-side under the review permission gate -
   * see grimoire's move_song handler) */
  onCreateAlbumForSong: (songId: string, title: string, artistName: string | null) => void;
  /** "all look right" - advance to metadata stage */
  onConfirm: () => void;
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

function fmtTrack(song: ImportReviewSong): string {
  if (song.discNumber != null && song.discNumber > 1) {
    return `${song.discNumber}-${song.trackNumber ?? "?"}`;
  }
  return song.trackNumber != null ? String(song.trackNumber) : "";
}

// -------------------------------------------------------------------------
// single-album card (collapsed fast-path)
// -------------------------------------------------------------------------

function SingleAlbumCollapsed(props: { album: ImportReviewAlbum; onConfirm: () => void }) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3 p-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]">
        <MediaImage
          remoteBlobId={props.album.artworkBlobId}
          remoteServerId={props.album.remoteServerId}
          imageUrl={props.album.artworkUrl}
          alt=""
          size="sm"
          thumbnailSize={200}
          class="w-12 h-12 rounded object-cover flex-shrink-0"
          showFallback
          domainType="album"
        />

        <div class="flex-1 min-w-0">
          <p class="body-base font-medium text-[var(--color-text-primary)] truncate">
            {props.album.title}
          </p>
          <p class="body-small text-[var(--color-text-secondary)] truncate">
            {props.album.artist ?? "unknown artist"} &middot; {props.album.songs.length} track
            {props.album.songs.length !== 1 ? "s" : ""}
          </p>
        </div>

        <button
          class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors flex-shrink-0"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded() ? "hide" : "show tracks"}
        </button>
      </div>

      <Show when={expanded()}>
        <div class="rounded-lg border border-[var(--color-border-default)] divide-y divide-[var(--color-border-subtle)] overflow-hidden">
          <For each={props.album.songs}>
            {(song) => (
              <div class="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-secondary)] text-sm">
                <span class="w-6 text-right body-xs text-[var(--color-text-muted)] flex-shrink-0">
                  {fmtTrack(song)}
                </span>
                <span class="flex-1 min-w-0 truncate text-[var(--color-text-primary)]">
                  {song.title}
                </span>
                <span class="body-xs text-[var(--color-text-muted)] flex-shrink-0">
                  {formatDuration(song.durationSeconds)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="flex gap-2">
        <Button variant="secondary" onClick={props.onConfirm}>
          next
          <svg
            class="inline ml-1"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 6h8M7 3l3 3-3 3"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// album card (multi-album grouping view)
// -------------------------------------------------------------------------

const NEW_ALBUM_VALUE = "__new__";

function AlbumGroupCard(props: {
  album: ImportReviewAlbum;
  otherAlbums: ImportReviewAlbum[];
  selected: boolean;
  onToggleSelect: () => void;
  onMoveSong: (songId: string, toAlbumId: string) => void;
  onCreateAlbumForSong: (songId: string, title: string, artistName: string | null) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  // song currently showing the "create new album" inline form (at most one
  // at a time, mirrors the single-select nature of the move-to dropdown)
  const [creatingForSongId, setCreatingForSongId] = createSignal<string | null>(null);
  const [newAlbumTitle, setNewAlbumTitle] = createSignal("");
  const [newAlbumArtist, setNewAlbumArtist] = createSignal("");

  const startCreating = (songId: string) => {
    setCreatingForSongId(songId);
    setNewAlbumTitle("");
    setNewAlbumArtist("");
  };
  const cancelCreating = () => setCreatingForSongId(null);
  const confirmCreating = (songId: string) => {
    const title = newAlbumTitle().trim();
    if (!title) return;
    props.onCreateAlbumForSong(songId, title, newAlbumArtist().trim() || null);
    setCreatingForSongId(null);
  };

  return (
    <div
      class={`flex flex-col rounded-lg border transition-colors ${
        props.selected
          ? "border-[var(--color-accent-500)] bg-[var(--color-bg-secondary)]"
          : "border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]"
      }`}
      style={{ "min-width": "0" }}
    >
      {/* card header */}
      <div class="flex items-start gap-3 p-3">
        <MediaImage
          remoteBlobId={props.album.artworkBlobId}
          remoteServerId={props.album.remoteServerId}
          imageUrl={props.album.artworkUrl}
          alt=""
          size="sm"
          thumbnailSize={200}
          class="w-10 h-10 rounded object-cover flex-shrink-0 mt-0.5"
          showFallback
          domainType="album"
        />

        <div class="flex-1 min-w-0">
          <p class="body-base font-medium text-[var(--color-text-primary)] truncate leading-tight">
            {props.album.title}
          </p>
          <p class="body-xs text-[var(--color-text-secondary)] truncate">
            {props.album.artist ?? "unknown"} &middot; {props.album.songs.length} tracks
          </p>
        </div>

        <label class="flex items-center gap-1.5 flex-shrink-0 cursor-pointer select-none mt-0.5">
          <input
            type="checkbox"
            checked={props.selected}
            onChange={props.onToggleSelect}
            class="w-4 h-4 rounded border-[var(--color-border-default)] accent-[var(--color-accent-500)]"
            aria-label={`select ${props.album.title}`}
          />
          <span class="body-xs text-[var(--color-text-muted)]">select</span>
        </label>
      </div>

      {/* expand/collapse toggle */}
      <button
        class="px-3 pb-1 body-xs text-left text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded() ? "hide tracks" : `show ${props.album.songs.length} tracks`}
      </button>

      {/* song list */}
      <Show when={expanded()}>
        <div class="border-t border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-b-lg">
          <For each={props.album.songs}>
            {(song) => (
              <div class="flex flex-col gap-1.5 px-3 py-1.5 bg-[var(--color-bg-primary)] text-sm group">
                <div class="flex items-center gap-2">
                  <span class="w-5 text-right body-xs text-[var(--color-text-muted)] flex-shrink-0">
                    {fmtTrack(song)}
                  </span>
                  <span class="flex-1 min-w-0 truncate text-[var(--color-text-primary)] body-small">
                    {song.title}
                  </span>
                  <span class="body-xs text-[var(--color-text-muted)] flex-shrink-0">
                    {formatDuration(song.durationSeconds)}
                  </span>

                  {/* move-to dropdown - always offers "create new album",
                      plus other albums in this session when there are any */}
                  <select
                    class="opacity-0 group-hover:opacity-100 body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[var(--color-text-secondary)] transition-opacity flex-shrink-0 max-w-[120px]"
                    value=""
                    aria-label={`move ${song.title} to album`}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      e.currentTarget.value = "";
                      if (!value) return;
                      if (value === NEW_ALBUM_VALUE) {
                        startCreating(song.id);
                        return;
                      }
                      props.onMoveSong(song.id, value);
                    }}
                  >
                    <option value="" disabled>
                      move to...
                    </option>
                    <option value={NEW_ALBUM_VALUE}>+ new album...</option>
                    <For each={props.otherAlbums}>
                      {(other) => <option value={other.id}>{other.title}</option>}
                    </For>
                  </select>
                </div>

                {/* inline "create new album" form for this song */}
                <Show when={creatingForSongId() === song.id}>
                  <div class="flex items-center gap-1.5 pl-7">
                    <input
                      type="text"
                      value={newAlbumTitle()}
                      onInput={(e) => setNewAlbumTitle(e.currentTarget.value)}
                      placeholder="new album title"
                      aria-label={`new album title for ${song.title}`}
                      class="flex-1 min-w-0 body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1.5 py-0.5 text-[var(--color-text-primary)]"
                    />
                    <input
                      type="text"
                      value={newAlbumArtist()}
                      onInput={(e) => setNewAlbumArtist(e.currentTarget.value)}
                      placeholder="artist (optional)"
                      aria-label={`new album artist for ${song.title}`}
                      class="flex-1 min-w-0 body-xs bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded px-1.5 py-0.5 text-[var(--color-text-primary)]"
                    />
                    <Button variant="primary" size="sm" onClick={() => confirmCreating(song.id)}>
                      add
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelCreating}>
                      cancel
                    </Button>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// -------------------------------------------------------------------------
// main export
// -------------------------------------------------------------------------

export function ImportGroupingView(props: ImportGroupingViewProps) {
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canMerge = createMemo(() => selectedIds().size >= 2);

  const handleMerge = () => {
    const ids = [...selectedIds()];
    const [targetId, ...sourceIds] = ids;
    props.onMerge(sourceIds, targetId);
    setSelectedIds(new Set<string>());
  };

  // fast-path: single album
  if (props.albums.length <= 1) {
    const album = props.albums[0];
    if (!album) {
      return (
        <div class="flex flex-col items-center justify-center py-12 gap-2">
          <p class="body-base text-[var(--color-text-muted)]">no albums in this session</p>
          <Button variant="ghost" onClick={props.onConfirm}>
            close
          </Button>
        </div>
      );
    }
    return <SingleAlbumCollapsed album={album} onConfirm={props.onConfirm} />;
  }

  // multi-album grouping view
  return (
    <div class="flex flex-col gap-4">
      <p class="body-small text-[var(--color-text-secondary)]">
        check that songs landed in the right albums. select two or more albums and merge if they
        should be one. hover over a song to move it to a different album.
      </p>

      <div
        class="grid gap-3"
        style={{ "grid-template-columns": "repeat(auto-fill, minmax(260px, 1fr))" }}
      >
        <For each={props.albums}>
          {(album) => (
            <AlbumGroupCard
              album={album}
              otherAlbums={props.albums.filter((a) => a.id !== album.id)}
              selected={selectedIds().has(album.id)}
              onToggleSelect={() => toggleSelect(album.id)}
              onMoveSong={props.onMoveSong}
              onCreateAlbumForSong={props.onCreateAlbumForSong}
            />
          )}
        </For>
      </div>

      <div class="flex gap-2 flex-wrap pt-2 border-t border-[var(--color-border-subtle)]">
        <Button variant="secondary" disabled={!canMerge()} onClick={handleMerge}>
          merge selected ({selectedIds().size})
        </Button>
        <Button variant="secondary" onClick={props.onConfirm}>
          next
          <svg
            class="inline ml-1"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2 6h8M7 3l3 3-3 3"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </Button>
      </div>
    </div>
  );
}
