import { createSignal, onCleanup } from "solid-js";

export interface DelayedLoadingConfig {
  /** Delay before showing loading indicator (ms) */
  showDelay?: number;
  /** Minimum time to show loading indicator once visible (ms) */
  minDuration?: number;
}

export interface DelayedLoadingReturn {
  /** Whether to show the loading indicator */
  showLoading: () => boolean;
  /** Start the delayed loading sequence */
  startLoading: () => void;
  /** Stop the loading and apply minimum duration if needed */
  stopLoading: () => void;
  /** Immediately clear all timers and hide loading */
  clearLoading: () => void;
}

/**
 * Hook for managing delayed loading states to prevent flashing UI
 *
 * Features:
 * - Only shows loading after a delay (default 500ms)
 * - Keeps loading visible for minimum duration once shown (default 500ms)
 * - Proper timer cleanup to prevent memory leaks
 * - Handles rapid start/stop cycles gracefully
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const delayedLoading = useDelayedLoading({ showDelay: 300, minDuration: 400 });
 *
 *   const handleAsyncOperation = async () => {
 *     delayedLoading.startLoading();
 *     try {
 *       await someAsyncTask();
 *     } finally {
 *       delayedLoading.stopLoading();
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <Show when={delayedLoading.showLoading()}>
 *         <div class="loading-spinner">Loading...</div>
 *       </Show>
 *       <button onClick={handleAsyncOperation}>Start Task</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @param config - Configuration for delays and durations
 * @returns Loading state and control functions
 */
export function useDelayedLoading(
  config: DelayedLoadingConfig = {}
): DelayedLoadingReturn {
  const showDelay = config.showDelay ?? 500;
  const minDuration = config.minDuration ?? 500;

  // === STATE ===
  const [showLoading, setShowLoading] = createSignal(false);
  const [loadingStartTime, setLoadingStartTime] = createSignal<number | null>(
    null
  );
  const [isActuallyLoading, setIsActuallyLoading] = createSignal(false);

  // === TIMER MANAGEMENT ===
  const [showDelayTimer, setShowDelayTimer] = createSignal<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [hideDelayTimer, setHideDelayTimer] = createSignal<ReturnType<
    typeof setTimeout
  > | null>(null);

  /**
   * Clear all active timers safely
   */
  const clearAllTimers = () => {
    const showTimer = showDelayTimer();
    const hideTimer = hideDelayTimer();

    if (showTimer) {
      clearTimeout(showTimer);
      setShowDelayTimer(null);
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      setHideDelayTimer(null);
    }
  };

  /**
   * Start the delayed loading sequence
   * Only shows loading indicator after the configured delay
   */
  const startLoading = () => {
    // Clear any existing timers first
    clearAllTimers();

    const startTime = Date.now();
    setLoadingStartTime(startTime);
    setIsActuallyLoading(true);
    setShowLoading(false); // Reset show state

    // Set timer to show loading after delay
    const timer = setTimeout(() => {
      // Double-check we're still loading and this is the same session
      if (isActuallyLoading() && loadingStartTime() === startTime) {
        setShowLoading(true);
      }
      setShowDelayTimer(null); // Clear timer reference
    }, showDelay);

    setShowDelayTimer(timer);
  };

  /**
   * Stop the loading sequence
   * Ensures minimum display duration if loading is already visible
   */
  const stopLoading = () => {
    const startTime = loadingStartTime();
    setIsActuallyLoading(false);

    // Clear the show delay timer if loading hasn't appeared yet
    const showTimer = showDelayTimer();
    if (showTimer) {
      clearTimeout(showTimer);
      setShowDelayTimer(null);
      // Loading was never shown, can exit immediately
      setShowLoading(false);
      setLoadingStartTime(null);
      return;
    }

    // If loading indicator is currently visible
    if (showLoading() && startTime) {
      const elapsed = Date.now() - startTime;
      const totalMinDuration = showDelay + minDuration;

      if (elapsed < totalMinDuration) {
        // Keep showing for remaining time
        const remainingTime = totalMinDuration - elapsed;
        const timer = setTimeout(() => {
          setShowLoading(false);
          setLoadingStartTime(null);
          setHideDelayTimer(null); // Clear timer reference
        }, remainingTime);

        setHideDelayTimer(timer);
      } else {
        // Can hide immediately
        setShowLoading(false);
        setLoadingStartTime(null);
      }
    } else {
      // Loading was never shown or no start time, just clean up
      setShowLoading(false);
      setLoadingStartTime(null);
    }
  };

  /**
   * Immediately clear all loading state and timers
   * Use this for cleanup or when you need to force-stop loading
   */
  const clearLoading = () => {
    clearAllTimers();
    setShowLoading(false);
    setLoadingStartTime(null);
    setIsActuallyLoading(false);
  };

  // === CLEANUP ===
  // Ensure all timers are cleaned up when component unmounts
  onCleanup(() => {
    clearLoading();
  });

  return {
    showLoading,
    startLoading,
    stopLoading,
    clearLoading,
  };
}

/**
 * Pre-configured hook for common loading scenarios
 */
export const useStandardDelayedLoading = () =>
  useDelayedLoading({ showDelay: 500, minDuration: 500 });

/**
 * Pre-configured hook for faster loading scenarios
 */
export const useFastDelayedLoading = () =>
  useDelayedLoading({ showDelay: 300, minDuration: 300 });

/**
 * Pre-configured hook for slower loading scenarios
 */
export const useSlowDelayedLoading = () =>
  useDelayedLoading({ showDelay: 800, minDuration: 600 });
