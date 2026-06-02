// presentational pieces for displaying + editing a set of taxon
// links, grouped by kind. used by AlbumTaxonsEditor (modal, buffered
// writes) and BulkAlbumTaxonsEditor (graph edit panel, immediate
// fan-out writes). owns no fetching or mutations — every action is
// surfaced as a callback.

import { For, Show } from "solid-js";
import { TaxonAutocomplete } from "../forms/TaxonAutocomplete";
import { Icon, IconNames } from "../icons/registry";
import type { TaxonRef } from "../../music/data/types";
import type { ApiClient } from "../../app/api/client";

export interface TaxonKindOption {
  slug: string;
  label: string;
}

/** display shape for one chip — server links, pending adds, and
 *  cross-album union entries all collapse to this. */
export interface TaxonChipData {
  taxon_id: string;
  kind_slug: string;
  label: string;
  /** record's `origin` value (e.g. "user", "musicbrainz"). only shown
   *  as a subtle suffix when not "user". */
  origin: string;
  /** "add" = buffered add not yet persisted; null = server-truth. */
  pending: "add" | null;
  /** when this chip was seeded from an enrichment proposal, the
   *  source string (e.g. "musicbrainz") shows up as a tiny badge. */
  proposalSource?: string | null;
  /** when displayed across N items where only K have this taxon,
   *  carry the counts so the chip can render dimmed and the parent
   *  can interpret a click. omit for single-item or full-coverage. */
  partial?: { count: number; total: number };
}

export interface TaxonChipProps {
  chip: TaxonChipData;
  onRemove?: () => void;
}

export function TaxonChip(props: TaxonChipProps) {
  const partial = () => props.chip.partial;
  const isPartial = () => {
    const p = partial();
    return p ? p.count < p.total : false;
  };
  const title = () => {
    const c = props.chip;
    if (c.pending === "add") {
      return c.proposalSource
        ? `${c.kind_slug}: ${c.label} (proposed by ${c.proposalSource})`
        : `${c.kind_slug}: ${c.label} (pending add)`;
    }
    const p = partial();
    if (p && p.count < p.total) {
      return `${c.kind_slug}: ${c.label} — on ${p.count} of ${p.total}`;
    }
    return `${c.kind_slug}: ${c.label} (origin: ${c.origin})`;
  };
  return (
    <span
      class={
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs " +
        (props.chip.pending === "add"
          ? "bg-[var(--color-accent-500)]/15 text-[var(--color-accent-600,var(--color-accent-500))] ring-1 ring-[var(--color-accent-500)]/30"
          : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]")
      }
      classList={{ "opacity-60 ring-1 ring-white/15": isPartial() }}
      title={title()}
    >
      <span>{props.chip.label}</span>
      <Show when={partial() && partial()!.count < partial()!.total}>
        <span class="opacity-70 text-[10px]">
          {partial()!.count}/{partial()!.total}
        </span>
      </Show>
      <Show when={props.chip.pending === "add" && props.chip.proposalSource}>
        <span class="opacity-70 text-[10px]">from {props.chip.proposalSource}</span>
      </Show>
      <Show when={props.chip.pending === null && props.chip.origin !== "user" && !partial()}>
        <span class="opacity-60 text-[10px]">{props.chip.origin}</span>
      </Show>
      <Show when={props.onRemove}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove?.();
          }}
          class="ml-0.5 hover:text-[var(--color-danger-text,var(--color-text-primary))] transition-colors cursor-pointer"
          aria-label={`remove ${props.chip.label}`}
        >
          <Icon name={IconNames.close} size={10} />
        </button>
      </Show>
    </span>
  );
}

export interface TaxonKindSectionProps {
  kind: TaxonKindOption;
  chips: TaxonChipData[];
  /** ids to hide from the autocomplete (typically the chips already shown). */
  excludeIds?: string[];
  /** picked an existing taxon. */
  onAdd: (taxon: TaxonRef) => void;
  /** typed a label with no exact match. when omitted, enter is a no-op. */
  onCreate?: (label: string) => void | Promise<void>;
  onRemoveChip?: (chip: TaxonChipData) => void;
  disabled?: boolean;
  /** label to show next to the chip count (e.g. "3 linked", "on 5"). */
  countSuffix?: string;
  /** explicit api client passed to TaxonAutocomplete — required when
   *  the caller is scoped to a non-active remote (e.g. graph edit panel). */
  apiClient?: ApiClient | null;
}

export function TaxonKindSection(props: TaxonKindSectionProps) {
  return (
    <div class="space-y-1.5 p-2 rounded border border-[var(--color-border-subtle,var(--color-border-default))] bg-[var(--color-bg-secondary,var(--color-bg-primary))]/40">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
          {props.kind.label || props.kind.slug}
        </span>
        <span class="text-[10px] text-[var(--color-text-tertiary)]">
          {props.chips.length} {props.countSuffix ?? "linked"}
        </span>
      </div>

      <Show when={props.chips.length > 0}>
        <div class="flex flex-wrap gap-1.5">
          <For each={props.chips}>
            {(chip) => (
              <TaxonChip
                chip={chip}
                onRemove={props.onRemoveChip ? () => props.onRemoveChip!(chip) : undefined}
              />
            )}
          </For>
        </div>
      </Show>

      <TaxonAutocomplete
        kindSlug={props.kind.slug}
        excludeIds={props.excludeIds}
        apiClient={props.apiClient}
        placeholder={`add ${props.kind.label || props.kind.slug}…`}
        onSelect={(t) => props.onAdd(t)}
        onCreate={props.onCreate ? (label) => props.onCreate!(label) : undefined}
        disabled={props.disabled}
      />
    </div>
  );
}

export interface TaxonChipsGridProps {
  kinds: TaxonKindOption[];
  chipsByKind: Map<string, TaxonChipData[]>;
  onAdd: (kindSlug: string, taxon: TaxonRef) => void;
  onCreate?: (kindSlug: string, label: string) => void | Promise<void>;
  onRemoveChip?: (chip: TaxonChipData) => void;
  disabled?: boolean;
  /** label to show next to the chip count in each section. */
  countSuffix?: string;
  /** rendered above the grid when the kinds list is empty. */
  emptyMessage?: string;
  /** explicit api client passed down to each TaxonAutocomplete. */
  apiClient?: ApiClient | null;
}

export function TaxonChipsGrid(props: TaxonChipsGridProps) {
  return (
    <Show
      when={props.kinds.length > 0}
      fallback={
        <p class="text-xs text-[var(--color-text-tertiary)]">
          {props.emptyMessage ?? "no editable taxon kinds available."}
        </p>
      }
    >
      <div class="space-y-3">
        <For each={props.kinds}>
          {(kind) => {
            const chips = () => props.chipsByKind.get(kind.slug) ?? [];
            const excludeIds = () => chips().map((c) => c.taxon_id);
            return (
              <TaxonKindSection
                kind={kind}
                chips={chips()}
                excludeIds={excludeIds()}
                onAdd={(t) => props.onAdd(kind.slug, t)}
                onCreate={props.onCreate ? (label) => props.onCreate!(kind.slug, label) : undefined}
                onRemoveChip={props.onRemoveChip}
                disabled={props.disabled}
                countSuffix={props.countSuffix}
                apiClient={props.apiClient}
              />
            );
          }}
        </For>
      </div>
    </Show>
  );
}
