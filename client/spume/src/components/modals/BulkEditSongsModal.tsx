// bulk edit modal for multiple songs - edit artist/album/disc number

import { createSignal, Show, onMount } from "solid-js";
import { useUpdateSongsMutation } from "../../music/queries/songs";
import { pushModal, popModal } from "../../music/hooks/modals";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { AlbumAutocomplete } from "../forms/AlbumAutocomplete";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { error as errorLog } from "../../utils/logger";

export type BulkEditMode = "metadata" | "disc";

interface BulkEditSongsModalProps {
  isOpen: boolean;
  songIds: string[];
  /** which edit mode to start in */
  mode: BulkEditMode;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BulkEditSongsModal(props: BulkEditSongsModalProps) {
  const updateMutation = useUpdateSongsMutation();

  // metadata form state
  const [artistId, setArtistId] = createSignal<string | undefined>(undefined);
  const [artistName, setArtistName] = createSignal<string>("");
  const [albumId, setAlbumId] = createSignal<string | undefined>(undefined);
  const [albumTitle, setAlbumTitle] = createSignal<string>("");

  // disc number form state
  const [discNumber, setDiscNumber] = createSignal<number>(1);

  // track what's been changed
  const [artistChanged, setArtistChanged] = createSignal(false);
  const [albumChanged, setAlbumChanged] = createSignal(false);
  const [discChanged, setDiscChanged] = createSignal(false);

  const [isSaving, setIsSaving] = createSignal(false);

  // register modal for escape key handling
  onMount(() => {
    const modalId = "bulk-edit-songs";
    pushModal(modalId, props.onClose);
    return () => popModal(modalId);
  });

  const hasChanges = () => {
    if (props.mode === "metadata") {
      return artistChanged() || albumChanged();
    }
    return discChanged();
  };

  const handleSave = async () => {
    if (!hasChanges()) {
      toast.info("no changes to save");
      props.onClose();
      return;
    }

    setIsSaving(true);

    try {
      // build updates object with proper type
      const updates: {
        song_ids: string[];
        artist?: string;
        artist_id?: string;
        album?: string;
        album_id?: string;
        disc_number?: number;
      } = {
        song_ids: props.songIds,
      };

      if (props.mode === "metadata") {
        // artist changes
        if (artistChanged()) {
          if (artistId()) {
            updates.artist_id = artistId();
          } else if (artistName()) {
            updates.artist = artistName();
          }
        }

        // album changes
        if (albumChanged()) {
          if (albumId()) {
            updates.album_id = albumId();
          } else if (albumTitle()) {
            updates.album = albumTitle();
          }
        }
      } else {
        // disc number mode
        if (discChanged()) {
          updates.disc_number = discNumber();
        }
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
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
      >
        <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg shadow-xl w-full max-w-md mx-4">
          {/* header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
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
        <div class="p-4 space-y-4">
          <Show when={props.mode === "metadata"}>
            {/* artist field */}
            <div>
              <ArtistAutocomplete
                label="artist"
                placeholder="search or type artist name..."
                hint="leave empty to keep current artists"
                onSelect={(artist) => {
                  setArtistId(artist.id);
                  setArtistName(artist.name);
                  setArtistChanged(true);
                }}
              />
              <Show when={artistChanged()}>
                <button
                  onClick={() => {
                    setArtistId(undefined);
                    setArtistName("");
                    setArtistChanged(false);
                  }}
                  class="mt-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  reset
                </button>
              </Show>
            </div>

            {/* album field */}
            <div>
              <AlbumAutocomplete
                label="album"
                placeholder="search or type album title..."
                hint="leave empty to keep current albums"
                onSelect={(album) => {
                  setAlbumId(album.id);
                  setAlbumTitle(album.title);
                  setAlbumChanged(true);
                }}
              />
              <Show when={albumChanged()}>
                <button
                  onClick={() => {
                    setAlbumId(undefined);
                    setAlbumTitle("");
                    setAlbumChanged(false);
                  }}
                  class="mt-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  reset
                </button>
              </Show>
            </div>
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
        <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border-default)]">
          <Button variant="ghost" onClick={props.onClose} disabled={isSaving()}>
            cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!hasChanges() || isSaving()}
          >
            {isSaving() ? "saving..." : "save changes"}
          </Button>
        </div>
      </div>
    </div>
    </Show>
  );
}
