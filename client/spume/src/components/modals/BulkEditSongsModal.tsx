// bulk edit modal for multiple songs - edit artist/album/disc number
// simplified: requires both artist and album, pre-populates from songs

import { createSignal, createMemo, Show, onMount, For, onCleanup } from "solid-js";
import { useUpdateSongsMutation } from "../../music/queries/songs";
import { pushModal, popModal } from "../../music/hooks/modals";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { AlbumAutocomplete } from "../forms/AlbumAutocomplete";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { error as errorLog } from "../../utils/logger";
import type { Song } from "../../music/data/types";

export type BulkEditMode = "metadata" | "disc";

const ALBUM_TYPE_OPTIONS = [
  { value: "album", label: "album" },
  { value: "compilation", label: "compilation" },
  { value: "single", label: "single" },
];

interface BulkEditSongsModalProps {
  isOpen: boolean;
  songIds: string[];
  songs?: Song[];
  mode: BulkEditMode;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BulkEditSongsModal(props: BulkEditSongsModalProps) {
  const updateMutation = useUpdateSongsMutation();

  // compute common values from songs for pre-population
  const commonArtist = createMemo(() => {
    if (!props.songs?.length) return null;
    const first = props.songs[0];
    const allSame = props.songs.every(
      (s) => s.artist_id === first.artist_id && s.artist_name === first.artist_name
    );
    return allSame && first.artist_id
      ? { id: first.artist_id, name: first.artist_name || "" }
      : null;
  });

  const commonAlbum = createMemo(() => {
    if (!props.songs?.length) return null;
    const first = props.songs[0];
    const allSame = props.songs.every(
      (s) => s.album_id === first.album_id && s.album_title === first.album_title
    );
    return allSame && first.album_id
      ? { id: first.album_id, title: first.album_title || "" }
      : null;
  });

  const commonAlbumType = createMemo(() => {
    if (!props.songs?.length) return null;
    const first = props.songs[0];
    const allSame = props.songs.every((s) => s.album_type === first.album_type);
    return allSame ? first.album_type || "album" : null;
  });

  // count unique values for "mixed" badges
  const uniqueArtistCount = createMemo(() => {
    if (!props.songs?.length) return 0;
    const ids = new Set(props.songs.map((s) => s.artist_id).filter(Boolean));
    return ids.size;
  });

  const uniqueAlbumCount = createMemo(() => {
    if (!props.songs?.length) return 0;
    const ids = new Set(props.songs.map((s) => s.album_id).filter(Boolean));
    return ids.size;
  });

  // form state - initialized from common values
  const [artistId, setArtistId] = createSignal<string | undefined>(commonArtist()?.id);
  const [artistName, setArtistName] = createSignal<string>(commonArtist()?.name || "");
  const [albumId, setAlbumId] = createSignal<string | undefined>(commonAlbum()?.id);
  const [albumTitle, setAlbumTitle] = createSignal<string>(commonAlbum()?.title || "");
  const [albumType, setAlbumType] = createSignal<string>(commonAlbumType() || "album");

  // disc number form state
  const [discNumber, setDiscNumber] = createSignal<number>(1);
  const [discChanged, setDiscChanged] = createSignal(false);

  const [isSaving, setIsSaving] = createSignal(false);

  // register modal for escape key handling
  onMount(() => {
    const modalId = "bulk-edit-songs";
    pushModal(modalId, props.onClose);
    onCleanup(() => popModal(modalId));
  });

  // validation: both artist and album required for metadata mode
  const isValid = createMemo(() => {
    if (props.mode === "metadata") {
      const hasArtist = Boolean(artistId() || artistName());
      const hasAlbum = Boolean(albumId() || albumTitle());
      return hasArtist && hasAlbum;
    }
    return discChanged();
  });

  const handleSave = async () => {
    if (!isValid()) {
      toast.error("please select both artist and album");
      return;
    }

    setIsSaving(true);

    try {
      const updates: {
        song_ids: string[];
        artist?: string;
        artist_id?: string;
        album?: string;
        album_id?: string;
        album_type?: string;
        populate_track_artist?: boolean;
        aggregate_album_images?: boolean;
        disc_number?: number;
      } = {
        song_ids: props.songIds,
      };

      if (props.mode === "metadata") {
        // artist - prefer id, fall back to name
        if (artistId()) {
          updates.artist_id = artistId();
        } else if (artistName()) {
          updates.artist = artistName();
        }

        // album - prefer id, fall back to title
        if (albumId()) {
          updates.album_id = albumId();
        } else if (albumTitle()) {
          updates.album = albumTitle();
        }

        // album type
        updates.album_type = albumType();

        // compilation special handling
        if (albumType() === "compilation") {
          updates.populate_track_artist = true;
          updates.aggregate_album_images = true;
        }
      } else {
        // disc number mode
        updates.disc_number = discNumber();
      }

      await updateMutation.mutateAsync(updates);
      toast.success(`updated ${props.songIds.length} songs`);
      props.onSuccess?.();
      props.onClose();
    } catch (error) {
      errorLog("failed to bulk update songs:", error);
      toast.error("failed to update songs");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div
        class="flex items-center justify-center bg-black/60"
        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 50 }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div class="bg-[var(--color-bg-secondary)] wide:border wide:border-[var(--color-border-default)] wide:rounded-lg shadow-xl w-full h-full wide:h-auto wide:max-w-md wide:mx-4 wide:max-h-[calc(100dvh-96px)] flex flex-col overflow-y-auto">
          {/* header */}
          <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)] shrink-0">
            <h2 class="text-lg font-medium text-[var(--color-text-primary)]">
              {props.mode === "metadata" ? "edit artist / album" : "set disc number"}
            </h2>
            <div class="flex items-center gap-2">
              <span class="text-sm text-[var(--color-text-secondary)]">
                {props.songIds.length} songs
              </span>
              <button
                onClick={props.onClose}
                class="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <Icon name={IconNames.close} size={20} />
              </button>
            </div>
          </div>

