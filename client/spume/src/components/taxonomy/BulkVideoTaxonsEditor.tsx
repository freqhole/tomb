// bulk video taxons editor - adapted from BulkAlbumTaxonsEditor.tsx for
// the generic entity_taxonz table (entity_type "video"). applies adds/
// removes immediately across every video in `videoIds` - no buffered
// save step, matching the album version's behavior.
//
// the generic `entities.getEntityTaxons` route only returns taxon_ids
// (no label/kind_slug - those are per-domain concepts on the album
// route, not on the generic entity_taxonz table), so labels/kinds are
// resolved separately via `music.getTaxon`, cached for this editor's
// lifetime to avoid re-resolving the same taxon on every video.

import { createMemo, createResource, createSignal, Show } from "solid-js";
import type { EntityTaxonLink } from "@freqhole/api-client";
import { getClientForRemote, type ApiClient } from "../../app/api/client";
import { getCurrentRemote } from "../../music/data/currentState";
import { toast } from "../feedback/Toast";
import { TaxonChipsGrid, type TaxonChipData, type TaxonKindOption } from "./TaxonChipsGrid";

export interface BulkVideoTaxonsEditorProps {
  /** video ids to apply changes to. */
  videoIds: string[];
  /** kinds to render. caller usually shares a single fetch across
   *  panels; when omitted we fetch on mount. */
  kinds?: TaxonKindOption[];
  /** invoked after any successful add/remove/create so the parent can
   *  refresh other views. */
  onAfterMutate?: () => void | Promise<void>;
  /** filtered out of the rendered kinds. */
  excludeKinds?: string[];
}

