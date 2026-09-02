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
//
// falls back to the local `entity_taxons` indexeddb store (via
// `localTaxonomyClient`) when no remote is active - the local shim's
// `getEntityTaxonLinks` already returns kind_slug/label resolved, so
// the local path skips the taxonMetaCache resolution step entirely.

import { createMemo, createResource, createSignal, Show } from "solid-js";
import type { EntityTaxonLink } from "@freqhole/api-client";
import { getClientForRemote, type ApiClient } from "../../app/api/client";
import { getCurrentRemote } from "../../music/data/currentState";
import { localTaxonomyClient } from "../../music/services/local-api/localTaxonomyClient";
import type { TaxonomyClient } from "../../music/data";
import { toast } from "../feedback/Toast";
import { TaxonChipsGrid, type TaxonChipData, type TaxonKindOption } from "./TaxonChipsGrid";

// fully-resolved taxon link, common shape both the remote path (after
// resolving raw `EntityTaxonLink`s against `music.getTaxon`) and the
// local path (already resolved by the shim) produce.
interface ResolvedLink {
  taxon_id: string;
  kind_slug: string;
  label: string;
  origin: string;
}

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
  const isLocalMode = createMemo(() => !getCurrentRemote());

  const [clientResource] = createResource(
    () => getCurrentRemote(),
    async (remote) => (remote ? await getClientForRemote(remote) : null)
  );

  // taxonomy client for shared calls (`music.listTaxonKinds`/`createTaxon`)
  // that are shape-compatible whether the active source is a remote or
  // the local shim.
  const taxonomyClient = createMemo<TaxonomyClient | null>(
    () => clientResource() ?? (isLocalMode() ? localTaxonomyClient : null)
  );

  const [kindsResource] = createResource(
    () => ({ override: props.kinds, client: taxonomyClient() }),
    async ({ override, client }) => {
      if (override) return override.filter((k) => !excludeKinds().has(k.slug));
      if (!client) return [] as TaxonKindOption[];
      const resp = await client.music.listTaxonKinds({ domain: "video" });
      if (!resp.success) return [] as TaxonKindOption[];
      return (resp.data || [])
        .filter((k) => !excludeKinds().has(k.slug))
        .map<TaxonKindOption>((k) => ({ slug: k.slug, label: k.label }));
    }
  );

  // taxon_id -> resolved label/kind, persists for this editor's lifetime.
  // only needed for the remote path (local links already come resolved).
  const taxonMetaCache = new Map<string, { kind_slug: string; label: string }>();

  const [linksVersion, setLinksVersion] = createSignal(0);
  const [linksResource] = createResource(
    () => ({
      ids: props.videoIds.slice().sort().join(","),
      v: linksVersion(),
      client: clientResource(),
      local: isLocalMode(),
    }),
    async ({ client, local }) => {
      const out = new Map<string, ResolvedLink[]>();

      if (local) {
        const results = await Promise.allSettled(
          props.videoIds.map(async (video_id) => {
            const resp = await localTaxonomyClient.music.getEntityTaxonLinks({
              entity_type: "video",
              entity_id: video_id,
            });
            const links: ResolvedLink[] = resp.success
              ? resp.data.map((l) => ({
                  taxon_id: l.taxon_id,
                  kind_slug: l.kind_slug,
                  label: l.label,
                  origin: l.origin,
                }))
              : [];
            return { video_id, links };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") out.set(r.value.video_id, r.value.links);
        }
        return out;
      }

      if (!client) return out;
      const raw = new Map<string, EntityTaxonLink[]>();
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
        if (r.status === "fulfilled") raw.set(r.value.video_id, r.value.links);
      }

      const unresolved = new Set<string>();
      for (const links of raw.values()) {
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
      for (const [video_id, links] of raw) {
        const resolved: ResolvedLink[] = [];
        for (const link of links) {
          const meta = taxonMetaCache.get(link.taxon_id);
          if (!meta) continue;
          resolved.push({
            taxon_id: link.taxon_id,
            kind_slug: meta.kind_slug,
            label: meta.label,
            origin: link.origin,
          });
        }
        out.set(video_id, resolved);
      }
      return out;
    }
  );

  // union of taxons across all selected videos, grouped by kind, tagged
  // with a partial count when not every video has it.
  const chipsByKind = createMemo<Map<string, TaxonChipData[]>>(() => {
    const total = props.videoIds.length;
    const linksByVideo = linksResource() ?? new Map<string, ResolvedLink[]>();
    type Agg = { label: string; kind_slug: string; origin: string; count: number };
    const agg = new Map<string, Agg>();
    for (const videoId of props.videoIds) {
      const seen = new Set<string>();
      for (const link of linksByVideo.get(videoId) ?? []) {
        if (excludeKinds().has(link.kind_slug)) continue;
        const key = `${link.kind_slug}::${link.taxon_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cur = agg.get(key);
        if (cur) cur.count += 1;
        else
          agg.set(key, {
            label: link.label,
            kind_slug: link.kind_slug,
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
    remoteOp: (client: ApiClient, videoId: string) => Promise<unknown>,
    localOp: (videoId: string) => Promise<unknown>
  ) => {
    if (busy()) return;
    if (props.videoIds.length === 0) return;
    const local = isLocalMode();
    const client = clientResource();
    if (!local && !client) {
      toast.error("not connected to a remote");
      return;
    }
    setBusy(true);
    try {
      const op = local
        ? (id: string) => localOp(id)
        : (id: string) => remoteOp(client as ApiClient, id);
      const results = await Promise.allSettled(props.videoIds.map((id) => op(id)));
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
    await fanOut(
      `add ${taxon.label}`,
      (client, video_id) =>
        client.entities.addEntityTaxon({
          entity_type: "video",
          entity_id: video_id,
          taxon_id: taxon.id,
          origin: "user",
          confidence: null,
        }),
      (video_id) =>
        localTaxonomyClient.music.addEntityTaxon({
          entity_type: "video",
          entity_id: video_id,
          taxon_id: taxon.id,
          origin: "user",
          confidence: null,
        })
    );
  };

  const handleCreate = async (kindSlug: string, label: string) => {
    const local = isLocalMode();
    const client = clientResource();
    if (!local && !client) {
      toast.error("not connected to a remote");
      return;
    }
    setBusy(true);
    try {
      const createResp = local
        ? await localTaxonomyClient.music.createTaxon({
            kind_slug: kindSlug,
            label,
            description: null,
            parent_ids: null,
          })
        : await (client as ApiClient).music.createTaxon({
            kind_slug: kindSlug,
            label,
            description: null,
            parent_ids: null,
          });
      if (!createResp.success) {
        toast.error(`failed to create ${kindSlug} "${label}"`);
        return;
      }
      const taxonId = createResp.data.id;
      const results = await Promise.allSettled(
        props.videoIds.map((video_id) =>
          local
            ? localTaxonomyClient.music.addEntityTaxon({
                entity_type: "video",
                entity_id: video_id,
                taxon_id: taxonId,
                origin: "user",
                confidence: null,
              })
            : (client as ApiClient).entities.addEntityTaxon({
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
    await fanOut(
      `remove ${chip.label}`,
      (client, video_id) =>
        client.entities.removeEntityTaxon({
          entity_type: "video",
          entity_id: video_id,
          taxon_id: chip.taxon_id,
          origin: chip.origin,
        }),
      (video_id) =>
        localTaxonomyClient.music.removeEntityTaxon({
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
        when={isLocalMode() || clientResource()}
        fallback={
          <p class="text-xs text-[var(--color-text-tertiary)]">
            connect to a remote to edit taxons.
          </p>
        }
      >
        <TaxonChipsGrid
          kinds={kindsResource() ?? []}
          chipsByKind={chipsByKind()}
          apiClient={taxonomyClient()}
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
