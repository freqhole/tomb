import { Toast as KobalteToast, toaster } from "@kobalte/core/toast";
import { Show, type JSX } from "solid-js";
import { solidColors } from "../../design-system/colors";
import { Icon } from "../icons/registry";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  /** duration in milliseconds before auto-dismiss (default: 5000) */
  duration?: number;
  /** whether the toast should not auto-dismiss */
  persistent?: boolean;
}

interface ToastProps {
  toastId: number;
  variant: ToastVariant;
  message: string;
  title?: string;
  duration?: number;
  persistent?: boolean;
}

/**
 * individual toast component
 *
 * - renders with appropriate color and icon for variant
 * - progress bar shows remaining time
 * - close button
 * - swipe to dismiss
 */
function ToastItem(props: ToastProps) {
  const variantConfig = () => {
    switch (props.variant) {
      case "success":
        return {
          icon: "check" as const,
          colors: solidColors.success,
        };
      case "error":
        return {
          icon: "alertTriangle" as const,
          colors: solidColors.error,
        };
      case "warning":
        return {
          icon: "alertTriangle" as const,
          colors: solidColors.warning,
        };
      case "info":
        return {
          icon: "info" as const,
          colors: solidColors.info,
        };
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
          <KobalteToast.Description class="text-sm">{props.message}</KobalteToast.Description>
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
 * usage:
 * ```tsx
 * import { toast } from "./Toast";
 *
 * // simple success message
 * toast.success("song added to queue");
 *
 * // error with title
 * toast.error("failed to save playlist", { title: "error" });
 *
 * // custom duration
 * toast.info("processing...", { duration: 10000 });
 *
 * // persistent (no auto-dismiss)
 * toast.warning("important message", { persistent: true });
 * ```
 */
export const toast = {
  /**
   * show a success toast (green)
   */
  success(message: string, options?: ToastOptions & { title?: string }) {
    return toaster.show((props) => (
      <ToastItem
        toastId={props.toastId}
        variant="success"
        message={message}
        title={options?.title}
        duration={options?.duration}
        persistent={options?.persistent}
      />
    ));
  },

  /**
   * show an error toast (red)
   */
  error(message: string, options?: ToastOptions & { title?: string }) {
    return toaster.show((props) => (
      <ToastItem
        toastId={props.toastId}
        variant="error"
        message={message}
        title={options?.title}
        duration={options?.duration}
        persistent={options?.persistent}
      />
    ));
  },

  /**
   * show a warning toast (yellow)
   */
  warning(message: string, options?: ToastOptions & { title?: string }) {
    return toaster.show((props) => (
      <ToastItem
        toastId={props.toastId}
        variant="warning"
        message={message}
        title={options?.title}
        duration={options?.duration}
        persistent={options?.persistent}
      />
    ));
  },

  /**
   * show an info toast (blue)
   */
  info(message: string, options?: ToastOptions & { title?: string }) {
    return toaster.show((props) => (
      <ToastItem
        toastId={props.toastId}
        variant="info"
        message={message}
        title={options?.title}
        duration={options?.duration}
        persistent={options?.persistent}
      />
    ));
  },

  /**
   * dismiss a specific toast by id
   */
  dismiss(id: number) {
    return toaster.dismiss(id);
  },

  /**
   * clear all toasts
   */
  clear() {
    return toaster.clear();
  },

  /**
   * show a custom toast component
   */
  custom(component: (props: { toastId: number }) => JSX.Element) {
    return toaster.show(component);
  },
};
