import type { JSX } from "solid-js";
import {
  // useStore,
  useReactiveActions,
  useSort,
} from "../../views/freqhole/store";

interface DefaultSortToggleProps {
  class?: string;
}

export function DefaultSortToggle(props: DefaultSortToggleProps): JSX.Element {
  // const [store] = useStore();
  const reactiveActions = useReactiveActions();

  // const reactiveActions = useReactiveActions();
  const [sortState] = useSort(); // Uses current navigation view's sort state

  const handleToggle = () => {
    reactiveActions.setSort(
      sortState.field,
      sortState.direction === "asc" ? "desc" : "asc"
    );
  };

  return (
    <button
      class={`
        flex items-center justify-center w-full h-full transition-colors
        ${sortState.direction === "desc" ? "text-magenta-500" : "text-gray-400 hover:text-white"}
        ${props.class || ""}
      `}
      onClick={handleToggle}
      title={sortState.direction === "asc" ? "desc" : "asc"}
    >
      #
    </button>
  );
}
