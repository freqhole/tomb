import { Show } from "solid-js";
import { FavoriteIcon, FavoriteStrokeIcon } from "../icons/registry";
import { hasBackgroundImage } from "../../app/services/backgroundImage";

export interface FavoriteHeartProps {
  /** whether item is favorited */
  isFavorite: boolean;
  /** callback when toggled (optional - if not provided, component is readonly) */
  onToggle?: (isFavorite: boolean) => void;
  /** whether toggle is disabled */
  disabled?: boolean;
  /** size variant */
  size?: "sm" | "md" | "lg";
  /** readonly mode - shows status but not interactive */
  readonly?: boolean;
  /** additional css classes */
  class?: string;
}

// presentational heart favorite component
// displays favorite status with optional toggle interaction
// for business logic integration, use FavoriteToggle instead
export function FavoriteHeart(props: FavoriteHeartProps) {
  const isFavorite = () => props.isFavorite;
  const size = () => props.size || "md";
  const readonly = () => props.readonly || false;
  const disabled = () => props.disabled || false;
  const isInteractive = () => !readonly() && !disabled() && props.onToggle;

  const getIconSize = () => {
    switch (size()) {
      case "sm":
        return 20;
      case "lg":
        return 32;
      default:
        return 24;
    }
  };

  const getHeartClass = () => {
    // over a background image the heart can land on anything from black to
    // white: a crisp unblurred dark edge keeps it legible on light art
    // without making it read heavier on dark art
    const baseClass = `transition-all duration-200 ${
      hasBackgroundImage() ? "[filter:drop-shadow(0_0_0.5px_rgb(0_0_0/0.6))]" : ""
    }`;

    if (disabled()) {
      return `${baseClass} text-[var(--color-text-disabled)] cursor-not-allowed`;
    }

    if (readonly()) {
      return `${baseClass} cursor-default ${
        isFavorite() ? "text-[var(--color-accent-500)]" : "text-[var(--color-text-disabled)]"
      }`;
    }

    return `${baseClass} cursor-pointer hover:scale-110 ${
      isFavorite()
        ? "text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)]"
        : `${
            hasBackgroundImage() ? "text-white/75" : "text-[var(--color-text-muted)]"
          } hover:text-[var(--color-accent-500)]`
    }`;
  };

  const handleToggle = () => {
    if (!isInteractive()) return;
    props.onToggle?.(!isFavorite());
  };

  const getTitle = () => {
    if (readonly()) {
      return isFavorite() ? "favorited" : "not favorited";
    }
    if (disabled()) {
      return "favorite action disabled";
    }
    return isFavorite() ? "remove from favorites" : "add to favorites";
  };

  return (
    <button
      type="button"
      disabled={disabled()}
      class={`p-1 transition-colors ${props.class || ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        handleToggle();
      }}
      title={getTitle()}
    >
      <Show
        when={isFavorite()}
        fallback={
          <span class={getHeartClass()}>
            <FavoriteStrokeIcon size={getIconSize()} strokeWidth={2.5} />
          </span>
        }
      >
        <span class={getHeartClass()}>
          <FavoriteIcon size={getIconSize()} />
        </span>
      </Show>
    </button>
  );
}
