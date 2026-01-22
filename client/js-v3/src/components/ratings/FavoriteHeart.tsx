import { Show } from "solid-js";

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

  const getSizeClass = () => {
    switch (size()) {
      case "sm":
        return "w-5 h-5";
      case "lg":
        return "w-8 h-8";
      default:
        return "w-6 h-6";
    }
  };

  const getHeartClass = () => {
    const baseClass = `${getSizeClass()} transition-all duration-200`;

    if (disabled()) {
      return `${baseClass} text-[var(--color-text-disabled)] cursor-not-allowed`;
    }

    if (readonly()) {
      return `${baseClass} cursor-default ${
        isFavorite()
          ? "text-[var(--color-accent-500)]"
          : "text-[var(--color-text-disabled)]"
      }`;
    }

    return `${baseClass} cursor-pointer hover:scale-110 ${
      isFavorite()
        ? "text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)]"
        : "text-[var(--color-text-muted)] hover:text-[var(--color-accent-500)]"
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
        handleToggle();
      }}
      title={getTitle()}
    >
      <Show
        when={isFavorite()}
        fallback={
          <svg
            class={getHeartClass()}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        }
      >
        <svg class={getHeartClass()} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      </Show>
    </button>
  );
}
