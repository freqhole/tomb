// bulk album taxons editor — inline editor for the graph's edit panel.
// applies adds/removes immediately across every album in `albumIds`
// (the caller resolves artist-fan-out to album sets). chips are the
// union of taxons across selected albums; chips that don't cover all
// albums render with a partial count.
//
// distinct from `AlbumTaxonsEditor` (modal) which buffers edits until
// a save button is pressed. both share the same presentational grid
// (`TaxonChipsGrid`) so the look matches.

import { createMemo, createResource, createSignal, Show } from "solid-js";
import { getClientForRemote, type ApiClient } from "../../app/api/client";
import { toast } from "../feedback/Toast";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { TaxonChipsGrid, type TaxonChipData, type TaxonKindOption } from "./TaxonChipsGrid";

interface AlbumTaxonLink {
  album_id: string;
  taxon_id: string;
  kind_slug: string;
  label: string;
  origin: string;
}

export interface BulkAlbumTaxonsEditorProps {
  remote: Remote;
  /** album ids to apply changes to. artist fan-out happens at the
   *  caller — this component just iterates them. */
  albumIds: string[];
  /** kinds to render. caller usually shares a single fetch across
   *  panels; when omitted we fetch on mount. */
  kinds?: TaxonKindOption[];
  /** invoked after any successful add/remove/create so the parent can
   *  refresh hub counts, kick the walker, etc. */
  onAfterMutate?: () => void | Promise<void>;
  /** filtered out of the rendered kinds. */
  excludeKinds?: string[];
}

export function BulkAlbumTaxonsEditor(props: BulkAlbumTaxonsEditorProps) {
  const excludeKinds = createMemo(() => new Set(props.excludeKinds ?? []));

  const [clientResource] = createResource(
    () => props.remote,
    (remote) => getClientForRemote(remote)
  );

  const [kindsVersion, setKindsVersion] = createSignal(0);
  const [kindsResource] = createResource(
    () => ({ override: props.kinds, v: kindsVersion(), client: clientResource() }),
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

  const [linksVersion, setLinksVersion] = createSignal(0);
  const [linksResource] = createResource(
    () => ({
      ids: props.albumIds.slice().sort().join(","),
      v: linksVersion(),
      client: clientResource(),
    }),
    async ({ client }) => {
      if (!client) return new Map<string, AlbumTaxonLink[]>();
      const out = new Map<string, AlbumTaxonLink[]>();
      const results = await Promise.allSettled(
        props.albumIds.map(async (album_id) => {
          const resp = await client.music.getAlbumTaxonLinks({ album_id });
          return {
            album_id,
            links: resp.success ? (resp.data as AlbumTaxonLink[]) : ([] as AlbumTaxonLink[]),
          };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled") out.set(r.value.album_id, r.value.links);
      }
      return out;
    }
  );

  // union of taxons across all selected albums, grouped by kind,
  // tagged with a `partial` count when not every album has it.
  const chipsByKind = createMemo<Map<string, TaxonChipData[]>>(() => {
    const total = props.albumIds.length;
    const linksByAlbum = linksResource() ?? new Map<string, AlbumTaxonLink[]>();
    // (taxon_id, kind_slug) -> { label, origin, count }
    type Agg = { label: string; origin: string; kind_slug: string; count: number };
    const agg = new Map<string, Agg>();
    for (const albumId of props.albumIds) {
      const seen = new Set<string>();
      for (const link of linksByAlbum.get(albumId) ?? []) {
        if (excludeKinds().has(link.kind_slug)) continue;
        const key = `${link.kind_slug}::${link.taxon_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cur = agg.get(key);
        if (cur) cur.count += 1;
        else
          agg.set(key, {
            label: link.label,
            origin: link.origin,
            kind_slug: link.kind_slug,
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

  // ---- mutations: immediate fan-out across props.albumIds ---------------

  const [busy, setBusy] = createSignal(false);

  const refresh = async () => {
    setLinksVersion((v) => v + 1);
    await props.onAfterMutate?.();
  };

  const fanOut = async (
    label: string,
    op: (client: ApiClient, albumId: string) => Promise<unknown>
  ) => {
    if (busy()) return;
    const client = clientResource();
    if (!client) {
      toast.error("not connected to remote");
      return;
    }
    if (props.albumIds.length === 0) return;
    setBusy(true);
    try {
      const results = await Promise.allSettled(props.albumIds.map((id) => op(client, id)));
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
    await fanOut(`add ${taxon.label}`, (client, album_id) =>
      client.music.addAlbumTaxon({
        album_id,
        taxon_id: taxon.id,
        origin: "user",
        confidence: null,
      })
    );
  };

  const handleCreate = async (kindSlug: string, label: string) => {
    const client = clientResource();
    if (!client) {
      toast.error("not connected to remote");
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
        props.albumIds.map((album_id) =>
          client.music.addAlbumTaxon({
            album_id,
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
      console.warn("[bulk-taxons] create + add failed", err);
      toast.error(`failed to create ${kindSlug} "${label}"`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (chip: TaxonChipData) => {
    await fanOut(`remove ${chip.label}`, (client, album_id) =>
      client.music.removeAlbumTaxon({
        album_id,
        taxon_id: chip.taxon_id,
        origin: null,
      })
    );
  };

  void setKindsVersion;

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-wide text-white/45">
          taxons · {props.albumIds.length} album{props.albumIds.length === 1 ? "" : "s"}
        </span>
        <Show when={linksResource.loading || kindsResource.loading || busy()}>
          <div class="animate-spin w-3 h-3 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
        </Show>
      </div>
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
    </div>
  );
}
