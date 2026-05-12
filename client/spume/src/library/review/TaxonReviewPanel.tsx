// TaxonReviewPanel — renders proposals from `propose_taxons` grouped by
// kind, with checkboxes for un-linked proposals and locked-checked dim
// chips for already-linked ones. parent owns selection state so it can
// collect picks for the "save & next" call.

import { For, Show, createMemo } from "solid-js";

// minimal duck-typed proposal shape (avoids depending on the codegen
// schema in case it shifts; matches `TaxonProposalSchema` in
// `client-codegen/freqhole-api-client/src/codegen/schema.ts`).
export interface TaxonProposalLike {
  kind_slug: string;
  label: string;
  sources: string[]; // ["mb", "lastfm", "audiodb"]
  source_detail?: string | null;
  already_linked: boolean;
}

/** stable key for a (kind, label) pair — used as the selection set
 *  identity. labels are not slugified here; the server already dedups
 *  by `(kind_slug, slugified_label)` before returning. */
export function proposalKey(p: { kind_slug: string; label: string }): string {
  return `${p.kind_slug}\u0000${p.label}`;
}

export interface TaxonReviewPanelProps {
  proposals: TaxonProposalLike[];
  /** set of selected proposal keys (un-linked picks only). */
  selected: Set<string>;
  onToggle: (proposal: TaxonProposalLike) => void;
  onSelectAllFromSource: (source: string) => void;
  onClearAllUnlinked: () => void;
}

export function TaxonReviewPanel(props: TaxonReviewPanelProps) {
  // group proposals by kind_slug, preserving insertion order.
  const grouped = createMemo<Array<[string, TaxonProposalLike[]]>>(() => {
    const m = new Map<string, TaxonProposalLike[]>();
    for (const p of props.proposals) {
      const arr = m.get(p.kind_slug) ?? [];
      arr.push(p);
      m.set(p.kind_slug, arr);
    }
    return [...m.entries()];
  });

  // unique source set across the visible un-linked proposals — drives
  // the "select all from <source>" quick-toggle bar.
  const sources = createMemo<string[]>(() => {
    const s = new Set<string>();
    for (const p of props.proposals) {
      if (p.already_linked) continue;
      for (const src of p.sources) s.add(src);
    }
    return [...s];
  });

  const unlinkedCount = createMemo<number>(
    () => props.proposals.filter((p) => !p.already_linked).length
  );

  const linkedCount = createMemo<number>(
    () => props.proposals.filter((p) => p.already_linked).length
  );

  return (
    <div class="flex flex-col gap-3">
      {/* quick-toggle bar */}
      <Show when={sources().length > 0}>
        <div class="flex items-center gap-2 flex-wrap text-xs text-[var(--color-text-secondary)]">
          <span class="opacity-70">select all from:</span>
          <For each={sources()}>
            {(src) => (
              <button
                type="button"
                class="px-2 py-0.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer text-xs"
                onClick={() => props.onSelectAllFromSource(src)}
              >
                {sourceLabel(src)}
              </button>
            )}
          </For>
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer text-xs ml-auto"
            onClick={() => props.onClearAllUnlinked()}
          >
            clear
          </button>
        </div>
      </Show>

      {/* empty state */}
      <Show when={props.proposals.length === 0}>
        <div class="text-xs text-[var(--color-text-disabled)] italic px-1">
          no proposals from any source yet
        </div>
      </Show>

      {/* grouped chips */}
      <For each={grouped()}>
        {([kind, items]) => (
          <div class="space-y-1.5 p-2 rounded border border-[var(--color-border-subtle)]">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                {kind}
              </span>
              <span class="text-[10px] text-[var(--color-text-disabled)]">{items.length}</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <For each={items}>
                {(p) => (
                  <ChipButton
                    proposal={p}
                    selected={props.selected.has(proposalKey(p))}
                    onToggle={() => props.onToggle(p)}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </For>

      <Show when={props.proposals.length > 0}>
        <div class="text-[10px] text-[var(--color-text-disabled)] px-1">
          {unlinkedCount()} new · {linkedCount()} already linked
        </div>
      </Show>
    </div>
  );
}

function ChipButton(props: {
  proposal: TaxonProposalLike;
  selected: boolean;
  onToggle: () => void;
}) {
  const linked = () => props.proposal.already_linked;
  const checked = () => linked() || props.selected;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked()}
      disabled={linked()}
      onClick={() => {
        if (!linked()) props.onToggle();
      }}
      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs cursor-pointer border transition-colors"
      classList={{
        "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-500)] border-[var(--color-accent-500)]/30":
          checked() && !linked(),
        // already-linked: keep readable. accent-tinted bg + accent-on-dark
        // text instead of disabled-grey-on-elevated-grey which became
        // unreadable in dark mode. border is intentionally `transparent`
        // so the chip doesn't read as a clickable item; the bg tint
        // alone signals "linked".
        "bg-[var(--color-success-500)]/15 text-[var(--color-success-500)] border-transparent cursor-not-allowed":
          linked(),
        "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]":
          !checked() && !linked(),
      }}
      title={
        linked()
          ? "already linked to this album"
          : `from ${props.proposal.sources.map(sourceLabel).join(", ")}`
      }
    >
      <span
        class="inline-block w-3 h-3 rounded-sm border flex-shrink-0"
        classList={{
          "bg-[var(--color-accent-500)] border-[var(--color-accent-500)]": checked(),
          "border-[var(--color-border-default)]": !checked(),
        }}
        aria-hidden="true"
      />
      <span>{props.proposal.label}</span>
      <span class="opacity-60 text-[10px]">
        {props.proposal.sources.map(sourceLabel).join("·")}
      </span>
    </button>
  );
}

function sourceLabel(src: string): string {
  switch (src) {
    case "mb":
      return "mb";
    case "lastfm":
      return "lf";
    case "audiodb":
      return "ad";
    default:
      return src.toLowerCase();
  }
}
