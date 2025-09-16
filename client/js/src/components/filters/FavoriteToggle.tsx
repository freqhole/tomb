import type { JSX } from "solid-js";
import { useStore, useReactiveActions } from "../../views/freqhole/store";

interface FavoriteToggleProps {
  class?: string;
}

export function FavoriteToggle(props: FavoriteToggleProps): JSX.Element {
  const [store] = useStore();
  const reactiveActions = useReactiveActions();

  const handleToggle = () => {
    const currentState = store.filters.favoritesOnly;
    console.log(
      "favorites toggle clicked - current state:",
      currentState,
      "toggling to:",
      !currentState
    );
    reactiveActions.setFavoritesFilter(!currentState);
    console.log("after toggle - new state:", store.filters.favoritesOnly);
  };

  return (
    <button
      class={`
        flex items-center justify-center w-full h-full transition-colors
        ${store.filters.favoritesOnly ? "text-magenta-500" : "text-gray-400 hover:text-white"}
        ${props.class || ""}
      `}
      onClick={handleToggle}
      title={
        store.filters.favoritesOnly ? "show all songs" : "show favorites only"
      }
    >
      {store.filters.favoritesOnly ? (
        // filled heart when active
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ) : (
        // outlined heart when inactive
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      )}
    </button>
  );
}
