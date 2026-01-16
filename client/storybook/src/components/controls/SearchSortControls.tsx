export interface SortField {
  value: string;
  label: string;
  description?: string;
}

export interface SearchSortControlsProps {
  /** current sort field */
  sortBy?: string;
  /** current sort direction */
  sortDirection?: "asc" | "desc";
  /** callback when sort field changes */
  onSortByChange?: (field: string) => void;
  /** callback when sort direction changes */
  onSortDirectionChange?: (direction: "asc" | "desc") => void;
  /** callback when both sort field and direction change */
  onSortChange?: (field: string, direction: "asc" | "desc") => void;
  /** available sort fields */
  sortFields: SortField[];
  /** additional css classes */
  class?: string;
  /** whether the controls are disabled */
  disabled?: boolean;
  /** show direction as arrows or text */
  directionStyle?: "arrows" | "text";
}

export function SearchSortControls(props: SearchSortControlsProps) {
  const currentSortBy = () => props.sortBy || props.sortFields[0]?.value || "";
  const currentDirection = () => props.sortDirection || "desc";

  const handleSortByChange = (field: string) => {
    if (props.onSortByChange) {
      props.onSortByChange(field);
    } else if (props.onSortChange) {
      props.onSortChange(field, currentDirection());
    }
  };

  const handleDirectionToggle = () => {
    const newDirection = currentDirection() === "asc" ? "desc" : "asc";
    if (props.onSortDirectionChange) {
      props.onSortDirectionChange(newDirection);
    } else if (props.onSortChange) {
      props.onSortChange(currentSortBy(), newDirection);
    }
  };

  const directionDisplay = () => {
    if (props.directionStyle === "text") {
      return currentDirection() === "asc" ? "ascending" : "descending";
    }
    return currentDirection() === "asc" ? "↑" : "↓";
  };

  return (
    <div class={`flex gap-2 items-center ${props.class || ""}`}>
      {/* sort field selector */}
      <select
        value={currentSortBy()}
        onChange={(e) => handleSortByChange(e.target.value)}
        disabled={props.disabled}
        class="px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]"
      >
        {props.sortFields.map((field) => (
          <option value={field.value} title={field.description}>
            {field.label}
          </option>
        ))}
      </select>

      {/* sort direction toggle */}
      <button
        onClick={handleDirectionToggle}
        disabled={props.disabled}
        class="px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] text-sm hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={`sort ${currentDirection() === "asc" ? "ascending" : "descending"} - click to toggle`}
      >
        {directionDisplay()}
      </button>
    </div>
  );
}

export default SearchSortControls;
