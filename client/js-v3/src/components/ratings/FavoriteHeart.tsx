import { Show } from "solid-js";

export interface FavoriteHeartProps {
  isFavorite?: boolean;
  onToggle?: (isFavorite: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  readonly?: boolean;
  class?: string;
}

// interactive heart favorite component
// supports toggle favorite state with visual feedback
export function FavoriteHeart(props: FavoriteHeartProps) {
  const isFavorite = () => props.isFavorite || false;
  const size = () => props.size || "md";
  const readonly = () => props.readonly || false;
  const disabled = () => props.disabled || false;

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
    if (disabled() || readonly()) return;
    props.onToggle?.(!isFavorite());
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
      title={
        readonly()
          ? isFavorite()
            ? "favorited"
            : "not favorited"
          : isFavorite()
            ? "remove from favorites"
            : "add to favorites"
      }
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
