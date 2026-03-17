// modal that appears when connecting to a remote server takes more than 1 second
// shows a spinner and connection info, with option to cancel

import { createEffect, Show } from "solid-js";
import { Icon } from "../icons";

export interface ConnectionProgressState {
  isConnecting: boolean;
  remoteName: string;
  remoteUrl?: string;
  showAfterDelay?: boolean; // only show if this is true (set after 1s delay)
}

export interface ConnectionProgressModalProps {
  state: ConnectionProgressState;
  onCancel: () => void;
}

export function ConnectionProgressModal(props: ConnectionProgressModalProps) {
  let dialogRef: HTMLDialogElement | undefined;

  // sync with dialog state
  createEffect(() => {
    if (!dialogRef) return;

    const shouldShow = props.state.isConnecting && props.state.showAfterDelay;

    if (shouldShow && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!shouldShow && dialogRef.open) {
      dialogRef.close();
    }
  });

  // prevent escape key from closing (must click cancel)
  const handleCancel = (e: Event) => {
    e.preventDefault();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      class="bg-transparent p-0 max-w-none max-h-none m-auto backdrop:bg-black/60"
    >
      <div
        class="
          max-w-sm
          w-full
          bg-[var(--color-bg-secondary)]
          border
          border-[var(--color-border-default)]
          rounded-lg
          shadow-2xl
          overflow-hidden
          animate-[fade-in_0.3s_ease-out]
        "
      >
        {/* header */}
        <div class="flex items-center justify-between p-4 border-b border-[var(--color-border-default)]">
          <h2 class="heading-5 text-[var(--color-text-primary)]">connecting</h2>
          <button
            onClick={props.onCancel}
            class="p-1 rounded-md hover:bg-[var(--color-bg-tertiary)] transition-colors"
            aria-label="cancel connection"
          >
            <Icon name="close" size={18} color="var(--color-text-secondary)" />
          </button>
        </div>

        {/* content */}
        <div class="p-6 flex flex-col items-center gap-4">
          {/* spinner */}
          <div class="flex items-center justify-center">
            <Icon
              name="loader"
              size={32}
              color="var(--color-accent-500)"
              className="animate-spin"
            />
          </div>

          {/* connection info */}
          <div class="text-center">
            <p class="text-[var(--color-text-primary)] font-medium">{props.state.remoteName}</p>
            <Show when={props.state.remoteUrl}>
              <p class="text-[var(--color-text-muted)] text-sm mt-1 break-all max-w-xs">
                {props.state.remoteUrl}
              </p>
            </Show>
          </div>

          {/* status message */}
          <p class="text-[var(--color-text-secondary)] text-sm">waiting for response...</p>
        </div>
      </div>
    </dialog>
  );
}
