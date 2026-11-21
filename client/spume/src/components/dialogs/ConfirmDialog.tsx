import { Show, type JSX } from "solid-js";
import { Button } from "../buttons/Button";
import { Alert } from "../feedback/Alert";
import { Modal } from "../overlays/Modal";

export interface ConfirmDialogProps {
  /** whether the dialog is open */
  isOpen: boolean;
  /** callback when dialog is closed */
  onClose: () => void;
  /** callback when confirmed */
  onConfirm: () => void;
  /** dialog title */
  title?: string;
  /** dialog message */
  message: string | JSX.Element;
  /** confirm button text */
  confirmText?: string;
  /** cancel button text */
  cancelText?: string;
  /** variant for the confirm button */
  variant?: "primary" | "secondary" | "danger";
  cancelVariant?: "ghost" | "danger";
  cancelLast?: boolean;
  /** whether the confirm action is loading */
  loading?: boolean;
  /** optional alert variant to show message in alert style */
  alertVariant?: "info" | "warning" | "error" | "success";
}

// confirmation dialog component for destructive or important actions
export function ConfirmDialog(props: ConfirmDialogProps) {
  const title = () => props.title || "confirm action";
  const confirmText = () => props.confirmText || "confirm";
  const cancelText = () => props.cancelText || "cancel";
  const variant = () => props.variant || "primary";

  const handleConfirm = () => {
    props.onConfirm();
    if (!props.loading) {
      props.onClose();
    }
  };
  const cancelButton = () => (
    <Button
      variant={props.cancelVariant ?? "ghost"}
      onClick={props.onClose}
      disabled={props.loading}
    >
      {cancelText()}
    </Button>
  );

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={title()}
      showCloseButton={false}
    >
      <div class="space-y-6">
        <Show
          when={props.alertVariant}
          fallback={
            <div class="body-sm text-[var(--color-text-secondary)]">
              {props.message}
            </div>
          }
        >
          <Alert variant={props.alertVariant}>{props.message}</Alert>
        </Show>

        <div class="flex gap-3 justify-end">
          <Show when={!props.cancelLast}>{cancelButton()}</Show>
          <Button
            variant={variant()}
            onClick={handleConfirm}
            disabled={props.loading}
          >
            {props.loading ? "processing..." : confirmText()}
          </Button>
          <Show when={props.cancelLast}>{cancelButton()}</Show>
        </div>
      </div>
    </Modal>
  );
}
