// video taxons editor — deferred add/remove of taxon links on a video.
// used inside `EditVideoModal` and integrates with the modal's
// save/reset/dirty machinery via an imperative handle.
//
// unlike `AlbumTaxonsEditor`, video taxon links go through the generic
// `entities.getEntityTaxons`/`addEntityTaxon`/`removeEntityTaxon` routes
// (entity_taxonz table, entity_type-agnostic) instead of album-specific
// routes when a remote is active; when no remote is active, this falls
// back to the local `entity_taxons` indexeddb store via
// `localTaxonomyClient.music.{getEntityTaxonLinks,addEntityTaxon,
// removeEntityTaxon}` (mirrors how `AlbumTaxonsEditor` already works
// uniformly across local/remote).
//
// link add/remove is buffered into `pendingAdds`/`pendingRemoves` until
// the parent calls `apply()` from its save handler, so the modal's save
// button stays enabled and reset drops pending edits without touching
// the server. supports excluding kinds via `excludeKinds`, mirroring
// `AlbumTaxonsEditor`'s prop of the same name/shape.
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onMount,
  Show,
} from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { getRemoteClient, getTaxonomyClient } from "../../music/data";
import { localTaxonomyClient } from "../../music/services/local-api/localTaxonomyClient";
import { videoQueryKeys } from "../../video/queries/queryKeys";
import {
  TaxonChipsGrid,
  type TaxonChipData,
  type TaxonKindOption,
} from "../taxonomy/TaxonChipsGrid";
import { Icon, IconNames } from "../icons/registry";
import { toast } from "../feedback/Toast";
import type { TaxonRef } from "../../music/data/types";

interface VideoTaxonLink {
  taxon_id: string;
  kind_slug: string;
  label: string;
  origin: string;
}

export interface VideoTaxonsEditorHandle {
  apply: () => Promise<void>;
  reset: () => void;
  isDirty: () => boolean;
}

export interface VideoTaxonsEditorProps {
  videoId: string;
  /** kind slugs to never render/edit (e.g. music-only kinds like
   *  "genre"/"mood"/"style"/"era"/"label"). defaults to none. */
  excludeKinds?: string[];
  /** called once on mount with the imperative handle the parent can
   *  use to flush / reset pending edits and inspect dirty state. */
  ref?: (handle: VideoTaxonsEditorHandle) => void;
  /** fires whenever the dirty state changes so the parent's save
   *  button can react. */
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
}