export function BulkVideoTaxonsEditor(props: BulkVideoTaxonsEditorProps) {
  const excludeKinds = createMemo(() => new Set(props.excludeKinds ?? []));

  const [clientResource] = createResource(
    () => getCurrentRemote(),
    async (remote) => (remote ? await getClientForRemote(remote) : null)
  );

  const [kindsResource] = createResource(
    () => ({ override: props.kinds, client: clientResource() }),
    async ({ override, client }) => {
      if (override) return override.filter((k) => !excludeKinds().has(k.slug));
      if (!client) return [] as TaxonKindOption[];
      const resp = await client.music.listTaxonKinds();
      if (!resp.success) return [] as TaxonKindOption[];
      return (resp.data || [])
        .filter((k) => !excludeKinds().has(k.slug))
        .map<TaxonKindOption>((k) => ({ slug: k.slug, label: k.label }));
    }
  );

  // taxon_id -> resolved label/kind, persists for this editor's lifetime.
  const taxonMetaCache = new Map<string, { kind_slug: string; label: string }>();

  const [linksVersion, setLinksVersion] = createSignal(0);
  const [linksResource] = createResource(
    () => ({
      ids: props.videoIds.slice().sort().join(","),
      v: linksVersion(),
      client: clientResource(),
    }),
    async ({ client }) => {
      const out = new Map<string, EntityTaxonLink[]>();
      if (!client) return out;
      const results = await Promise.allSettled(
        props.videoIds.map(async (video_id) => {
          const resp = await client.entities.getEntityTaxons({
            entity_type: "video",
            entity_id: video_id,
          });
          return { video_id, links: resp.success ? resp.data : [] };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") out.set(r.value.video_id, r.value.links);
      }

      const unresolved = new Set<string>();
      for (const links of out.values()) {
        for (const link of links) {
          if (!taxonMetaCache.has(link.taxon_id)) unresolved.add(link.taxon_id);
        }
      }
      if (unresolved.size > 0) {
        await Promise.allSettled(
          Array.from(unresolved).map(async (taxonId) => {
            const resp = await client.music.getTaxon({ id: taxonId });
            if (resp.success) {
              taxonMetaCache.set(taxonId, {
                kind_slug: resp.data.kind_slug,
                label: resp.data.label,
              });
            }
          })
        );
      }
      return out;
    }
  );

  // union of taxons across all selected videos, grouped by kind, tagged
  // with a partial count when not every video has it.
  const chipsByKind = createMemo<Map<string, TaxonChipData[]>>(() => {
    const total = props.videoIds.length;
    const linksByVideo = linksResource() ?? new Map<string, EntityTaxonLink[]>();
    type Agg = { label: string; kind_slug: string; origin: string; count: number };
    const agg = new Map<string, Agg>();
    for (const videoId of props.videoIds) {
      const seen = new Set<string>();
      for (const link of linksByVideo.get(videoId) ?? []) {
        const meta = taxonMetaCache.get(link.taxon_id);
        if (!meta) continue;
        if (excludeKinds().has(meta.kind_slug)) continue;
        const key = `${meta.kind_slug}::${link.taxon_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cur = agg.get(key);
        if (cur) cur.count += 1;
        else
          agg.set(key, {
            label: meta.label,
            kind_slug: meta.kind_slug,
            origin: link.origin,
            count: 1,
          });
      }
    }
    const out = new Map<string, TaxonChipData[]>();
    for (const [key, v] of agg) {
      const taxon_id = key.slice(v.kind_slug.length + 2);
      const arr = out.get(v.kind_slug) ?? [];
      arr.push({
        taxon_id,
        kind_slug: v.kind_slug,
        label: v.label,
        origin: v.origin,
        pending: null,
        partial: v.count < total ? { count: v.count, total } : undefined,
      });
      out.set(v.kind_slug, arr);
    }
    for (const arr of out.values()) arr.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  });

  const [busy, setBusy] = createSignal(false);

  const refresh = async () => {
    setLinksVersion((v) => v + 1);
    await props.onAfterMutate?.();
  };

  const fanOut = async (
    label: string,
    op: (client: ApiClient, videoId: string) => Promise<unknown>
  ) => {
    if (busy()) return;
    const client = clientResource();
    if (!client) {
      toast.error("not connected to a remote");
      return;
    }
    if (props.videoIds.length === 0) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(props.videoIds.map((id) => op(client, id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.warning(`${label}: ${results.length - failed}/${results.length} ok`);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (kindSlug: string, taxon: { id: string; label: string }) => {
    void kindSlug;
    await fanOut(`add ${taxon.label}`, (client, video_id) =>
      client.entities.addEntityTaxon({
        entity_type: "video",
        entity_id: video_id,
        taxon_id: taxon.id,
        origin: "user",
        confidence: null,
      })
    );
  };

  const handleCreate = async (kindSlug: string, label: string) => {
    const client = clientResource();
    if (!client) {
      toast.error("not connected to a remote");
      return;
    }
    setBusy(true);
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
      const taxonId = resp.data.id;
      const results = await Promise.allSettled(
        props.videoIds.map((video_id) =>
          client.entities.addEntityTaxon({
            entity_type: "video",
            entity_id: video_id,
            taxon_id: taxonId,
            origin: "user",
            confidence: null,
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.warning(`add ${label}: ${results.length - failed}/${results.length} ok`);
      }
      await refresh();
    } catch (err) {
      console.warn("[bulk-video-taxons] create + add failed", err);
      toast.error(`failed to create ${kindSlug} "${label}"`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (chip: TaxonChipData) => {
    await fanOut(`remove ${chip.label}`, (client, video_id) =>
      client.entities.removeEntityTaxon({
        entity_type: "video",
        entity_id: video_id,
        taxon_id: chip.taxon_id,
        origin: chip.origin,
      })
    );
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-wide text-white/45">
          taxons · {props.videoIds.length} video{props.videoIds.length === 1 ? "" : "s"}
        </span>
        <Show when={linksResource.loading || kindsResource.loading || busy()}>
          <div class="animate-spin w-3 h-3 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
        </Show>
      </div>
      <Show
        when={clientResource()}
        fallback={
          <p class="text-xs text-[var(--color-text-tertiary)]">
            connect to a remote to edit taxons.
          </p>
        }
      >
        <TaxonChipsGrid
          kinds={kindsResource() ?? []}
          chipsByKind={chipsByKind()}
          apiClient={clientResource() ?? null}
          onAdd={(slug, t) => void handleAdd(slug, t)}
          onCreate={(slug, label) => void handleCreate(slug, label)}
          onRemoveChip={(chip) => void handleRemove(chip)}
          disabled={busy()}
          countSuffix="on"
        />
      </Show>
    </div>
  );
}
