import { createEffect, createSignal, JSX, onCleanup, Show } from "solid-js";
import { IconButton } from "../buttons/IconButton";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

// modal component using native <dialog> element
// supports backdrop click and escape key to close
export function Modal(props: ModalProps) {
  let dialogRef: HTMLDialogElement | undefined;

  const size = () => props.size || "md";
  const showCloseButton = () => props.showCloseButton ?? true;
  const closeOnBackdrop = () => props.closeOnBackdrop ?? true;
  const closeOnEscape = () => props.closeOnEscape ?? true;

  const sizeClasses = () => {
    switch (size()) {
      case "sm":
        return "sm:max-w-md";
      case "md":
        return "sm:max-w-lg";
      case "lg":
        return "sm:max-w-2xl";
      case "xl":
        return "sm:max-w-4xl";
      case "full":
        return "sm:max-w-[95vw]";
      default:
        return "sm:max-w-lg";
    }
  };

  // sync isOpen prop with dialog state
  createEffect(() => {
    if (!dialogRef) return;

    if (props.isOpen && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!props.isOpen && dialogRef.open) {
      dialogRef.close();
    }
  });

  // handle backdrop click
  const handleBackdropClick = (e: MouseEvent) => {
    if (!closeOnBackdrop() || !dialogRef) return;

    const rect = dialogRef.getBoundingClientRect();
    const clickedOutside =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;

    if (clickedOutside) {
      props.onClose();
    }
  };

  // handle escape key
  const handleCancel = (e: Event) => {
    if (closeOnEscape()) {
      e.preventDefault();
      props.onClose();
    }
  };

  // cleanup on unmount
  onCleanup(() => {
    if (dialogRef && dialogRef.open) {
      dialogRef.close();
    }
  });

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      onCancel={handleCancel}
      class="bg-transparent p-0 max-w-none max-h-none m-auto backdrop:bg-black backdrop:bg-opacity-60 backdrop:backdrop-blur-sm"
    >
      <div
        class={`
          ${sizeClasses()}
          w-full
          bg-[var(--color-bg-secondary)]
          border
          border-[var(--color-border-default)]
          shadow-2xl
          overflow-hidden
          animate-[modal-slide-up_0.2s_ease-out]
          flex flex-col
          h-[100dvh] max-h-[100dvh] rounded-none
          sm:rounded-lg sm:max-h-[80dvh] sm:h-auto
        `}
        style={{
          "margin-top": "var(--safe-area-top, 0px)",
          "max-height": "calc(100dvh - var(--safe-area-top, 0px))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <Show when={props.title || showCloseButton()}>
          <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)] flex-shrink-0">
            <Show when={props.title}>
              <h2 class="heading-5 text-[var(--color-text-primary)]">{props.title}</h2>
            </Show>
            <Show when={showCloseButton()}>
              <IconButton
                icon="close"
                variant="ghost"
                onClick={props.onClose}
                aria-label="close dialog"
              />
            </Show>
          </div>
        </Show>

        {/* content */}
        <div class="p-6 overflow-y-auto flex-1 min-h-0">{props.children}</div>
      </div>
    </dialog>
  );
}

// hook for managing modal state
export function useModal() {
  const [isOpen, setIsOpen] = createSignal(false);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const toggle = () => setIsOpen(!isOpen());

  return {
    isOpen,
    open,
    close,
    toggle,
  };
}
