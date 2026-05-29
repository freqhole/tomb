// per-source single-album taxon apply panel.
//
// counterpart to BulkEnrichmentReviewModal's taxon section, scoped to a
// single album and filtered to one enrichment source (last.fm or
// theaudiodb). renders the same `TaxonReviewPanel` chip grid so the
// look + feel matches the bulk flow, then exposes a single "apply
// selected" button that calls `applyTaxonProposals` with the picks
// attributed to this tab's source.
//
// the taxon proposals come from `/api/albums/propose-taxons`, which
// returns merged proposals across all sources. we filter client-side
// so the panel only surfaces things actually contributed by this tab's
// source — useful so an audiodb tab doesn't show last.fm-only tags.

import { createMemo, createResource, createSignal, Show } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { toast } from "../feedback/Toast";
import { Button } from "../buttons/Button";
import {
  TaxonReviewPanel,
  proposalKey,
  type TaxonProposalLike,
} from "../../library/review/TaxonReviewPanel";

export type SingleAlbumTaxonSource = "lastfm" | "audiodb";

interface SingleAlbumTaxonApplyPanelProps {
  albumId: string;
  remote: Remote | undefined;
  source: SingleAlbumTaxonSource;
  isAdmin: boolean;
  /** called after a successful apply so the parent can refetch the
   *  album record / songs / taxons. */
  onApplied?: () => void;
}

export function SingleAlbumTaxonApplyPanel(props: SingleAlbumTaxonApplyPanelProps) {
  const [reloadKey, setReloadKey] = createSignal(0);
  const proposalsKey = createMemo<[string, string, number] | null>(() => {
    const r = props.remote;
    if (!r) return null;
    return [r.remote_id, props.albumId, reloadKey()];
  });

  const [proposals, { refetch }] = createResource(proposalsKey, async (k) => {
    if (!k) return [] as TaxonProposalLike[];
    try {
      const client = await getClientForRemote(props.remote!);
      const resp = await client.music.proposeTaxons({ album_id: props.albumId });
      if (!resp.success || !resp.data) return [] as TaxonProposalLike[];
      return (resp.data as TaxonProposalLike[]) ?? [];
    } catch (err) {
      toast.error(`failed to load proposals: ${(err as Error).message}`);
      return [] as TaxonProposalLike[];
    }
  });

  // only surface proposals that this source actually contributed to.
  const sourceProposals = createMemo<TaxonProposalLike[]>(() => {
    const all = proposals() ?? [];
    return all.filter((p) => p.sources.includes(props.source));
  });

  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [applying, setApplying] = createSignal(false);

  const toggleProposal = (p: TaxonProposalLike) => {
    if (p.already_linked) return;
    const next = new Set<string>(selected());
    const k = proposalKey(p);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };

  const selectAllFromSource = (_src: string) => {
    // single-source view: just select every un-linked visible proposal.
    const next = new Set<string>(selected());
    for (const p of sourceProposals()) {
      if (!p.already_linked) next.add(proposalKey(p));
    }
    setSelected(next);
  };

  const clearAllUnlinked = () => setSelected(new Set<string>());

  const applySelected = async () => {
    if (applying() || !props.remote) return;
    const sel = selected();
    if (sel.size === 0) {
      toast.error("nothing selected");
      return;
    }
    const accepted = sourceProposals()
      .filter((p) => !p.already_linked && sel.has(proposalKey(p)))
      .map((p) => ({
        kind_slug: p.kind_slug,
        label: p.label,
        source: props.source,
      }));
    if (accepted.length === 0) {
      toast.error("nothing to apply");
      return;
    }
    setApplying(true);
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.applyTaxonProposals({
        album_id: props.albumId,
        accepted,
      });
      if (!resp.success) {
        toast.error(resp.error.message || "failed to apply proposals");
        return;
      }
      const r = resp.data;
      toast.success(
        `applied ${r?.linked ?? accepted.length} taxon${(r?.linked ?? 0) === 1 ? "" : "s"}`
      );
      setSelected(new Set<string>());
      setReloadKey((k) => k + 1);
      props.onApplied?.();
    } catch (err) {
      toast.error(`apply failed: ${(err as Error).message}`);
    } finally {
      setApplying(false);
    }
  };

  const unlinkedCount = createMemo(() => sourceProposals().filter((p) => !p.already_linked).length);

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
          taxon proposals from {props.source === "lastfm" ? "last.fm" : "theaudiodb"}
        </div>
        <button
          type="button"
          class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] underline-offset-2 hover:underline"
          onClick={() => refetch()}
          disabled={proposals.loading}
        >
          {proposals.loading ? "loading…" : "reload"}
        </button>
      </div>

      <Show
        when={!proposals.loading}
        fallback={
          <div class="text-xs text-[var(--color-text-tertiary)] italic">loading proposals…</div>
        }
      >
        <Show
          when={sourceProposals().length > 0}
          fallback={
            <div class="text-xs text-[var(--color-text-tertiary)] italic">
              no proposals from this source yet. refetch the snapshot above to populate this list.
            </div>
          }
        >
          <TaxonReviewPanel
            proposals={sourceProposals()}
            selected={selected()}
            onToggle={toggleProposal}
            onSelectAllFromSource={selectAllFromSource}
            onClearAllUnlinked={clearAllUnlinked}
          />
          <div class="flex items-center justify-end gap-2 pt-1">
            <span class="text-xs text-[var(--color-text-tertiary)] mr-auto">
              {selected().size} of {unlinkedCount()} selected
            </span>
            <Button
              variant="primary"
              onClick={applySelected}
              disabled={applying() || !props.isAdmin || selected().size === 0}
            >
              {applying() ? "applying…" : "apply selected"}
            </Button>
          </div>
        </Show>
      </Show>
      <Show when={!props.isAdmin}>
        <div class="text-xs text-[var(--color-text-tertiary)]">
          admin permission required to apply changes
        </div>
      </Show>
    </div>
  );
}
