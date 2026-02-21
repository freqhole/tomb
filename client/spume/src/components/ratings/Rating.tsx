import { createEffect, createMemo, createSignal, For } from "solid-js";
import { canSetRating } from "../../music/data/permissions";

export interface RatingProps {
  rating?: number | null;
  onRatingChange?: (rating: number) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  class?: string;
  selected?: boolean;
}

// compact rating component with 5 vertical bars
// click cycles through 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0
// automatically disabled if user doesn't have permission to rate
export function Rating(props: RatingProps) {
  const [isUpdating, setIsUpdating] = createSignal(false);
  const [localRating, setLocalRating] = createSignal(props.rating ?? 0);

  // sync props to local state whenever rating changes from parent
  createEffect(() => {
    const propRating = props.rating ?? 0;
    // only update if we're not in the middle of updating
    // and the prop value is different from local state
    if (!isUpdating() && propRating !== localRating()) {
      setLocalRating(propRating);
    }
  });

  const rating = () => localRating();

  const size = () => props.size || "md";
  const disabled = () => props.disabled || !canSetRating();

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

    const currentRating = localRating();
    const nextRating = currentRating >= 5 ? 0 : currentRating + 1;

    // update local state immediately for responsiveness
    setLocalRating(nextRating);

    if (props.onRatingChange) {
      setIsUpdating(true);
      try {
        await props.onRatingChange(nextRating);
      } catch (error) {
        // revert on error
        setLocalRating(currentRating);
        console.error("failed to update rating:", error);
      } finally {
        setIsUpdating(false);
      }
    }
  };

  const fillColor = createMemo(() =>
    props.selected ? "var(--color-text-secondary)" : "var(--color-accent-500)",
  );
  const emptyColor = createMemo(() =>
    props.selected ? "var(--color-bg-elevated)" : "var(--color-text-muted)",
  );

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
          <For each={[1, 2, 3, 4, 5]}>
            {(barIndex) => (
              <div
                class="flex-1 rounded-sm transition-all duration-200"
                style={{
                  height: `${(barIndex / 5) * 100}%`,
                  "background-color":
                    rating() >= barIndex ? fillColor() : emptyColor(),
                }}
              />
            )}
          </For>
        </div>
      </button>
    </div>
  );
}
