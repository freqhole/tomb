import { For, Show } from "solid-js";
import { Modal } from "../../../components/modals/Modal";

// confirmation modal for the bulk auto-confirm action. lets the user
// tweak min-confidence + min-gap thresholds and shows a live count of
// how many of the currently-loaded + filtered albums would be eligible
// at those thresholds, plus a preview list of the actual matches.
// server-side eligibility is the source of truth; the modal numbers are
// just an estimate based on candidate metadata already loaded on the
// client.
export interface AutoConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  minConfidence: number;
  minGap: number;
  setMinConfidence: (v: number) => void;
  setMinGap: (v: number) => void;
  eligibleStats: {
    totalLoaded: number;
    withCandidates: number;
    eligibleByStatus: number;
    meetsConfidence: number;
    meetsGap: number;
    meetsBoth: number;
    matched: {
      albumId: string;
      title: string;
      artist: string;
      score: number;
      gap: number;
      mbTitle: string;
      primaryType: string | null;
    }[];
  };
  onConfirm: () => Promise<void> | void;
  running: boolean;
}

export function AutoConfirmModal(props: AutoConfirmModalProps) {
  const PREVIEW_LIMIT = 50;
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="auto-confirm musicbrainz matches"
      size="md"
      disableBackdropClose={props.running}
      fitContent
      scrollBody
      footer={
        <div class="flex items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.running}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={() => void props.onConfirm()}
            disabled={props.running || props.eligibleStats.meetsBoth === 0}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              props.eligibleStats.meetsBoth === 0
                ? "no albums in the current filter would be confirmed at these thresholds"
                : `confirm ${props.eligibleStats.meetsBoth} albums`
            }
          >
            <Show
              when={props.running}
              fallback={<>confirm {props.eligibleStats.meetsBoth} matches</>}
            >
              running…
            </Show>
          </button>
        </div>
      }
    >
      <div class="flex flex-col gap-4 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <p class="text-[var(--color-text-muted)]">
          confirm the top musicbrainz candidate for every reviewable album in the current filter
          where both thresholds below are met. drag the sliders to preview the match list, then
          commit.
        </p>
        <div class="flex flex-col gap-3">
          <label class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-[var(--color-text-primary)] text-xs font-medium">
                min confidence
              </span>
              <span class="text-[var(--color-text-primary)] tabular-nums text-xs">
                {props.minConfidence.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.minConfidence}
              onInput={(e) => props.setMinConfidence(Number.parseFloat(e.currentTarget.value) || 0)}
              class="w-full accent-[var(--color-accent-500)]"
            />
            <span class="text-[10px] text-[var(--color-text-muted)] leading-snug">
              how strong the top candidate must be on its own (0.00–1.00). higher = fewer false
              positives. 0.90 is a safe default.
            </span>
          </label>
          <label class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <span class="text-[var(--color-text-primary)] text-xs font-medium">min gap</span>
              <span class="text-[var(--color-text-primary)] tabular-nums text-xs">
                {props.minGap.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.minGap}
              onInput={(e) => props.setMinGap(Number.parseFloat(e.currentTarget.value) || 0)}
              class="w-full accent-[var(--color-accent-500)]"
            />
            <span class="text-[10px] text-[var(--color-text-muted)] leading-snug">
              how far ahead of the runner-up the top must be (0.00–1.00). guards against near-ties
              between similarly-scored releases. 0.15 is a safe default.
            </span>
          </label>
        </div>
        <div class="rounded border border-[var(--color-border-subtle)] p-3 flex flex-col gap-1 text-xs">
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">albums in current filter</span>
            <span>{props.eligibleStats.totalLoaded}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">with candidates</span>
            <span>{props.eligibleStats.withCandidates}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">in reviewable status</span>
            <span>{props.eligibleStats.eligibleByStatus}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">meets confidence threshold</span>
            <span>{props.eligibleStats.meetsConfidence}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--color-text-muted)]">meets gap threshold</span>
            <span>{props.eligibleStats.meetsGap}</span>
          </div>
          <div class="flex justify-between font-medium text-[var(--color-text-primary)] mt-1 pt-1 border-t border-[var(--color-border-subtle)]">
            <span>would auto-confirm</span>
            <span>{props.eligibleStats.meetsBoth}</span>
          </div>
        </div>
        <Show when={props.eligibleStats.matched.length > 0}>
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between text-xs">
              <span class="text-[var(--color-text-primary)] font-medium">matches preview</span>
              <Show when={props.eligibleStats.matched.length > PREVIEW_LIMIT}>
                <span class="text-[var(--color-text-muted)]">
                  showing {PREVIEW_LIMIT} of {props.eligibleStats.matched.length}
                </span>
              </Show>
            </div>
            <div class="rounded border border-[var(--color-border-subtle)] max-h-64 overflow-y-auto divide-y divide-[var(--color-border-subtle)]">
              <For each={props.eligibleStats.matched.slice(0, PREVIEW_LIMIT)}>
                {(m) => (
                  <div class="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-[var(--color-bg-elevated)]">
                    <div class="flex-1 min-w-0">
                      <div class="truncate text-[var(--color-text-primary)]">
                        {m.artist} — {m.title}
                      </div>
                      <div class="truncate text-[10px] text-[var(--color-text-muted)]">
                        mb: {m.mbTitle}
                        <Show when={m.primaryType}> · {m.primaryType}</Show>
                      </div>
                    </div>
                    <div class="shrink-0 flex items-center gap-2 tabular-nums text-[10px] text-[var(--color-text-secondary)]">
                      <span title="top candidate confidence">conf {m.score.toFixed(2)}</span>
                      <span title="confidence gap to runner-up">gap {m.gap.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
