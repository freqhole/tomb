/* @jsxImportSource solid-js */
import { createSignal, For, Show } from "solid-js";

export interface StarRatingProps {
  rating?: number | null;
  onRatingChange?: (rating: number) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  readonly?: boolean;
  class?: string;
}

/**
 * interactive star rating component for freqhole view
 * supports 1-5 star rating with hover effects
 */
export function StarRating(props: StarRatingProps) {
  const [hoveredRating, setHoveredRating] = createSignal<number | null>(null);

  const rating = () => props.rating || 0;
  const size = () => props.size || "md";
  const readonly = () => props.readonly || false;
  const disabled = () => props.disabled || false;

  const getSizeClass = () => {
    switch (size()) {
      case "sm":
        return "w-3 h-3";
      case "lg":
        return "w-6 h-6";
      default:
        return "w-4 h-4";
    }
  };

  const getStarClass = (star: number) => {
    const hovered = hoveredRating();
    const activeRating = hovered !== null ? hovered : rating();

    const baseClass = `${getSizeClass()} transition-colors cursor-pointer`;

    if (disabled()) {
      return `${baseClass} text-gray-600 cursor-not-allowed`;
    }

    if (readonly()) {
      return `${baseClass} cursor-default ${
        star <= activeRating ? "text-magenta-400" : "text-gray-600"
      }`;
    }

    return `${baseClass} ${
      star <= activeRating
        ? "text-magenta-400"
        : "text-gray-600 hover:text-magenta-300"
    }`;
  };

  const handleStarClick = (star: number) => {
    if (disabled() || readonly()) return;

    props.onRatingChange?.(star);
  };

  const handleMouseEnter = (star: number) => {
    if (disabled() || readonly()) return;
    setHoveredRating(star);
  };

  const handleMouseLeave = () => {
    if (disabled() || readonly()) return;
    setHoveredRating(null);
  };

  return (
    <div
      class={`flex items-center space-x-1 group ${props.class || ""}`}
      onMouseLeave={handleMouseLeave}
    >
      <For each={[1, 2, 3, 4, 5]}>
        {(star) => (
          <button
            type="button"
            disabled={disabled()}
            class={getStarClass(star)}
            onClick={(e) => {
              e.stopPropagation();
              handleStarClick(star);
            }}
            onMouseEnter={() => handleMouseEnter(star)}
            title={
              readonly()
                ? `rated ${star} star${star !== 1 ? "s" : ""}`
                : `rate ${star} star${star !== 1 ? "s" : ""}`
            }
          >
            <svg fill="currentColor" viewBox="0 0 24 24" class="w-full h-full">
              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          </button>
        )}
      </For>

      <Show when={rating() > 0 && !readonly()}>
        <button
          type="button"
          class="ml-2 text-gray-500 hover:text-red-400 text-sm transition-colors opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled()) {
              props.onRatingChange?.(0);
            }
          }}
          title="clear rating"
        >
          ×
        </button>
      </Show>
    </div>
  );
}
