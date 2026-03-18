import { Toast as KobalteToast, toaster } from "@kobalte/core/toast";
import { createSignal, Show, type JSX } from "solid-js";
import { solidColors } from "../../design-system/colors";
import { Icon } from "../icons/registry";

export type ToastVariant = "success" | "error" | "warning" | "info";

// track active toasts by title to consolidate duplicates
// key = "variant:title", value = { id, setMessage }
const activeToasts = new Map<string, { id: number; setMessage: (m: string) => void }>();

const DEFAULT_DURATION = 5000;

export interface ToastOptions {
  /** title shown above the message */
  title?: string;
  /** duration in milliseconds before auto-dismiss (default: 5000) */
  duration?: number;
  /** whether the toast should not auto-dismiss */
  persistent?: boolean;
}

interface ToastItemProps {
  toastId: number;
  variant: ToastVariant;
  message: string;
  title?: string;
  duration?: number;
  persistent?: boolean;
  onMessageChange?: (setter: (m: string) => void) => void;
}

/**
 * individual toast component
 */
function ToastItem(props: ToastItemProps) {
  const [message, setMessage] = createSignal(props.message);

  // register the message setter so we can update this toast's message
  props.onMessageChange?.(setMessage);

  const variantConfig = () => {
    switch (props.variant) {
      case "success":
        return { icon: "check" as const, colors: solidColors.success };
      case "error":
        return { icon: "alertTriangle" as const, colors: solidColors.error };
      case "warning":
        return { icon: "alertTriangle" as const, colors: solidColors.warning };
      case "info":
        return { icon: "info" as const, colors: solidColors.info };
    }
  };

  return (
    <KobalteToast
      toastId={props.toastId}
      duration={props.duration}
      persistent={props.persistent}
      class="toast pointer-events-auto"
    >
      <div
        class="flex items-start gap-3 p-4 rounded-t-lg shadow-lg border-t-1 min-w-[320px] max-w-[420px]"
        style={{
          "background-color": `${variantConfig().colors.bg}`,
          "border-color": `${variantConfig().colors.border}`,
          color: `${variantConfig().colors.text}`,
        }}
      >
        {/* icon */}
        <div class="flex-shrink-0 pt-0.5">
          <Icon name={variantConfig().icon} size={20} color={variantConfig().colors.text} />
        </div>

        {/* content */}
        <div class="flex-1 min-w-0">
          <Show when={props.title}>
            <KobalteToast.Title class="font-semibold text-sm mb-1">
              {props.title}
            </KobalteToast.Title>
          </Show>
          <KobalteToast.Description class="text-sm">{message()}</KobalteToast.Description>
        </div>

        {/* close button */}
        <KobalteToast.CloseButton class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer">
          <Icon name="close" size={16} color={variantConfig().colors.text} />
        </KobalteToast.CloseButton>
      </div>

      {/* progress bar */}
      <Show when={!props.persistent}>
        <KobalteToast.ProgressTrack class="h-1 w-full bg-[var(--color-bg-tertiary)] overflow-hidden rounded-b-lg">
          <KobalteToast.ProgressFill
            class="h-full transition-all duration-[250ms] linear"
            style={{
              "background-color": variantConfig().colors.bg,
              width: "var(--kb-toast-progress-fill-width)",
            }}
          />
        </KobalteToast.ProgressTrack>
      </Show>
    </KobalteToast>
  );
}

/**
 * toast region component - place once in app layout
 *
 * usage:
 * ```tsx
 * import { Portal } from "solid-js/web";
 * import { ToastRegion } from "./Toast";
 *
 * function App() {
 *   return (
 *     <>
 *       {/* app content *\/}
 *       <Portal>
 *         <ToastRegion />
 *       </Portal>
 *     </>
 *   );
 * }
 * ```
 */
export function ToastRegion() {
  return (
    <KobalteToast.Region
      duration={5000}
      limit={3}
      swipeDirection="right"
      swipeThreshold={50}
      pauseOnInteraction={true}
      pauseOnPageIdle={true}
    >
      <KobalteToast.List class="fixed top-0 right-0 z-[2000] flex flex-col gap-2 p-4">
        {/* toasts will be rendered here */}
      </KobalteToast.List>
    </KobalteToast.Region>
  );
}

/**
 * toast API for showing notifications
 *
 * toasts with the same title consolidate automatically - if you show a toast
 * with a title that's already visible, the message updates instead of stacking.
 *
 * usage:
 * ```tsx
 * import { toast } from "./Toast";
 *
 * // simple success message
 * toast.success("song added to queue");
 *
 * // with title (title is used for deduplication)
 * toast.error("connection lost", { title: "error" });
 *
 * // these will consolidate into one toast, updating the message:
 * toast.info("syncing 1/3...", { title: "sync" });
 * toast.info("syncing 2/3...", { title: "sync" });
 * toast.info("syncing 3/3...", { title: "sync" });
 * ```
 */

// helper to show a toast, consolidating with existing if same title
function showToast(variant: ToastVariant, message: string, options?: ToastOptions): number {
  const key = `${variant}:${options?.title ?? ""}`;
  const existing = activeToasts.get(key);

  // if toast with same variant+title exists, just update its message
  if (existing) {
    existing.setMessage(message);
    return existing.id;
  }

  // reserve the key immediately to prevent race conditions
  const placeholder = { id: -1, setMessage: () => {} };
  activeToasts.set(key, placeholder);

  const id = toaster.show((props) => (
    <ToastItem
      toastId={props.toastId}
      variant={variant}
      message={message}
      title={options?.title}
      duration={options?.duration ?? DEFAULT_DURATION}
      persistent={options?.persistent}
      onMessageChange={(setter) => {
        // update with real setter
        activeToasts.set(key, { id, setMessage: setter });
      }}
    />
  ));

  // update placeholder with real id
  placeholder.id = id;

  // cleanup tracking when toast is dismissed
  const checkInterval = setInterval(() => {
    const el = document.querySelector(`[data-kb-toast-id="${id}"]`);
    if (!el) {
      activeToasts.delete(key);
      clearInterval(checkInterval);
    }
  }, 500);

  return id;
}

// track custom toasts by key for consolidation (id + message setter)
const customToasts = new Map<string, { id: number; setMessage: (m: string) => void }>();

export const toast = {
  /** show a success toast (green) */
  success(message: string, options?: ToastOptions) {
    return showToast("success", message, options);
  },

  /** show an error toast (red) */
  error(message: string, options?: ToastOptions) {
    return showToast("error", message, options);
  },

  /** show a warning toast (yellow) */
  warning(message: string, options?: ToastOptions) {
    return showToast("warning", message, options);
  },

  /** show an info toast (blue) */
  info(message: string, options?: ToastOptions) {
    return showToast("info", message, options);
  },

  /** dismiss a specific toast by id */
  dismiss(id: number) {
    return toaster.dismiss(id);
  },

  /** clear all toasts */
  clear() {
    activeToasts.clear();
    customToasts.clear();
    return toaster.clear();
  },

  /**
   * show a custom toast component with message updates
   * if key already exists, updates the message instead of creating new toast
   */
  custom(
    component: (props: { toastId: number; message: () => string }) => JSX.Element,
    options: { key: string; message: string }
  ) {
    const { key, message } = options;
    const existing = customToasts.get(key);

    // if toast already exists, just update its message
    if (existing) {
      existing.setMessage(message);
      return existing.id;
    }

    // create signal for reactive message updates
    const [getMessage, setMessage] = createSignal(message);

    const id = toaster.show((props) => component({ ...props, message: getMessage }));

    customToasts.set(key, { id, setMessage });

    return id;
  },
};