          {/* content */}
          <div class="p-4 space-y-4 overflow-y-auto">
            <Show when={props.mode === "metadata"}>
              {/* artist field */}
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <label class="text-sm text-[var(--color-text-secondary)]">artist</label>
                  <Show when={uniqueArtistCount() > 1 && !artistId() && !artistName()}>
                    <span class="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
                      {uniqueArtistCount()} different
                    </span>
                  </Show>
                  <span class="text-red-400 text-xs">*</span>
                </div>
                <ArtistAutocomplete
                  value={artistName()}
                  placeholder="search or type artist name..."
                  onSelect={(artist) => {
                    setArtistId(artist.id);
                    setArtistName(artist.name);
                  }}
                />
              </div>

              {/* album field */}
              <div>
                <div class="flex items-center gap-2 mb-1">
                  <label class="text-sm text-[var(--color-text-secondary)]">album</label>
                  <Show when={uniqueAlbumCount() > 1 && !albumId() && !albumTitle()}>
                    <span class="text-xs text-[var(--color-text-tertiary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
                      {uniqueAlbumCount()} different
                    </span>
                  </Show>
                  <span class="text-red-400 text-xs">*</span>
                </div>
                <AlbumAutocomplete
                  value={albumTitle()}
                  placeholder="search or type album title..."
                  artistId={() => artistId()}
                  onSelect={(album) => {
                    setAlbumId(album.id);
                    setAlbumTitle(album.title);
                  }}
                />
              </div>

              {/* album type field */}
              <div>
                <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                  album type
                </label>
                <select
                  value={albumType()}
                  onChange={(e) => setAlbumType(e.currentTarget.value)}
                  class="w-full px-3 py-2 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                >
                  <For each={ALBUM_TYPE_OPTIONS}>
                    {(opt) => <option value={opt.value}>{opt.label}</option>}
                  </For>
                </select>
                <Show when={albumType() === "compilation"}>
                  <p class="mt-1 text-xs text-[var(--color-text-tertiary)]">
                    each song's current artist will be saved as track artist
                  </p>
                </Show>
              </div>

              {/* multi-source album info */}
              <Show when={uniqueAlbumCount() > 1}>
                <div class="p-3 bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] rounded text-sm">
                  <p class="text-[var(--color-text-secondary)]">
                    songs from {uniqueAlbumCount()} albums will be moved to the selected album.
                    images from source albums will be copied.
                  </p>
                </div>
              </Show>
            </Show>

            <Show when={props.mode === "disc"}>
              {/* disc number field */}
              <div>
                <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                  disc number
                </label>
                <TextInput
                  type="number"
                  value={String(discNumber())}
                  oninput={(e) => {
                    const val = parseInt(e.currentTarget.value, 10);
                    if (!isNaN(val) && val > 0) {
                      setDiscNumber(val);
                      setDiscChanged(true);
                    }
                  }}
                  min={1}
                  placeholder="1"
                />
                <p class="mt-1 text-xs text-[var(--color-text-tertiary)]">
                  set disc number for all {props.songIds.length} selected songs
                </p>
              </div>
            </Show>
          </div>

          {/* footer */}
          <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-default)] shrink-0">
            <Button variant="ghost" onClick={props.onClose} disabled={isSaving()}>
              cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!isValid() || isSaving()}>
              {isSaving() ? "saving..." : "save changes"}
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
