// loading more indicator — debounced floating indicator for infinite scroll lists
// positioned at bottom center, animates in/out with fade + slide

import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { LoadingBar } from "./LoadingBar";

export interface LoadingMoreIndicatorProps {
  /** whether loading is in progress */
  isLoading: boolean;
  /** debounce delay in ms before showing indicator (default: 750ms) */
  debounceMs?: number;
  /** text to display (default: "loading more...") */
  text?: string;
}

/**
 * floating loading indicator for infinite scroll containers.
 * - only appears after debounce delay to avoid flicker on fast loads
 * - positioned at bottom center of parent (parent should be relative)
 * - fades + slides in from bottom, out to bottom
 */
export function LoadingMoreIndicator(props: LoadingMoreIndicatorProps) {
  const [shouldShow, setShouldShow] = createSignal(false);
  const [isVisible, setIsVisible] = createSignal(false);
  let showTimeoutId: number | undefined;
  let hideTimeoutId: number | undefined;

  // debounce showing the indicator
  createEffect(
    on(
      () => props.isLoading,
      (loading) => {
        // clear any pending timers
        if (showTimeoutId) {
          clearTimeout(showTimeoutId);
          showTimeoutId = undefined;
        }
        if (hideTimeoutId) {
          clearTimeout(hideTimeoutId);
          hideTimeoutId = undefined;
        }

        if (loading) {
          // delay showing by debounce amount
          const delay = props.debounceMs ?? 750;
          showTimeoutId = window.setTimeout(() => {
            setShouldShow(true);
            // small delay to allow DOM to render before triggering animation
            requestAnimationFrame(() => {
              setIsVisible(true);
            });
          }, delay);
        } else {
          // immediately start fade out
          setIsVisible(false);
          // remove from DOM after animation completes
          hideTimeoutId = window.setTimeout(() => {
            setShouldShow(false);
          }, 300); // matches animation duration
        }
      }
    )
  );

  onCleanup(() => {
    if (showTimeoutId) clearTimeout(showTimeoutId);
    if (hideTimeoutId) clearTimeout(hideTimeoutId);
  });

  return (
    <Show when={shouldShow()}>
      <div
        class="loading-more-indicator"
        style={{
          position: "fixed",
          bottom: "96px", // above player bar
          left: "50%",
          transform: isVisible()
            ? "translateX(-50%) translateY(0)"
            : "translateX(-50%) translateY(20px)",
          opacity: isVisible() ? 1 : 0,
          transition: "opacity 300ms ease-out, transform 300ms ease-out",
          "z-index": 40,
          "pointer-events": "none",
        }}
      >
        <div
          style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-subtle)",
            "border-radius": "9999px",
            padding: "8px 16px",
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            gap: "6px",
            "box-shadow": "0 4px 12px rgba(0, 0, 0, 0.3)",
            "min-width": "140px",
          }}
        >
          <span
            style={{
              "font-size": "12px",
              color: "var(--color-text-secondary)",
              "white-space": "nowrap",
            }}
          >
            {props.text ?? "loading more..."}
          </span>
          <LoadingBar width="100px" height={3} />
        </div>
      </div>
    </Show>
  );
}
