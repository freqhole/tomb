// album taxons editor — deferred add/remove of non-genre taxon links on
// an album. used inside `AlbumEditorModal` and integrates with the
// modal's save/reset/dirty machinery via an imperative handle.
//
// design choices:
//   * link add/remove is buffered into `pendingAdds` / `pendingRemoves`
//     until the parent calls `apply()` from its save handler. this lets
//     the modal's "save changes" button stay enabled and the "reset"
//     button drop pending edits without ever hitting the server.
//   * taxon-kind and taxon creation are still immediate (they're
//     global resources, not album-scoped) — a freshly-created taxon is
//     queued as a pending add, not auto-linked.
//   * groups chips by kind with a header per kind; each kind has its
//     own `TaxonAutocomplete` (scoped to that kind for query + create).
//   * "genre" is intentionally excluded — the existing GenreAutocomplete
//     section above still owns that flow until the wider taxon refactor
//     replaces it.
//   * removes only the specific (taxon, origin) row so musicbrainz /
//     audiodb provenance for the same taxon is preserved.
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onMount,
  Show,
} from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { getRemoteClient } from "../../music/data";
import { queryKeys } from "../../music/queries/queryKeys";
import { TaxonAutocomplete } from "../forms/TaxonAutocomplete";
import { Icon, IconNames } from "../icons/registry";
import { toast } from "../feedback/Toast";
import type { TaxonRef } from "../../music/data/types";

interface KindOption {
  slug: string;
  label: string;
}

interface AlbumTaxonLink {
  album_id: string;
  taxon_id: string;
  kind_slug: string;
  label: string;
  origin: string;
  confidence?: number | null;
}

// unified shape used for chip rendering — server links and pending adds
// look the same on screen; the `pending` flag drives the styling tweak.
interface DisplayChip {
  taxon_id: string;
  kind_slug: string;
  label: string;
  origin: string;
  pending: "add" | null;
}

export interface AlbumTaxonsEditorHandle {
  apply: () => Promise<void>;
  reset: () => void;
  isDirty: () => boolean;
}

