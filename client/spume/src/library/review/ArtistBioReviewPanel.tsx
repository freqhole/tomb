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

import { For, Show } from "solid-js";

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
            {(p) => (
              <div
                class="border rounded p-2 flex flex-col gap-1.5"
                classList={{
                  "border-[var(--color-accent-500)]": props.selectedSource === p.source,
                  "border-[var(--color-border-subtle)]": props.selectedSource !== p.source,
                }}
              >
                <div class="flex items-center justify-between gap-2 text-xs">
                  <div class="flex items-center gap-2">
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
                  </div>
                  <button
                    type="button"
                    onClick={() => props.onSelect(p.source, p.text)}
                    class="px-2 py-0.5 rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer text-[10px]"
                  >
                    use this
                  </button>
                </div>
                <p class="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap line-clamp-6">
                  {p.text}
                </p>
              </div>
            )}
          </For>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)]">
            edit (saved on next)
          </label>
          <textarea
            value={props.customText}
            onInput={(e) => props.onCustomChange((e.currentTarget as HTMLTextAreaElement).value)}
            rows={6}
            class="w-full text-xs font-mono p-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]"
            placeholder="(pick a candidate above to seed; or type freely)"
          />
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
