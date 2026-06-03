// taxon chip strip — renders TaxonRef[] as pill chips, grouped by kind.
//
// kinds are sorted with 'genre' first (so it visually leads), then
// alphabetical. each chip shows just the label by default; for
// non-genre kinds the kind slug is prefixed in muted text so a viewer
// can disambiguate (e.g. "label · 4AD", "mood · melancholy").
//
// callers can opt out of certain kinds via `excludeKinds` — most views
// already render genres separately and pass `excludeKinds={["genre"]}`
// to avoid duplication.
//
// optional `onTaxonClick` fires per click; if absent, chips are spans.
//
// styling matches the existing inline pill style used in
// AlbumDetailView, so chips visually sit alongside the genre buttons
// without standing out awkwardly.

import { For, Show } from "solid-js";
import type { TaxonRef } from "../../music/services/storage/types";
import { formatTaxonLabel } from "../../music/utils/format";

export interface TaxonChipsProps {
  taxons: TaxonRef[] | null | undefined;
  excludeKinds?: string[];
  onTaxonClick?: (taxon: TaxonRef) => void;
  /** optional extra classes appended to the wrapper flex container */
  class?: string;
}

// kind sort key: genre first, then alpha. used both for ordering chips
// and for picking a deterministic colour band per kind.
function kindSortKey(slug: string): string {
  if (slug === "genre") return "0";
  return `1_${slug}`;
}

// muted background colour bands so different kinds are visually
// distinguishable without screaming for attention.
function kindAccent(slug: string): { bg: string; text: string } {
  switch (slug) {
    case "genre":
      return {
        bg: "bg-[var(--color-bg-elevated)]",
        text: "text-[var(--color-text-secondary)]",
      };
    case "label":
      return {
        bg: "bg-[var(--color-info-bg,var(--color-bg-elevated))]/40",
        text: "text-[var(--color-info-text,var(--color-text-secondary))]",
      };
    case "mood":
      return {
        bg: "bg-[var(--color-accent-primary)]/10",
        text: "text-[var(--color-accent-primary)]",
      };
    case "era":
      return {
        bg: "bg-[var(--color-warning-bg,var(--color-bg-elevated))]/40",
        text: "text-[var(--color-warning-text,var(--color-text-secondary))]",
      };
    case "region":
    case "country":
    case "language":
    case "locale":
      return {
        bg: "bg-[var(--color-success-bg,var(--color-bg-elevated))]/40",
        text: "text-[var(--color-success-text,var(--color-text-secondary))]",
      };
    default:
      return {
        bg: "bg-[var(--color-bg-elevated)]",
        text: "text-[var(--color-text-tertiary)]",
      };
  }
}

export function TaxonChips(props: TaxonChipsProps) {
  return (
    <Show when={visibleTaxons(props.taxons, props.excludeKinds).length > 0}>
      <div class={`flex flex-wrap gap-1.5 ${props.class ?? ""}`}>
        <TaxonChipList
          taxons={props.taxons}
          excludeKinds={props.excludeKinds}
          onTaxonClick={props.onTaxonClick}
        />
      </div>
    </Show>
  );
}

// wrapper-less variant: emits chip elements only, suitable for inlining
// inside an existing flex container (e.g. alongside genre buttons that
// the caller renders separately).
export function TaxonChipList(props: Omit<TaxonChipsProps, "class">) {
  const visible = () => visibleTaxons(props.taxons, props.excludeKinds);
  return (
    <For each={visible()}>
      {(taxon) => {
        const accent = kindAccent(taxon.kind_slug);
        const baseClasses = `px-2 py-0.5 rounded-full text-xs ${accent.bg} ${accent.text}`;
        const interactive = props.onTaxonClick
          ? "transition-colors hover:bg-[var(--color-bg-hover)] cursor-pointer"
          : "";
        const niceLabel = formatTaxonLabel(taxon.label);
        const content = (
          <>
            <Show when={taxon.kind_slug !== "genre"}>
              <span class="opacity-60 mr-1">{taxon.kind_slug}·</span>
            </Show>
            {niceLabel}
          </>
        );
        return props.onTaxonClick ? (
          <button
            type="button"
            class={`${baseClasses} ${interactive}`}
            onClick={() => props.onTaxonClick?.(taxon)}
            title={`${taxon.kind_slug}: ${niceLabel}`}
          >
            {content}
          </button>
        ) : (
          <span class={baseClasses} title={`${taxon.kind_slug}: ${niceLabel}`}>
            {content}
          </span>
        );
      }}
    </For>
  );
}

function visibleTaxons(
  taxons: TaxonRef[] | null | undefined,
  excludeKinds: string[] | undefined
): TaxonRef[] {
  const list = taxons ?? [];
  const excl = new Set(excludeKinds ?? []);
  return [...list]
    .filter((t) => !excl.has(t.kind_slug))
    .sort((a, b) => {
      const ka = kindSortKey(a.kind_slug);
      const kb = kindSortKey(b.kind_slug);
      if (ka !== kb) return ka.localeCompare(kb);
      return a.label.localeCompare(b.label);
    });
}
