// album editor "artist" tab (phase 14.10).
//
// surfaces the album's primary artist for review while the user is
// stepping through the bulk enrichment flow. minimal MVP scope:
//
//   * read-only artist name (renames live in the artist detail view)
//   * editable bio textarea
//   * existing image list + per-row "make primary" + a URL input that
//     POSTs to /api/music/images/ingest with target.kind = "artist"
//   * save button calls updateArtistMetadata({ artist_id, bio, force })
//   * skip-if-complete hint + `force` toggle when bio + image are present
//
// the side-by-side lastfm vs audiodb bio diff promised in the plan
// requires artist-level enrichment jobs that don't exist yet — when those
// land, this tab grows the per-source columns.

import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { Icon } from "../icons/registry";
import { getCurrentRemote } from "../../music/data";
import { getClientForRemote } from "../../app/api/client";
import { useArtistQuery } from "../../music/queries/songs";
import { ArtistRelatedPanel } from "./ArtistRelatedPanel";

interface AlbumArtistTabProps {
  artistId: string | undefined;
  artistName: string;
  /** called after a successful save so the parent can refetch + bump the
   *  enrichment progress poll. */
  onSaved?: () => void;
}

export function AlbumArtistTab(props: AlbumArtistTabProps) {
  const artistQuery = useArtistQuery(() => props.artistId);
  const [bioDraft, setBioDraft] = createSignal<string>("");
  const [bioInitialised, setBioInitialised] = createSignal(false);
  const [force, setForce] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal("");
  const [ingesting, setIngesting] = createSignal(false);

  // seed the textarea once when artist data first lands.
  createMemo(() => {
    const a = artistQuery.data;
    if (!a || bioInitialised()) return;
    setBioDraft(a.bio ?? "");
    setBioInitialised(true);
  });

  const hasBio = createMemo(() => {
    const a = artistQuery.data;
    return !!(a?.bio && a.bio.trim().length > 0);
  });

  const imageCount = createMemo(() => artistQuery.data?.images?.length ?? 0);
  const isComplete = createMemo(() => hasBio() && imageCount() > 0);

  const handleSaveBio = async () => {
    if (!props.artistId) return;
    setSaving(true);
    try {
      const remote = getCurrentRemote();
      if (!remote) {
        toast.error("no remote selected");
        return;
      }
      const client = await getClientForRemote(remote);
      const resp = await client.music.updateArtistMetadata({
        artist_id: props.artistId,
        bio: bioDraft(),
        metadata_patch: null,
        force: force(),
        updated_by: null,
      });
      if (!resp.success) {
        toast.error(resp.error.message || "save failed");
        return;
      }
      if (resp.data?.skipped) {
        toast.info(resp.data.reason || "skipped (artist already enriched)");
        return;
      }
      toast.success("artist updated");
      void artistQuery.refetch();
      props.onSaved?.();
    } catch (err) {
      toast.error(`save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleIngestImage = async () => {
    const url = imageUrl().trim();
    if (!url || !props.artistId) return;
    setIngesting(true);
    try {
      const remote = getCurrentRemote();
      if (!remote) {
        toast.error("no remote selected");
        return;
      }
      const client = await getClientForRemote(remote);
      const resp = await client.music.ingestRemoteImage({
        remote_url: url,
        target: { kind: "artist", id: props.artistId } as any,
        is_primary: imageCount() === 0,
        source: "manual",
      });
      if (!resp.success) {
        toast.error(resp.error.message || "image ingest failed");
        return;
      }
      toast.success("image saved");
      setImageUrl("");
      void artistQuery.refetch();
      props.onSaved?.();
    } catch (err) {
      toast.error(`image ingest failed: ${(err as Error).message}`);
    } finally {
      setIngesting(false);
    }
  };

  return (
    <Show
      when={props.artistId}
      fallback={
        <div class="text-sm text-[var(--color-text-muted)] p-4">
          this album has no primary artist linked yet. assign one from the info tab first.
        </div>
      }
    >
      <div class="flex flex-col gap-4">
        {/* header */}
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
              {artistQuery.data?.name ?? props.artistName}
            </h3>
            <p class="text-xs text-[var(--color-text-muted)] mt-0.5">
              renames live in the artist detail view; this tab covers bio + images only
            </p>
          </div>
          <Show when={isComplete() && !force()}>
            <span
              class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border border-yellow-500/40 text-yellow-600"
              title="artist already has bio + image; toggle 'force' to overwrite"
            >
              already enriched
            </span>
          </Show>
        </div>

        {/* bio */}
        <div class="space-y-1.5">
          <label class="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            bio
          </label>
          <textarea
            class="w-full min-h-[140px] p-2 text-sm rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/40 font-mono"
            value={bioDraft()}
            onInput={(e) => setBioDraft(e.currentTarget.value)}
            placeholder="paste a bio from last.fm / theaudiodb / wikipedia, or write your own"
          />
        </div>

        {/* save row */}
        <div class="flex items-center gap-3">
          <Button variant="primary" disabled={saving() || !props.artistId} onClick={handleSaveBio}>
            {saving() ? "saving…" : "save bio"}
          </Button>
          <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={force()}
              onChange={(e) => setForce(e.currentTarget.checked)}
            />
            force (overwrite even if already enriched)
          </label>
        </div>

        {/* images */}
        <div class="space-y-2 mt-2">
          <label class="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            images ({imageCount()})
          </label>
          <Show
            when={imageCount() > 0}
            fallback={
              <div class="text-xs text-[var(--color-text-muted)] italic">
                no images linked to this artist
              </div>
            }
          >
            <ul class="flex flex-wrap gap-2">
              <For each={artistQuery.data?.images ?? []}>
                {(img) => {
                  const id = img.remote_blob_id ?? img.local_blob_id ?? "";
                  return (
                    <li
                      class="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]"
                      title={id}
                    >
                      <Show when={img.is_primary} fallback={<Icon name="image" size={12} />}>
                        <Icon name="star" size={12} />
                      </Show>
                      <span class="font-mono">{id.slice(0, 8)}</span>
                      <span class="text-[var(--color-text-muted)]">{img.blob_type}</span>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>

          {/* ingest URL */}
          <div class="flex items-center gap-2 mt-2">
            <input
              type="url"
              class="flex-1 px-2 py-1 text-xs rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-input)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]/40"
              value={imageUrl()}
              onInput={(e) => setImageUrl(e.currentTarget.value)}
              placeholder="https://… (artist image url; saves into the local library)"
              disabled={ingesting()}
            />
            <Button
              variant="ghost"
              disabled={ingesting() || !imageUrl().trim() || !props.artistId}
              onClick={handleIngestImage}
            >
              {ingesting() ? "saving…" : "save image"}
            </Button>
          </div>
        </div>

        {/* related artists (phase 13h) */}
        <div class="mt-2 pt-3 border-t border-[var(--color-border-subtle)]">
          <ArtistRelatedPanel artistId={props.artistId} />
        </div>
      </div>
    </Show>
  );
}
