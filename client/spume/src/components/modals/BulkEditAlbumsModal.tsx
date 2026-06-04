// bulk edit modal for one or more albums (library view).
//
// modes:
//   * "metadata" — rename artist + album for one selected album, and/or
//     change `album_type` for any number of selected albums. uses the
//     same ArtistAutocomplete + AlbumAutocomplete used elsewhere in the
//     app, scoped to the picked remote. when 2+ albums are selected the
//     album picker becomes a "combine into" target picker (any existing
//     album on the remote — songs from the others get moved into it via
//     `merge_into_album_id`).
//   * "disc" — set a single disc number across every song in every
//     selected album (fans out via `updateSongs`).
//
// remote-aware: all reads + writes go through the picked remote's
// api client (not the global active datasource), so it works for any
// remote the library view is browsing.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Modal } from "./Modal";
import { Button } from "../buttons/Button";
import { Icon, IconNames } from "../icons/registry";
import { ArtistAutocomplete } from "../forms/ArtistAutocomplete";
import { AlbumAutocomplete } from "../forms/AlbumAutocomplete";
import { toast } from "../feedback/Toast";
import { pushModal, popModal } from "../../music/hooks/modals";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { queryClient } from "../../queryClient";

export type BulkEditAlbumsMode = "metadata" | "disc";

const ALBUM_TYPE_OPTIONS = [
  { value: "", label: "(no change)" },
  { value: "album", label: "album" },
  { value: "compilation", label: "compilation" },
  { value: "single", label: "single" },
  { value: "ep", label: "ep" },
];

interface AlbumLite {
  id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album_type: string | null;
}

