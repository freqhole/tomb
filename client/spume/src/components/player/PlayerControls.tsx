import { Show } from "solid-js";
import { IconButton } from "../buttons/IconButton";

export interface PlayerControlsProps {
  /** whether audio is currently playing */
  isPlaying: boolean;
  /** callback when play/pause is clicked */
  onPlayPause: () => void;
  /** callback when previous is clicked */
  onPrevious: () => void;
  /** callback when next is clicked */
  onNext: () => void;
  /** callback when shuffle is clicked */
  onShuffle?: () => void;
  /** callback when repeat is clicked */
  onRepeat?: () => void;
  /** whether previous button is disabled */
  canGoPrevious?: boolean;
  /** whether next button is disabled */
  canGoNext?: boolean;
  /** whether shuffle is active */
  shuffleActive?: boolean;
  /** repeat mode: off, all, one */
  repeatMode?: "off" | "all" | "one";
  /** whether controls are disabled */
  disabled?: boolean;
  /** size of the controls */
  size?: "sm" | "default" | "lg";
  /** additional classes */
  class?: string;
}

// player control buttons component
export function PlayerControls(props: PlayerControlsProps) {
  const canGoPrevious = () => props.canGoPrevious ?? true;
  const canGoNext = () => props.canGoNext ?? true;
  const size = () => props.size || "default";

  const buttonSize = () => {
    switch (size()) {
      case "sm":
        return "sm" as const;
      case "lg":
        return "default" as const;
      default:
        return "default" as const;
    }
  };

  const iconSizes = () => {
    switch (size()) {
      case "sm":
        return { regular: 18, playPause: 22 };
      case "lg":
        return { regular: 24, playPause: 28 };
      default:
        return { regular: 20, playPause: 24 };
    }
  };

  return (
    <div class={`flex items-center gap-3 ${props.class || ""}`}>
      {/* shuffle button (optional) */}
      <Show when={props.onShuffle}>
        <IconButton
          icon="shuffle"
          onClick={props.onShuffle!}
          disabled={props.disabled}
          variant={props.shuffleActive ? "default" : "ghost"}
          size={buttonSize()}
          iconSize={iconSizes().regular}
          title="shuffle"
          aria-label="shuffle"
          class={
            props.shuffleActive
              ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
              : ""
          }
        />
      </Show>

      {/* previous button */}
      <IconButton
        icon="previous"
        onClick={props.onPrevious}
        disabled={props.disabled || !canGoPrevious()}
        variant="ghost"
        size={buttonSize()}
        iconSize={iconSizes().regular}
        title="previous"
        aria-label="previous"
      />

      {/* play/pause button */}
      <IconButton
        icon={props.isPlaying ? "pause" : "play"}
        onClick={props.onPlayPause}
        disabled={props.disabled}
        variant="default"
        size={buttonSize()}
        iconSize={iconSizes().playPause}
        title={props.isPlaying ? "pause" : "play"}
        aria-label={props.isPlaying ? "pause" : "play"}
        class="bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)]"
      />

      {/* next button */}
      <IconButton
        icon="next"
        onClick={props.onNext}
        disabled={props.disabled || !canGoNext()}
        variant="ghost"
        size={buttonSize()}
        iconSize={iconSizes().regular}
        title="next"
        aria-label="next"
      />

      {/* repeat button (optional) */}
      <Show when={props.onRepeat}>
        <IconButton
          icon={props.repeatMode === "one" ? "repeatOne" : "repeat"}
          onClick={props.onRepeat!}
          disabled={props.disabled}
          variant={props.repeatMode !== "off" ? "default" : "ghost"}
          size={buttonSize()}
          iconSize={iconSizes().regular}
          title={`repeat: ${props.repeatMode || "off"}`}
          aria-label={`repeat: ${props.repeatMode || "off"}`}
          class={
            props.repeatMode !== "off"
              ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
              : ""
          }
        />
      </Show>
    </div>
  );
}
