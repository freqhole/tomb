// loading bar component — horizontal indeterminate progress bar
// extracted from queue sidebar song loading indicator

import { Show } from "solid-js";

export interface LoadingBarProps {
  /** width of the bar container (default: "100%") */
  width?: string;
  /** height of the bar (default: 2px) */
  height?: number;
  /** optional progress value 0-1 (if provided, shows determinate progress instead of bouncing) */
  progress?: number;
  /** custom class name */
  class?: string;
}

/**
 * horizontal loading bar with gradient animation.
 * shows indeterminate "bounce" animation by default,
 * or determinate progress if `progress` prop is provided.
 */
export function LoadingBar(props: LoadingBarProps) {
  const hasProgress = () => typeof props.progress === "number" && props.progress >= 0;

  return (
    <div
      class={`overflow-hidden rounded-full ${props.class ?? ""}`}
      style={{
        width: props.width ?? "100%",
        height: `${props.height ?? 2}px`,
        background: "rgba(168, 85, 247, 0.2)",
      }}
    >
      <div
        style={{
          width: hasProgress() ? `${Math.min((props.progress ?? 0) * 100, 100)}%` : "100%",
          height: "100%",
          background: "linear-gradient(90deg, #a855f7 0%, #d946ef 50%, #ec4899 100%)",
          animation: hasProgress() ? undefined : "bounce-bar 2s ease-in-out infinite",
          "border-radius": "9999px",
          transition: hasProgress() ? "width 150ms ease-out" : undefined,
        }}
      />
    </div>
  );
}

export interface LoadingStateProps {
  /** text to show (default: "loading...") */
  text?: string;
  /** show the loading bar below text */
  showBar?: boolean;
  /** custom class for container */
  class?: string;
}

/**
 * loading state with centered text and optional loading bar.
 * used for initial loading of views (songs, albums, artists, etc.)
 */
export function LoadingState(props: LoadingStateProps) {
  return (
    <div
      class={`flex flex-col items-center justify-center gap-3 ${props.class ?? ""}`}
      style={{ "min-height": "120px" }}
    >
      <div class="text-[var(--color-text-secondary)] text-sm">{props.text ?? "loading..."}</div>
      <Show when={props.showBar !== false}>
        <LoadingBar width="120px" height={3} />
      </Show>
    </div>
  );
}