interface BulkEditAlbumsModalProps {
  isOpen: boolean;
  albumIds: string[];
  remote: Remote;
  mode: BulkEditAlbumsMode;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BulkEditAlbumsModal(props: BulkEditAlbumsModalProps) {
  // load the album rows so we can show titles + prefill common values.
  const [albums] = createResource(
    () => [props.albumIds, props.remote] as const,
    async ([ids, remote]) => {
      if (ids.length === 0) return [];
      const client = await getClientForRemote(remote);
      const results = await Promise.all(
        ids.map(async (id): Promise<AlbumLite | null> => {
          try {
            const resp = await client.music.queryAlbums({
              q: null,
              search_fields: null,
              filters: { album_id: id },
              sort_by: null,
              sort_direction: null,
              limit: 1,
              offset: 0,
              user_id: null,
              favorites_only: null,
              min_rating: null,
            });
            if (!resp.success || !resp.data) return null;
            const item = resp.data.items[0];
            if (!item) return null;
            const lite: AlbumLite = {
              id: item.album.id,
              title: item.album.title,
              artist_id: item.artist?.id ?? "",
              artist_name: item.artist?.name ?? "",
              album_type: item.album.album_type ?? null,
            };
            return lite;
          } catch {
            return null;
          }
        })
      );
      return results.filter((a): a is AlbumLite => a !== null);
    }
  );

  const isSingle = createMemo(() => props.albumIds.length === 1);

  // metadata-mode state
  // artist: when picked existing → artistId set; when new → only
  // artistName set. only applies when user actually changed it.
  const [artistId, setArtistId] = createSignal<string | undefined>(undefined);
  const [artistName, setArtistName] = createSignal("");
  const [artistTouched, setArtistTouched] = createSignal(false);
  // album: in single mode: pick existing → mergeTargetId set; new (or
  // typed-as-create) → just rename to that title. in multi mode: only
  // existing pick is meaningful → mergeTargetId.
  const [albumTitle, setAlbumTitle] = createSignal("");
  const [mergeTargetId, setMergeTargetId] = createSignal<string | undefined>(undefined);
  const [albumTouched, setAlbumTouched] = createSignal(false);
  const [albumType, setAlbumType] = createSignal("");

  // disc-mode state
  const [discNumber, setDiscNumber] = createSignal(1);
  const [discTouched, setDiscTouched] = createSignal(false);

  const [isSaving, setIsSaving] = createSignal(false);

  // prefill artist + album on single-album once loaded
  createEffect(() => {
    const list = albums();
    if (!list || list.length !== 1) return;
    const first = list[0];
    if (!first) return;
    if (!artistTouched()) {
      setArtistName(first.artist_name);
      setArtistId(first.artist_id || undefined);
    }
    if (!albumTouched()) {
      setAlbumTitle(first.title);
    }
  });

  // common album_type across all selected (for the placeholder hint)
  const commonAlbumType = createMemo<string | null>(() => {
    const list = albums();
    if (!list || list.length === 0) return null;
    const first = list[0]?.album_type ?? null;
    return list.every((a) => (a?.album_type ?? null) === first) ? first : null;
  });

  // current artist id accessor for AlbumAutocomplete to filter by
  // — only used in single mode (otherwise the artist picker may be
  // intentionally cleared/changed across the whole selection).
  const albumPickerArtistId = () => artistId();

  onMount(() => {
    const id = "bulk-edit-albums";
    pushModal(id, props.onClose);
    onCleanup(() => popModal(id));
  });

  const isValid = createMemo(() => {
    if (props.mode === "disc") return discTouched();
    // metadata: at least one of (artist changed, title changed for
    // single, album_type picked, merge target picked)
    if (artistTouched()) return true;
    if (isSingle() && albumTouched()) return true;
    if (albumType()) return true;
    if (mergeTargetId()) return true;
    return false;
  });

  const invalidateLibrary = () => {
    void queryClient.invalidateQueries({
      queryKey: ["library-albums", props.remote.remote_id],
    });
  };

  const handleSaveMetadata = async () => {
    const client = await getClientForRemote(props.remote);
    const target = mergeTargetId();
    // artist payload (only when user changed it)
    const newArtistId = artistTouched() ? (artistId() ?? null) : null;
    const newArtistName =
      artistTouched() && !newArtistId && artistName().trim() ? artistName().trim() : null;
    const newType = albumType();
    const newTitle = isSingle() && albumTouched() && !target ? albumTitle().trim() : "";

    let ok = 0;
    let failed = 0;

    if (target) {
      // merge: every selected album (other than the target) is merged
      // into target. artist/type changes still apply to the target.
      for (const id of props.albumIds) {
        if (id === target) continue;
        try {
          const resp = await client.music.updateAlbum({
            album_id: id,
            title: null,
            artist_id: null,
            artist_name: null,
            album_type: null,
            release_date: null,
            label: null,
            entity_urls: null,
            updated_by: null,
            merge_into_album_id: target,
          } as Parameters<typeof client.music.updateAlbum>[0]);
          if (resp.success) ok += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (newArtistId || newArtistName || newType) {
        try {
          const resp = await client.music.updateAlbum({
            album_id: target,
            title: null,
            artist_id: newArtistId,
            artist_name: newArtistName,
            album_type: newType || null,
            release_date: null,
            label: null,
            entity_urls: null,
            updated_by: null,
            merge_into_album_id: null,
          } as Parameters<typeof client.music.updateAlbum>[0]);
          if (resp.success) ok += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
    } else {
      // no merge: apply artist (any mode) + title (single only) +
      // album_type to all selected.
      for (const id of props.albumIds) {
        try {
          const resp = await client.music.updateAlbum({
            album_id: id,
            title: isSingle() && newTitle ? newTitle : null,
            artist_id: newArtistId,
            artist_name: newArtistName,
            album_type: newType || null,
            release_date: null,
            label: null,
            entity_urls: null,
            updated_by: null,
            merge_into_album_id: null,
          } as Parameters<typeof client.music.updateAlbum>[0]);
          if (resp.success) ok += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
    }

    invalidateLibrary();
    if (failed > 0) {
      toast.error(`updated ${ok} ok, ${failed} failed`);
    } else {
      toast.success(
        target
          ? `combined ${props.albumIds.length} albums`
          : `updated ${ok} album${ok === 1 ? "" : "s"}`
      );
    }
  };

  const handleSaveDisc = async () => {
    const client = await getClientForRemote(props.remote);
    // collect all song ids across the selected albums (one
    // querySongs call per album).
    const songIds: string[] = [];
    for (const id of props.albumIds) {
      try {
        const resp = await client.music.querySongs({
          q: null,
          search_fields: null,
          filters: { album_id: id },
          sort_by: null,
          sort_direction: null,
          limit: 1000,
          offset: 0,
          user_id: null,
          favorites_only: null,
          min_rating: null,
        });
        if (resp.success && resp.data) {
          for (const it of resp.data.items) songIds.push(it.song.id);
        }
      } catch {
        /* skip */
      }
    }
    if (songIds.length === 0) {
      toast.error("no songs found in selected albums");
      return;
    }
    try {
      const resp = await client.music.updateSongs({
        song_ids: songIds,
        title: null,
        artist_id: null,
        artist: null,
        album_id: null,
        album: null,
        album_type: null,
        populate_track_artist: null,
        aggregate_album_images: null,
        track_number: null,
        disc_number: discNumber(),
        year: null,
        duration: null,
        bpm: null,
        lyrics: null,
        track_artist: null,
      } as Parameters<typeof client.music.updateSongs>[0]);
      if (resp.success) {
        toast.success(`set disc ${discNumber()} on ${songIds.length} songs`);
      } else {
        toast.error("failed to set disc number");
      }
    } catch {
      toast.error("failed to set disc number");
    }
    invalidateLibrary();
  };

  const handleSave = async () => {
    if (!isValid()) return;
    setIsSaving(true);
    try {
      if (props.mode === "metadata") await handleSaveMetadata();
      else await handleSaveDisc();
      props.onSuccess?.();
      props.onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const heading = () => {
    if (props.mode === "disc") return "set disc number";
    return isSingle() ? "edit album" : "edit albums";
  };

  return (
    <Show when={props.isOpen}>
      <Modal isOpen={true} onClose={props.onClose} title={heading()} size="md">
        <div class="p-4 space-y-4">
          <div class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
            <span>
              {props.albumIds.length} album{props.albumIds.length === 1 ? "" : "s"} selected
            </span>
            <Show when={albums.loading}>
              <span class="italic text-[var(--color-text-disabled)]">loading…</span>
            </Show>
          </div>

          <Show when={props.mode === "metadata"}>
            {/* artist — applies to all selected (rename or repoint) */}
            <ArtistAutocomplete
              label="artist"
              value={artistName()}
              remote={props.remote}
              placeholder={isSingle() ? "artist name" : "artist for all selected"}
              hint={
                isSingle()
                  ? "pick an existing artist or type a new name"
                  : "applies to every selected album"
              }
              onSelect={(sel) => {
                setArtistTouched(true);
                setArtistName(sel.name);
                setArtistId(sel.isNew ? undefined : sel.id);
              }}
            />

            {/* album — single mode: rename or merge into existing.
                multi mode: only existing pick is meaningful (= combine
                target). */}
            <AlbumAutocomplete
              label={isSingle() ? "album" : "combine into album (optional)"}
              value={isSingle() ? albumTitle() : ""}
              artistId={albumPickerArtistId}
              remote={props.remote}
              placeholder={
                isSingle() ? "album title" : "search for an album to combine selection into…"
              }
              hint={
                isSingle()
                  ? "type a new title to rename, or pick an existing album to merge this one into it."
                  : "songs from every selected album will be moved into the picked album."
              }
              onSelect={(sel) => {
                setAlbumTouched(true);
                if (sel.isNew) {
                  // user-typed new title — rename only (single mode)
                  setAlbumTitle(sel.title);
                  setMergeTargetId(undefined);
                } else {
                  setAlbumTitle(sel.title);
                  setMergeTargetId(sel.id);
                }
              }}
            />

            {/* album type — applies to all selected */}
            <div>
              <label class="text-sm text-[var(--color-text-secondary)] mb-1 block">
                album type
                <Show when={!isSingle() && commonAlbumType()}>
                  <span class="ml-2 text-xs text-[var(--color-text-tertiary)]">
                    (current: {commonAlbumType()})
                  </span>
                </Show>
                <Show when={!isSingle() && !commonAlbumType()}>
                  <span class="ml-2 text-xs text-[var(--color-text-tertiary)]">(mixed)</span>
                </Show>
              </label>
              <select
                value={albumType()}
                onChange={(e) => setAlbumType(e.currentTarget.value)}
                class="w-full px-2 py-1.5 text-sm bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)]"
              >
                <For each={ALBUM_TYPE_OPTIONS}>
                  {(o) => <option value={o.value}>{o.label}</option>}
                </For>
              </select>
            </div>

            <Show when={mergeTargetId()}>
              <p class="text-xs text-[var(--color-warning)] m-0">
                merge target picked — songs from {props.albumIds.length} album
                {props.albumIds.length === 1 ? "" : "s"} will be moved into "{albumTitle()}".
              </p>
            </Show>
          </Show>

          <Show when={props.mode === "disc"}>
            <div>
              <label class="text-sm text-[var(--color-text-secondary)] mb-1 block">
                disc number
              </label>
              <input
                type="number"
                min={1}
                max={99}
                value={discNumber()}
                onInput={(e) => {
                  setDiscTouched(true);
                  const n = parseInt(e.currentTarget.value, 10);
                  if (!Number.isNaN(n) && n >= 1) setDiscNumber(n);
                }}
                class="w-24 px-2 py-1.5 text-sm bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)]"
              />
              <p class="text-xs text-[var(--color-text-tertiary)] mt-1 m-0">
                applies to every song in every selected album.
              </p>
            </div>
          </Show>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
            <Button variant="ghost" onClick={props.onClose} disabled={isSaving()}>
              cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSave()}
              disabled={!isValid() || isSaving()}
            >
              <Show when={isSaving()} fallback={<Icon name={IconNames.check} size={14} />}>
                <Icon name={IconNames.loader} size={14} className="animate-spin" />
              </Show>
              save
            </Button>
          </div>
        </div>
      </Modal>
    </Show>
  );
}