export function VideoTaxonsEditor(props: VideoTaxonsEditorProps) {
  const queryClient = useQueryClient();
  const excludeKinds = createMemo(() => new Set(props.excludeKinds ?? []));

  // 1. taxon kinds — same source as the album editor (kind definitions
  //    aren't entity-scoped), works whether the active source is a
  //    remote or the local library.
  const [kindsVersion, setKindsVersion] = createSignal(0);
  const [kindsResource] = createResource(kindsVersion, async () => {
    const client = await getTaxonomyClient();
    const resp = await client.music.listTaxonKinds({ domain: "video" });
    if (!resp.success) return [];
    return (resp.data || [])
      .filter((k) => !excludeKinds().has(k.slug))
      .map<TaxonKindOption>((k) => ({ slug: k.slug, label: k.label }));
  });

  // 2. current links for this video, resolved to kind_slug/label since
  //    `getEntityTaxons` only returns raw (taxon_id, origin) rows. falls
  //    back to the local `entity_taxons` store when no remote is active.
  const [linksVersion, setLinksVersion] = createSignal(0);
  const [linksResource] = createResource(
    () => ({ id: props.videoId, v: linksVersion() }),
    async ({ id }) => {
      const client = await getRemoteClient();
      if (!client) {
        const localResult = await localTaxonomyClient.music.getEntityTaxonLinks({
          entity_type: "video",
          entity_id: id,
        });
        if (!localResult.success) return [] as VideoTaxonLink[];
        return localResult.data.map((l) => ({
          taxon_id: l.taxon_id,
          kind_slug: l.kind_slug,
          label: l.label,
          origin: l.origin,
        }));
      }
      const linksResult = await client.entities.getEntityTaxons({
        entity_type: "video",
        entity_id: id,
      });
      if (!linksResult.success) return [] as VideoTaxonLink[];

      const taxonIds = [...new Set(linksResult.data.map((l) => l.taxon_id))];
      const taxons = await Promise.all(
        taxonIds.map((taxonId) => client.music.getTaxon({ id: taxonId }))
      );
      const byId = new Map(taxons.filter((r) => r.success).map((r) => [r.data.id, r.data]));

      return linksResult.data
        .map((l) => {
          const taxon = byId.get(l.taxon_id);
          if (!taxon) return null;
          return {
            taxon_id: l.taxon_id,
            kind_slug: taxon.kind_slug,
            label: taxon.label,
            origin: l.origin,
          };
        })
        .filter((l): l is VideoTaxonLink => l !== null);
    }
  );

  // 3. pending mutations buffered until apply()
  const [pendingAdds, setPendingAdds] = createSignal<TaxonRef[]>([]);
  const [pendingRemoves, setPendingRemoves] = createSignal<Map<string, VideoTaxonLink>>(new Map());

  const isDirty = () => pendingAdds().length > 0 || pendingRemoves().size > 0;

  createEffect(
    on(
      () => isDirty(),
      (dirty) => props.onDirtyChange?.(dirty),
      { defer: true }
    )
  );

  // 4. derived display state — server links minus pendingRemoves, plus
  //    pendingAdds, grouped by kind.
  const chipsByKind = createMemo<Map<string, TaxonChipData[]>>(() => {
    const map = new Map<string, TaxonChipData[]>();
    const removeIds = pendingRemoves();
    for (const link of linksResource() || []) {
      if (excludeKinds().has(link.kind_slug)) continue;
      if (removeIds.has(link.taxon_id)) continue;
      const arr = map.get(link.kind_slug) ?? [];
      arr.push({
        taxon_id: link.taxon_id,
        kind_slug: link.kind_slug,
        label: link.label,
        origin: link.origin,
        pending: null,
      });
      map.set(link.kind_slug, arr);
    }
    for (const add of pendingAdds()) {
      if (excludeKinds().has(add.kind_slug)) continue;
      const arr = map.get(add.kind_slug) ?? [];
      arr.push({
        taxon_id: add.id,
        kind_slug: add.kind_slug,
        label: add.label,
        origin: "user",
        pending: "add",
      });
      map.set(add.kind_slug, arr);
    }
    return map;
  });

  // 5. local mutations — buffered, applied on apply()
  const queueAdd = (kindSlug: string, taxon: TaxonRef) => {
    const removes = pendingRemoves();
    if (removes.has(taxon.id)) {
      const next = new Map(removes);
      next.delete(taxon.id);
      setPendingRemoves(next);
    }
    if (pendingAdds().some((p) => p.id === taxon.id)) return;
    if ((linksResource() || []).some((l) => l.taxon_id === taxon.id)) return;
    setPendingAdds((prev) => [...prev, { ...taxon, kind_slug: kindSlug }]);
  };

  const queueRemove = (chip: TaxonChipData) => {
    if (chip.pending === "add") {
      setPendingAdds((prev) => prev.filter((p) => p.id !== chip.taxon_id));
      return;
    }
    const link = (linksResource() || []).find(
      (l) => l.taxon_id === chip.taxon_id && l.origin === chip.origin
    );
    if (!link) return;
    const next = new Map(pendingRemoves());
    next.set(link.taxon_id, link);
    setPendingRemoves(next);
  };

  // 6. taxon + kind creation — global resources, created immediately;
  //    linking a freshly-created taxon is still deferred.
  const handleCreate = async (kindSlug: string, label: string) => {
    const client = await getTaxonomyClient();
    try {
      const resp = await client.music.createTaxon({
        kind_slug: kindSlug,
        label,
        description: null,
        parent_ids: null,
      });
      if (!resp.success) {
        toast.error(`failed to create ${kindSlug} "${label}"`);
        return;
      }
      queueAdd(kindSlug, { id: resp.data.id, kind_slug: kindSlug, label: resp.data.label });
    } catch (err) {
      console.error("failed to create taxon:", err);
      toast.error(`failed to create ${kindSlug} "${label}"`);
    }
  };

  const [showNewKindForm, setShowNewKindForm] = createSignal(false);
  const [newKindLabel, setNewKindLabel] = createSignal("");
  const [newKindSlug, setNewKindSlug] = createSignal("");
  const [newKindSlugDirty, setNewKindSlugDirty] = createSignal(false);
  const [creatingKind, setCreatingKind] = createSignal(false);

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

  const resetNewKindForm = () => {
    setShowNewKindForm(false);
    setNewKindLabel("");
    setNewKindSlug("");
    setNewKindSlugDirty(false);
  };

  const handleCreateKind = async () => {
    const label = newKindLabel().trim();
    const slug = (newKindSlugDirty() ? newKindSlug() : slugify(label)).trim();
    if (!label || !slug) {
      toast.error("label and slug are required");
      return;
    }
    const client = await getTaxonomyClient();
    setCreatingKind(true);
    try {
      const resp = await client.music.createTaxonKind({
        slug,
        label,
        description: null,
        color: null,
        value_type: null,
        unit: null,
        display_order: null,
        domain: "video",
      });
      if (!resp.success) {
        toast.error(`failed to create kind "${slug}"`);
        return;
      }
      resetNewKindForm();
      setKindsVersion((v) => v + 1);
    } catch (err) {
      console.error("failed to create taxon kind:", err);
      toast.error(`failed to create kind "${slug}"`);
    } finally {
      setCreatingKind(false);
    }
  };

  // 7. imperative handle exposed to the parent modal
  const apply = async () => {
    if (!isDirty()) return;
    const client = await getRemoteClient();
    const removes = Array.from(pendingRemoves().values());
    const adds = pendingAdds();

    if (!client) {
      for (const link of removes) {
        await localTaxonomyClient.music.removeEntityTaxon({
          entity_type: "video",
          entity_id: props.videoId,
          taxon_id: link.taxon_id,
          origin: link.origin,
        });
      }
      for (const add of adds) {
        await localTaxonomyClient.music.addEntityTaxon({
          entity_type: "video",
          entity_id: props.videoId,
          taxon_id: add.id,
          origin: "user",
          confidence: null,
        });
      }
      setPendingAdds([]);
      setPendingRemoves(new Map());
      setLinksVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.taxons(props.videoId) });
      return;
    }

    for (const link of removes) {
      await client.entities.removeEntityTaxon({
        entity_type: "video",
        entity_id: props.videoId,
        taxon_id: link.taxon_id,
        origin: link.origin,
      });
    }
    for (const add of adds) {
      await client.entities.addEntityTaxon({
        entity_type: "video",
        entity_id: props.videoId,
        taxon_id: add.id,
        origin: "user",
        confidence: null,
      });
    }
    setPendingAdds([]);
    setPendingRemoves(new Map());
    setLinksVersion((v) => v + 1);
    queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.taxons(props.videoId) });
  };

  const reset = () => {
    setPendingAdds([]);
    setPendingRemoves(new Map());
    resetNewKindForm();
  };

  onMount(() => {
    props.ref?.({ apply, reset, isDirty });
  });

  // note: taxon editing is now available locally too (falls back to
  // the local `entity_taxons` store), so `hasRemote` no longer gates
  // the editor's `disabled` state - it's only used for the informational
  // hint text below.

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-[var(--color-text-primary)]">taxons</label>
        <Show when={linksResource.loading || kindsResource.loading}>
          <div class="animate-spin w-3 h-3 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
        </Show>
      </div>

      <Show
        when={(kindsResource() ?? []).length > 0}
        fallback={
          <p class="text-xs text-[var(--color-text-tertiary)]">
            no editable taxon kinds available.
          </p>
        }
      >
        <TaxonChipsGrid
          kinds={kindsResource() ?? []}
          chipsByKind={chipsByKind()}
          disabled={props.disabled}
          onAdd={(kindSlug, t) => queueAdd(kindSlug, t)}
          onCreate={(kindSlug, label) => void handleCreate(kindSlug, label)}
          onRemoveChip={(chip) => queueRemove(chip)}
        />
      </Show>

      <Show when={!props.disabled}>
        <Show
          when={showNewKindForm()}
          fallback={
            <button
              type="button"
              onClick={() => setShowNewKindForm(true)}
              class="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <Icon name={IconNames.add} size={12} />
              new kind
            </button>
          }
        >
          <div class="space-y-1.5 p-2 rounded border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-secondary,var(--color-bg-primary))]/40">
            <div class="flex items-center justify-between">
              <span class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                new taxon kind
              </span>
              <button
                type="button"
                onClick={resetNewKindForm}
                class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                aria-label="cancel"
              >
                <Icon name={IconNames.close} size={12} />
              </button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <input
                type="text"
                value={newKindLabel()}
                onInput={(e) => {
                  const v = e.currentTarget.value;
                  setNewKindLabel(v);
                  if (!newKindSlugDirty()) setNewKindSlug(slugify(v));
                }}
                placeholder="label (e.g. tempo, region)"
                disabled={creatingKind()}
                class="flex-1 min-w-[140px] px-2 py-1 text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
              />
              <input
                type="text"
                value={newKindSlug()}
                onInput={(e) => {
                  setNewKindSlug(e.currentTarget.value);
                  setNewKindSlugDirty(true);
                }}
                placeholder="slug"
                disabled={creatingKind()}
                class="w-28 px-2 py-1 text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
              />
              <button
                type="button"
                onClick={() => void handleCreateKind()}
                disabled={creatingKind()}
                class="px-2 py-1 text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-50"
              >
                {creatingKind() ? "creating..." : "create"}
              </button>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}

export default VideoTaxonsEditor;
