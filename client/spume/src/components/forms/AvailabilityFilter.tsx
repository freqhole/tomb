import { Badge } from "../badges/Badge";

export function AvailabilityFilter(props: { onSelect: () => void }) {
  return (
    <button
      type="button"
      class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] rounded transition-colors"
      onClick={() => props.onSelect()}
    >
      show offline
    </button>
  );
}

export function AvailabilityFilterChip(props: { onRemove: () => void }) {
  return (
    <Badge
      variant="success"
      size="sm"
      removable
      onRemove={() => props.onRemove()}
    >
      show offline
    </Badge>
  );
}
