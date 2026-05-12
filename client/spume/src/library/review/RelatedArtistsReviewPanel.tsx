// RelatedArtistsReviewPanel — phase 11 / slice 4c.
//
// renders the pending related-artist rows returned by
// `propose_related_artists`. each row defaults to *unselected*; the
// user explicitly accepts (checkbox) or rejects (trash). on save&next
// the parent collects accept_ids / reject_ids and posts to
// `apply_related_artists`.
//
// keep this presentational: parent owns the pending sets so they can
// be applied alongside the bio + taxon writes in one save action.

import { For, Show } from "solid-js";

/** matches `RelatedArtistProposalSchema` in codegen/schema.ts. */
export interface RelatedArtistProposalLike {
  id: string;
  related_name: string;
  related_artist_id?: string | null;
  related_mbid?: string | null;
  source: string; // "lastfm" | "audiodb" | "mb"
  match_score?: number | null;
  image_url?: string | null;
  fetched_at: number;
}

export interface RelatedArtistsReviewPanelProps {
  proposals: RelatedArtistProposalLike[];
  /** ids the user has accepted. */
  acceptIds: Set<string>;
  /** ids the user has rejected. */
  rejectIds: Set<string>;
  onToggleAccept: (id: string) => void;
  onToggleReject: (id: string) => void;
  onAcceptAll: () => void;
  onClear: () => void;
}

export function RelatedArtistsReviewPanel(props: RelatedArtistsReviewPanelProps) {
  return (
    <div class="flex flex-col gap-2 p-2 rounded border border-[var(--color-border-subtle)]">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
          related artists
        </span>
        <span class="text-[10px] text-[var(--color-text-disabled)]">
          {props.proposals.length} pending
        </span>
      </div>

      <Show when={props.proposals.length > 0}>
        <div class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer text-xs"
            onClick={() => props.onAcceptAll()}
          >
            accept all
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer text-xs ml-auto"
            onClick={() => props.onClear()}
          >
            clear
          </button>
        </div>
      </Show>

      <Show when={props.proposals.length === 0}>
        <div class="text-xs text-[var(--color-text-disabled)] italic px-1">
          no pending related-artist proposals
        </div>
      </Show>

      <ul class="flex flex-col gap-1">
        <For each={props.proposals}>
          {(p) => (
            <RelatedRow
              proposal={p}
              accepted={props.acceptIds.has(p.id)}
              rejected={props.rejectIds.has(p.id)}
              onToggleAccept={() => props.onToggleAccept(p.id)}
              onToggleReject={() => props.onToggleReject(p.id)}
            />
          )}
        </For>
      </ul>
    </div>
  );
}

function RelatedRow(props: {
  proposal: RelatedArtistProposalLike;
  accepted: boolean;
  rejected: boolean;
  onToggleAccept: () => void;
  onToggleReject: () => void;
}) {
  const inLibrary = () => Boolean(props.proposal.related_artist_id);
  return (
    <li
      class="flex items-center gap-2 px-2 py-1 rounded text-xs border transition-colors"
      classList={{
        "bg-[var(--color-accent-500)]/10 border-[var(--color-accent-500)]/30": props.accepted,
        "bg-[var(--color-error-500)]/10 border-[var(--color-error-500)]/30 opacity-60":
          props.rejected,
        "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)]":
          !props.accepted && !props.rejected,
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={props.accepted}
        onClick={() => props.onToggleAccept()}
        class="inline-flex items-center justify-center w-4 h-4 rounded-sm border cursor-pointer"
        classList={{
          "bg-[var(--color-accent-500)] border-[var(--color-accent-500)]": props.accepted,
          "border-[var(--color-border-default)]": !props.accepted,
        }}
        title={props.accepted ? "unaccept" : "accept this related artist"}
      />
      <span class="flex-1 truncate">
        {props.proposal.related_name}
        <Show when={inLibrary()}>
          <span class="ml-2 text-[10px] uppercase text-[var(--color-success-500)]">in library</span>
        </Show>
      </span>
      <span class="opacity-60 text-[10px]">{sourceLabel(props.proposal.source)}</span>
      <Show when={props.proposal.match_score != null}>
        <span class="opacity-60 text-[10px]">
          {(props.proposal.match_score! * 100).toFixed(0)}%
        </span>
      </Show>
      <button
        type="button"
        onClick={() => props.onToggleReject()}
        class="px-1.5 py-0.5 rounded border text-[10px] cursor-pointer"
        classList={{
          "bg-[var(--color-error-500)]/20 border-[var(--color-error-500)]/40 text-[var(--color-error-500)]":
            props.rejected,
          "border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]": !props.rejected,
        }}
        title={props.rejected ? "undo reject" : "reject (soft-delete)"}
      >
        reject
      </button>
    </li>
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
