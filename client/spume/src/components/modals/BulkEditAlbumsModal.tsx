// bulk edit modal for one or more albums (library view).
//
// modes:
//   * "metadata" — rename a single album (title) and/or change the
//     `album_type` for any number of selected albums. when more than
//     one album is selected the user can also pick a "combine" target
//     from the selection; the other albums get merged into it via
//     `merge_into_album_id` (server moves all songs over).
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
import { TextInput } from "../forms/TextInput";
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
  const [title, setTitle] = createSignal("");
  const [titleTouched, setTitleTouched] = createSignal(false);
  const [albumType, setAlbumType] = createSignal("");
  const [mergeTargetId, setMergeTargetId] = createSignal("");

  // disc-mode state
  const [discNumber, setDiscNumber] = createSignal(1);
  const [discTouched, setDiscTouched] = createSignal(false);

  const [isSaving, setIsSaving] = createSignal(false);

  // prefill title on single-album once loaded
  const prefilledTitle = createMemo(() => {
    const list = albums();
    if (!list || list.length !== 1) return "";
    const first = list[0];
    return first ? first.title : "";
  });
  // sync prefill when it lands (only if user hasn't typed yet)
  createEffect(() => {
    const t = prefilledTitle();
    if (!titleTouched() && t) setTitle(t);
  });

  // common album_type across all selected (for the placeholder hint)
  const commonAlbumType = createMemo<string | null>(() => {
    const list = albums();
    if (!list || list.length === 0) return null;
    const first = list[0]?.album_type ?? null;
    return list.every((a) => (a?.album_type ?? null) === first) ? first : null;
  });

  onMount(() => {
    const id = "bulk-edit-albums";
    pushModal(id, props.onClose);
    onCleanup(() => popModal(id));
  });

  const isValid = createMemo(() => {
    if (props.mode === "disc") return discTouched();
    // metadata: at least one of (title changed for single, album_type
    // picked, merge target picked)
    if (isSingle()) {
      const t = title().trim();
      if (t && t !== prefilledTitle()) return true;
    }
    if (albumType()) return true;
    if (!isSingle() && mergeTargetId()) return true;
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
    const newTitle = isSingle() ? title().trim() : "";
    const newType = albumType();

    let ok = 0;
    let failed = 0;

    // when a merge target is picked, every other selected album gets
    // its songs moved into the target. the target album itself can
    // still receive a title/type change.
    if (target) {
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
            // some codegens emit genre_ids/genres on update; pass null
            // through `as never` to stay type-loose if the schema
            // shape drifts.
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
      // optionally update the target's title/type
      if (newTitle || newType) {
        try {
          const resp = await client.music.updateAlbum({
            album_id: target,
            title: newTitle || null,
            artist_id: null,
            artist_name: null,
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
      // no merge: apply title (single only) + album_type to all
      for (const id of props.albumIds) {
        try {
          const resp = await client.music.updateAlbum({
            album_id: id,
            title: isSingle() && newTitle ? newTitle : null,
            artist_id: null,
            artist_name: null,
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
            {/* title — only for single-album rename */}
            <Show when={isSingle()}>
              <div>
                <label class="text-sm text-[var(--color-text-secondary)] mb-1 block">title</label>
                <TextInput
                  value={title()}
                  onInput={(e) => {
                    setTitleTouched(true);
                    setTitle(e.currentTarget.value);
                  }}
                  placeholder="album title"
                />
              </div>
            </Show>

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

            {/* combine — only when 2+ selected */}
            <Show when={!isSingle()}>
              <div>
                <label class="text-sm text-[var(--color-text-secondary)] mb-1 block">
                  combine into one album (optional)
                </label>
                <select
                  value={mergeTargetId()}
                  onChange={(e) => setMergeTargetId(e.currentTarget.value)}
                  class="w-full px-2 py-1.5 text-sm bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)]"
                >
                  <option value="">— don't combine —</option>
                  <For each={albums() ?? []}>
                    {(a) => (
                      <option value={a?.id ?? ""}>
                        keep: {a?.title ?? ""}
                        {a?.artist_name ? ` — ${a.artist_name}` : ""}
                      </option>
                    )}
                  </For>
                </select>
                <p class="text-xs text-[var(--color-text-tertiary)] mt-1 m-0">
                  picks one album to keep; songs from the others are moved into it.
                </p>
              </div>
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
