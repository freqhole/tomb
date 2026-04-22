// shared modal shell. unifies overlay, portal, nav-height offset,
// responsive sizing, and header layout across all modals in the app.
//
// layout guarantees:
//   - narrow (< wide:): full-width, starts below top nav (avoids z-index
//     issues on older android webviews), flush bottom
//   - wide (>= wide:): centered, sized by the `size` prop, max height
//     `80dvh`, rounded + bordered
//
// uses inline `position: fixed` + explicit insets because some older android
// webviews miscompute `fixed inset-0` when tailwind's `var(--spacing)` calc
// is in play (same workaround applied in AddMusicModal / AddRemoteModal).
import { Show, createEffect, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../icons/registry";
import { pushModal, popModal } from "../../music/hooks/modals";

// per-instance modal id — used by the shared modal stack in
// `music/hooks/modals.ts` so escape closes the topmost open modal.
let nextModalId = 0;

export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "wide:max-w-md",
  md: "wide:max-w-xl",
  lg: "wide:max-w-2xl",
  xl: "wide:max-w-3xl",
};

export interface ModalProps {
  /** whether the modal is open */
  isOpen: boolean;
  /** called when the user requests close (backdrop click, X button, escape) */
  onClose: () => void;
  /** header title text. omit to render a headerless modal (caller provides its own). */
  title?: string;
  /** extra header content rendered between title and close button (e.g. secondary buttons) */
  headerActions?: JSX.Element;
  /** footer region rendered below the scrollable body */
  footer?: JSX.Element;
  /** max width at wide breakpoint */
  size?: ModalSize;
  /** when true, raises z-index so this modal sits above a parent modal */
  elevated?: boolean;
  /** disable backdrop click-to-close (for in-progress forms) */
  disableBackdropClose?: boolean;
  /** additional classes applied to the modal container */
  class?: string;
  /** content (rendered inside scrollable body) */
  children?: JSX.Element;
}

export function Modal(props: ModalProps) {
  const handleBackdrop = (e: MouseEvent) => {
    if (props.disableBackdropClose) return;
    // only close when the backdrop itself is clicked, not bubbled events
    if (e.target === e.currentTarget) props.onClose();
  };

  // register/unregister this modal on the shared modal stack while open.
  // the stack lives in `music/hooks/modals.ts` and owns the global escape
  // listener — keeping a single source of truth avoids double-fires when a
  // wrapping component also calls pushModal directly.
  createEffect(() => {
    if (!props.isOpen) return;
    const id = `modal-shell-${++nextModalId}`;
    pushModal(id, () => props.onClose());
    onCleanup(() => popModal(id));
  });

  return (
    <Show when={props.isOpen}>
      <Portal>
        {/* overlay */}
        <div
          class="bg-black/50 flex items-center justify-center p-0 wide:p-8"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            "z-index": props.elevated ? 1060 : 1050,
          }}
          onClick={handleBackdrop}
        >
          {/* container — full screen below nav on narrow, centered box on wide */}
          <div
            class={`w-full h-full wide:h-auto wide:max-h-[80dvh] ${
              SIZE_CLASS[props.size ?? "lg"]
            } bg-[var(--color-bg-primary)] wide:border wide:border-[var(--color-border-default)] wide:rounded-lg shadow-xl overflow-hidden flex flex-col ${
              props.class ?? ""
            }`}
            style={{
              "margin-top": "env(safe-area-inset-top, 0px)",
              height: "calc(100% - env(safe-area-inset-top, 0px))",
              "max-height": "calc(100% - env(safe-area-inset-top, 0px))",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <Show when={props.title || props.headerActions}>
              <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)] gap-2 flex-shrink-0">
                <h2
                  class="text-lg font-semibold text-[var(--color-text-primary)] truncate"
                  style={{ "min-width": "0" }}
                >
                  {props.title}
                </h2>
                <div class="flex items-center gap-2 flex-shrink-0">
                  {props.headerActions}
                  <button
                    type="button"
                    onClick={() => props.onClose()}
                    aria-label="close modal"
                    class="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>
              </div>
            </Show>

            {/* body — children are responsible for their own scroll behavior;
                we just give them a flex cell that's allowed to shrink */}
            <div class="flex-1 min-h-0 flex flex-col overflow-hidden">{props.children}</div>

            {/* footer */}
            <Show when={props.footer}>
              <div class="border-t border-[var(--color-border-default)] flex-shrink-0">
                {props.footer}
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
