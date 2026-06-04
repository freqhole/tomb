// ExternalUrlsReviewPanel — phase 11.x.
//
// renders external-url proposals harvested from already-stored
// metadata snapshots (musicbrainz url-rels, last.fm page urls,
// audiodb website/facebook/twitter). each row defaults to *checked*
// per user request; the user toggles off to skip. on save&next the
// parent collects accepted rows and posts to `apply_external_urls`.
//
// keep this presentational: parent owns the accept set so it can be
// applied alongside the bio + taxon + related-artist + image writes
// in one save action.

import { For, Show } from "solid-js";

/** matches `ExternalUrlProposalSchema` in codegen/schema.ts. */
export interface ExternalUrlProposalLike {
  entity_type: string; // "album" | "artist"
  entity_id: string;
  name: string; // relation kind ("bandcamp", "discogs", "website", ...)
  url: string;
  source: string; // "musicbrainz" | "lastfm" | "audiodb"
}

/** unique key for an accepted-set entry. mirrors the apply payload
 *  shape so the parent can dedupe + serialize directly. */
export function externalUrlKey(p: ExternalUrlProposalLike): string {
  return `${p.entity_type}\u0000${p.url.toLowerCase()}`;
}

export interface ExternalUrlsReviewPanelProps {
  proposals: ExternalUrlProposalLike[];
  /** keys (entity_type+url) the user has accepted. */
  acceptKeys: Set<string>;
  onToggle: (p: ExternalUrlProposalLike) => void;
  onAcceptAll: () => void;
  onClear: () => void;
}

export function ExternalUrlsReviewPanel(props: ExternalUrlsReviewPanelProps) {
  // group by entity_type so the album rows and artist rows render
  // in two visually-distinct buckets.
  const albumRows = () => props.proposals.filter((p) => p.entity_type === "album");
  const artistRows = () => props.proposals.filter((p) => p.entity_type === "artist");

  return (
    <div class="flex flex-col gap-2 p-2 rounded border border-[var(--color-border-subtle)]">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
          external links
        </span>
        <span class="text-[10px] text-[var(--color-text-disabled)]">
          {props.proposals.length} proposed
        </span>
      </div>

      <Show when={props.proposals.length > 0}>
        <div class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <button
            type="button"
            class="px-2 py-0.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer text-xs"
            onClick={() => props.onAcceptAll()}
          >
            select all
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
          no new external urls (any harvested links are already on file)
        </div>
      </Show>

      <Show when={albumRows().length > 0}>
        <div class="flex flex-col gap-1">
          <div class="text-[10px] uppercase text-[var(--color-text-disabled)] px-1">album</div>
          <ul class="flex flex-col gap-1">
            <For each={albumRows()}>
              {(p) => (
                <UrlRow
                  proposal={p}
                  accepted={props.acceptKeys.has(externalUrlKey(p))}
                  onToggle={() => props.onToggle(p)}
                />
              )}
            </For>
          </ul>
        </div>
      </Show>

      <Show when={artistRows().length > 0}>
        <div class="flex flex-col gap-1">
          <div class="text-[10px] uppercase text-[var(--color-text-disabled)] px-1">artist</div>
          <ul class="flex flex-col gap-1">
            <For each={artistRows()}>
              {(p) => (
                <UrlRow
                  proposal={p}
                  accepted={props.acceptKeys.has(externalUrlKey(p))}
                  onToggle={() => props.onToggle(p)}
                />
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  );
}

function UrlRow(props: {
  proposal: ExternalUrlProposalLike;
  accepted: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      class="flex items-center gap-2 px-2 py-1 rounded text-xs border transition-colors"
      classList={{
        "bg-[var(--color-accent-500)]/10 border-[var(--color-accent-500)]/30": props.accepted,
        "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] opacity-70":
          !props.accepted,
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={props.accepted}
        onClick={() => props.onToggle()}
        class="inline-flex items-center justify-center w-4 h-4 rounded-sm border cursor-pointer"
        classList={{
          "bg-[var(--color-accent-500)] border-[var(--color-accent-500)]": props.accepted,
          "border-[var(--color-border-default)]": !props.accepted,
        }}
        title={props.accepted ? "skip this url" : "include this url"}
      />
      <span class="text-[10px] uppercase opacity-60 w-16 shrink-0">{props.proposal.name}</span>
      <a
        href={props.proposal.url}
        target="_blank"
        rel="noreferrer noopener"
        class="flex-1 truncate text-[var(--color-text-secondary)] hover:text-[var(--color-accent-500)] hover:underline"
        title={props.proposal.url}
      >
        {props.proposal.url}
      </a>
      <span class="opacity-60 text-[10px]">{sourceLabel(props.proposal.source)}</span>
    </li>
  );
}

function sourceLabel(src: string): string {
  switch (src) {
    case "musicbrainz":
      return "mb";
    case "lastfm":
      return "lf";
    case "audiodb":
      return "ad";
    default:
      return src.toLowerCase();
  }
}
