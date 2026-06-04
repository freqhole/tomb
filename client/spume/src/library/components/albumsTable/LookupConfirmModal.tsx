import { Modal } from "../../../components/modals/Modal";

// shown when the user clicks "lookup N" and some filtered rows are already
// confirmed/enriched/skipped. default action ("skip them") only enqueues
// eligible rows; "include all" mirrors the old "lookup all matching" behavior.
export function LookupConfirmModal(props: {
  isOpen: boolean;
  eligibleCount: number;
  excludedCount: number;
  onSkipExcluded: () => void;
  onIncludeAll: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onCancel}
      title="lookup albums"
      size="sm"
      fitContent
      scrollBody
      footer={
        <div class="flex items-center justify-end gap-2 px-4 py-3 flex-wrap">
          <button
            type="button"
            onClick={props.onCancel}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] cursor-pointer bg-transparent"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={props.onIncludeAll}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] cursor-pointer bg-transparent"
          >
            include all ({props.eligibleCount + props.excludedCount})
          </button>
          <button
            type="button"
            onClick={props.onSkipExcluded}
            class="px-3 py-1.5 text-sm rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer bg-transparent"
          >
            skip them · lookup {props.eligibleCount}
          </button>
        </div>
      }
    >
      <div class="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
        <p>
          {props.excludedCount} album{props.excludedCount === 1 ? " is" : "s are"} already
          confirmed, enriched, or skipped. include them in this lookup, or skip them and only
          re-query the {props.eligibleCount} remaining album{props.eligibleCount === 1 ? "" : "s"}?
        </p>
        <p class="mt-2 text-[var(--color-text-muted)] text-xs">
          "skip them" is the default; use "include all" to re-run lookup on previously-confirmed or
          skipped rows.
        </p>
      </div>
    </Modal>
  );
}
