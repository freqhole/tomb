/* @jsxImportSource solid-js */
import { createSignal, createEffect } from "solid-js";

export interface StarRatingCompactProps {
  rating?: number | null;
  onRatingChange?: (rating: number) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  class?: string;
  selected?: boolean;
}

/**
 * Compact rating component with 5 vertical bars
 * Click cycles through 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0
 */
export function StarRatingCompact(props: StarRatingCompactProps) {
  const [isUpdating, setIsUpdating] = createSignal(false);
  const [localRating, setLocalRating] = createSignal(props.rating ?? 0);
  const [hasInitialized, setHasInitialized] = createSignal(false);

  // Only sync props to local state on first load, not during user interactions
  createEffect(() => {
    if (!hasInitialized()) {
      setLocalRating(props.rating ?? 0);
      setHasInitialized(true);
    }
  });

  const rating = () => localRating();

  const size = () => props.size || "md";
  const disabled = () => props.disabled || false;

  const getSizeClass = () => {
    switch (size()) {
      case "sm":
        return "w-6 h-4";
      case "lg":
        return "w-12 h-8";
      default:
        return "w-8 h-6";
    }
  };

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (disabled() || isUpdating()) return;

    const currentRating = rating();
    const nextRating = currentRating >= 5 ? 0 : currentRating + 1;

    // Update local state immediately for responsiveness
    setLocalRating(nextRating);

    if (props.onRatingChange) {
      setIsUpdating(true);
      try {
        await props.onRatingChange(nextRating);
      } catch (error) {
        // Revert on error
        setLocalRating(currentRating);
        console.error("Failed to update rating:", error);
      } finally {
        setIsUpdating(false);
      }
    }
  };
  const fillColor = props.selected ? "#eeddee" : "#d946ef";
  const emptyColor = props.selected ? "#333333" : "#6b7280";

  return (
    <div class={`inline-flex items-center ${props.class || ""}`}>
      <button
        type="button"
        disabled={disabled() || isUpdating()}
        onClick={handleClick}
        class={`${getSizeClass()} transition-all ${
          disabled() || isUpdating()
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:scale-110"
        }`}
        title={
          rating() === 0
            ? "unrated - click to rate"
            : `${rating()} star${rating() !== 1 ? "s" : ""} - click to change`
        }
      >
        <div class="flex items-end justify-center gap-0.5 w-full h-full">
          {[1, 2, 3, 4, 5].map((barIndex) => (
            <div
              class="flex-1 rounded-sm transition-all duration-200"
              style={{
                height: `${(barIndex / 5) * 100}%`,
                "background-color":
                  rating() >= barIndex ? fillColor : emptyColor,
                opacity: rating() >= barIndex ? "0.9" : "0.3",
              }}
            />
          ))}
        </div>
      </button>
    </div>
  );
}