export interface AlbumTaxonsEditorProps {
  albumId: string;
  /** kinds to render. when omitted, queries `listTaxonKinds` and shows
   *  every kind except those in `excludeKinds`. */
  kinds?: KindOption[];
  /** kinds that should never be rendered (defaults to `["genre"]`). */
  excludeKinds?: string[];
  /** called once on mount with the imperative handle the parent can
   *  use to flush / reset pending edits and inspect dirty state. */
  ref?: (handle: AlbumTaxonsEditorHandle) => void;
  /** fires whenever the dirty state changes so the parent's save
   *  button can react. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function AlbumTaxonsEditor(props: AlbumTaxonsEditorProps) {
  const queryClient = useQueryClient();
  const excludeKinds = createMemo(() => new Set(props.excludeKinds ?? ["genre"]));

  // 1. resolve the kinds we want to render — explicit prop wins,
  //    otherwise pull the live list and filter excludeKinds out. note:
  //    the source MUST return a truthy value or solid will skip the
  //    fetcher entirely.
  const [kindsVersion, setKindsVersion] = createSignal(0);
  const [kindsResource] = createResource(
    () => ({ override: props.kinds, v: kindsVersion() }),
    async ({ override }) => {
      if (override) return override;
      const client = await getRemoteClient();
      if (!client) return [];
      const resp = await client.music.listTaxonKinds();
      if (!resp.success) return [];
      return (resp.data || [])
        .filter((k) => !excludeKinds().has(k.slug))
        .map<KindOption>((k) => ({ slug: k.slug, label: k.label }));
    }
  );

  // 2. fetch the album's current links. add/remove never mutates the
  //    server directly — only `apply()` does.
  const [linksVersion, setLinksVersion] = createSignal(0);
  const [linksResource, { refetch: refetchLinks }] = createResource(
    () => ({ id: props.albumId, v: linksVersion() }),
    async ({ id }) => {
      const client = await getRemoteClient();
      if (!client) return [] as AlbumTaxonLink[];
      const resp = await client.music.getAlbumTaxonLinks({ album_id: id });
      if (!resp.success) return [] as AlbumTaxonLink[];
      return resp.data as AlbumTaxonLink[];
    }
  );

  // 3. pending mutations buffered until apply()
  //    - pendingAdds: TaxonRefs the user picked / created but hasn't saved
  //    - pendingRemoves: server links the user clicked the X on
  const [pendingAdds, setPendingAdds] = createSignal<TaxonRef[]>([]);
  const [pendingRemoves, setPendingRemoves] = createSignal<Map<string, AlbumTaxonLink>>(new Map());

  const isDirty = () => pendingAdds().length > 0 || pendingRemoves().size > 0;

  // notify the parent whenever the dirty bit changes so its hasChanges
  // memo can include taxons in the save-button enable check.
  createEffect(
    on(
      () => isDirty(),
      (dirty) => props.onDirtyChange?.(dirty),
      { defer: true }
    )
  );

  // 4. derived display state — server links minus pendingRemoves, plus
  //    pendingAdds, grouped by kind.
  const chipsByKind = createMemo<Map<string, DisplayChip[]>>(() => {
    const map = new Map<string, DisplayChip[]>();
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

  // 5. local mutations — never touch the server
  const queueAdd = (kindSlug: string, taxon: TaxonRef) => {
    // un-undo: if this taxon was in pendingRemoves, just drop it from there
    const removes = pendingRemoves();
    if (removes.has(taxon.id)) {
      const next = new Map(removes);
      next.delete(taxon.id);
      setPendingRemoves(next);
      return;
    }
    // dedupe pending adds + skip if already linked on the server
    if (pendingAdds().some((p) => p.id === taxon.id)) return;
    if ((linksResource() || []).some((l) => l.taxon_id === taxon.id)) return;
    setPendingAdds((prev) => [...prev, { ...taxon, kind_slug: kindSlug }]);
  };

  const queueRemove = (chip: DisplayChip) => {
    if (chip.pending === "add") {
      // chip is a not-yet-saved add — just drop it
      setPendingAdds((prev) => prev.filter((p) => p.id !== chip.taxon_id));
      return;
    }
    // chip is a real server link — find it and stage a remove
    const link = (linksResource() || []).find(
      (l) => l.taxon_id === chip.taxon_id && l.origin === chip.origin
    );
    if (!link) return;
    const next = new Map(pendingRemoves());
    next.set(link.taxon_id, link);
    setPendingRemoves(next);
  };

  // 6. taxon + kind creation — these touch the server immediately because
  //    they're global resources. linking the new taxon is still deferred.
  const handleCreate = async (kindSlug: string, label: string) => {
    const client = await getRemoteClient();
    if (!client) {
      toast.error("not connected to a remote");
      return;
    }
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
      queueAdd(kindSlug, {
        id: resp.data.id,
        kind_slug: kindSlug,
        label: resp.data.label,
      });
    } catch (err) {
      console.error("failed to create taxon:", err);
      toast.error(`failed to create ${kindSlug} "${label}"`);
    }
  };

  // "+ new kind" inline form state. immediate (admin-only).
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
    const client = await getRemoteClient();
    if (!client) {
      toast.error("not connected to a remote");
      return;
    }
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
    if (!client) {
      throw new Error("not connected to a remote");
    }
    const removes = Array.from(pendingRemoves().values());
    const adds = pendingAdds();
    // removes first so a user can remove (origin=user) and re-add the
    // same taxon in one save without a unique-constraint clash.
    for (const link of removes) {
      await client.music.removeAlbumTaxon({
        album_id: props.albumId,
        taxon_id: link.taxon_id,
        origin: link.origin,
      });
    }
    for (const add of adds) {
      await client.music.addAlbumTaxon({
        album_id: props.albumId,
        taxon_id: add.id,
        origin: "user",
        confidence: null,
      });
    }
    setPendingAdds([]);
    setPendingRemoves(new Map());
    setLinksVersion((v) => v + 1);
    queryClient.invalidateQueries({ queryKey: queryKeys.albums.detail(props.albumId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
  };

  const reset = () => {
    setPendingAdds([]);
    setPendingRemoves(new Map());
    // also collapse any half-filled new-kind form so "reset" feels
    // like a clean slate even mid-edit.
    resetNewKindForm();
  };

  onMount(() => {
    props.ref?.({ apply, reset, isDirty });
  });

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-[var(--color-text-primary)]">taxons</label>
        <div class="flex items-center gap-2">
          <Show when={isDirty()}>
            <span class="text-[10px] uppercase tracking-wide text-[var(--color-accent-500)]">
              unsaved
            </span>
          </Show>
          <Show when={linksResource.loading || kindsResource.loading}>
            <div class="animate-spin w-3 h-3 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
          </Show>
        </div>
      </div>

      <Show
        when={(kindsResource() ?? []).length > 0}
        fallback={
          <p class="text-xs text-[var(--color-text-tertiary)]">
            no editable taxon kinds available.
          </p>
        }
      >
        <div class="space-y-3">
          <For each={kindsResource()}>
            {(kind) => {
              const chips = () => chipsByKind().get(kind.slug) ?? [];
              const excludeIds = () => chips().map((c) => c.taxon_id);
              return (
                <div class="space-y-1.5 p-2 rounded border border-[var(--color-border-subtle,var(--color-border-default))] bg-[var(--color-bg-secondary,var(--color-bg-primary))]/40">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      {kind.label || kind.slug}
                    </span>
                    <span class="text-[10px] text-[var(--color-text-tertiary)]">
                      {chips().length} linked
                    </span>
                  </div>

                  <Show when={chips().length > 0}>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={chips()}>
                        {(chip) => (
                          <span
                            class={
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs " +
                              (chip.pending === "add"
                                ? "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-600,var(--color-accent-500))] ring-1 ring-[var(--color-accent-500)]/30"
                                : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]")
                            }
                            title={`${chip.kind_slug}: ${chip.label}${chip.pending === "add" ? " (pending add)" : ` (origin: ${chip.origin})`}`}
                          >
                            <span>{chip.label}</span>
                            <Show when={chip.pending === null && chip.origin !== "user"}>
                              <span class="opacity-60 text-[10px]">{chip.origin}</span>
                            </Show>
                            <button
                              type="button"
                              onClick={() => queueRemove(chip)}
                              class="ml-0.5 hover:text-[var(--color-danger-text,var(--color-text-primary))] transition-colors"
                              aria-label={`remove ${chip.label}`}
                            >
                              <Icon name={IconNames.close} size={10} />
                            </button>
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>

                  <TaxonAutocomplete
                    kindSlug={kind.slug}
                    excludeIds={excludeIds()}
                    placeholder={`add ${kind.label || kind.slug}…`}
                    onSelect={(t) => queueAdd(kind.slug, t)}
                    onCreate={(label) => handleCreate(kind.slug, label)}
                  />
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* add-new-kind affordance: lets admins introduce new taxon kinds
          without leaving the album editor. immediate (admin-gated). */}
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
                setNewKindSlugDirty(true);
                setNewKindSlug(slugify(e.currentTarget.value));
              }}
              placeholder="slug"
              disabled={creatingKind()}
              class="w-32 px-2 py-1 text-xs font-mono bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
            />
            <button
              type="button"
              onClick={() => void handleCreateKind()}
              disabled={creatingKind() || !newKindLabel().trim()}
              class="px-2 py-1 text-xs rounded bg-[var(--color-accent-500)] text-white hover:bg-[var(--color-accent-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creatingKind() ? "creating…" : "create"}
            </button>
          </div>
          <p class="text-[10px] text-[var(--color-text-tertiary)]">
            slug is auto-generated from the label; edit it to override. requires admin role on this
            remote.
          </p>
        </div>
      </Show>

      <Show when={!linksResource.loading && !linksResource.error}>
        <div class="flex justify-end">
          <button
            type="button"
            onClick={() => {
              // drop any not-yet-saved adds/removes, then re-pull the
              // server-side links so the chips reflect ground truth.
              reset();
              void refetchLinks();
            }}
            class="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            {isDirty() ? "reset" : "refresh"}
          </button>
        </div>
      </Show>
    </div>
  );
}
