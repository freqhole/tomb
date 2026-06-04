// ArtistBioReviewPanel — slice 4a.
//
// renders one card per BioProposal returned by `propose_artist_bios`
// and an editable textarea seeded from the currently-selected source.
// purely presentational — the parent (`BulkEnrichmentReviewModal`) owns
// the (selectedSource, customText) signals and decides when to call
// `applyArtistBio`.
//
// behaviour:
//   * proposals are listed in the order returned by the server (user >
//     lastfm > audiodb).
//   * the proposal that's `is_current` gets a dim "current" badge but
//     remains clickable (so a user can re-affirm it after editing).
//   * "use this" copies the source text into `customText`.
//   * empty state ("no bio proposals") when the proposals array is
//     empty — parent surfaces a hint in the footer instead of forcing a
//     no-op save.

import { For, Show, createSignal } from "solid-js";

export type BioSourceLike = "user" | "lastfm" | "audiodb";

export interface BioProposalLike {
  source: BioSourceLike;
  text: string;
  fetched_at?: number | null;
  is_current: boolean;
}

export interface ArtistBioReviewPanelProps {
  artistName: string | null;
  proposals: BioProposalLike[];
  selectedSource: BioSourceLike | null;
  customText: string;
  onSelect: (source: BioSourceLike, text: string) => void;
  onCustomChange: (text: string) => void;
}

export function ArtistBioReviewPanel(props: ArtistBioReviewPanelProps) {
  const [showEdit, setShowEdit] = createSignal(false);
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
          artist bio{props.artistName ? ` — ${props.artistName}` : ""}
        </h3>
        <Show when={props.proposals.length > 0}>
          <span class="text-[10px] text-[var(--color-text-disabled)]">
            {props.proposals.length} candidate{props.proposals.length === 1 ? "" : "s"}
          </span>
        </Show>
      </div>

      <Show
        when={props.proposals.length > 0}
        fallback={
          <div class="text-xs text-[var(--color-text-disabled)] italic">
            no bio candidates from any enrichment source
          </div>
        }
      >
        <div class="flex flex-col gap-2">
          <For each={props.proposals}>
            {(p) => {
              const selected = () => props.selectedSource === p.source;
              const onPick = () => props.onSelect(p.source, p.text);
              return (
                <div
                  role="radio"
                  aria-checked={selected()}
                  tabindex="0"
                  onClick={onPick}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick();
                    }
                  }}
                  class="border rounded p-2 flex flex-col gap-1.5 cursor-pointer hover:bg-[var(--color-bg-hover)] transition-colors"
                  classList={{
                    "border-[var(--color-accent-500)] bg-[var(--color-accent-500)]/5": selected(),
                    "border-[var(--color-border-subtle)]": !selected(),
                  }}
                  title={selected() ? "selected (click to re-pick)" : "click to use this bio"}
                >
                  <div class="flex items-center gap-2 text-xs">
                    <span class="font-medium uppercase tracking-wide text-[10px]">
                      {sourceLabel(p.source)}
                    </span>
                    <Show when={p.is_current}>
                      <span class="text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wide">
                        current
                      </span>
                    </Show>
                    <Show when={p.fetched_at}>
                      <span class="text-[10px] text-[var(--color-text-disabled)]">
                        {formatTimestamp(p.fetched_at!)}
                      </span>
                    </Show>
                    <Show when={selected()}>
                      <span class="ml-auto text-[10px] text-[var(--color-accent-500)] uppercase tracking-wide">
                        selected
                      </span>
                    </Show>
                  </div>
                  <p class="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap line-clamp-6">
                    {p.text}
                  </p>
                </div>
              );
            }}
          </For>
        </div>

        <div class="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowEdit((v) => !v)}
            class="self-start text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer flex items-center gap-1"
          >
            <span>{showEdit() ? "▾" : "▸"}</span>
            <span>edit (saved on next)</span>
          </button>
          <Show when={showEdit()}>
            <textarea
              value={props.customText}
              onInput={(e) => props.onCustomChange((e.currentTarget as HTMLTextAreaElement).value)}
              rows={6}
              class="w-full text-xs font-mono p-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]"
              placeholder="(pick a candidate above to seed; or type freely)"
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

function sourceLabel(s: BioSourceLike): string {
  switch (s) {
    case "user":
      return "user";
    case "lastfm":
      return "lastfm";
    case "audiodb":
      return "audiodb";
    default:
      return s;
  }
}

function formatTimestamp(unix: number): string {
  try {
    const d = new Date(unix * 1000);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
