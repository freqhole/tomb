import { Badge } from "../badges/Badge";

export function AvailabilityFilter(props: { onSelect: () => void }) {
  return (
    <button
      type="button"
      class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] rounded transition-colors"
      onClick={() => props.onSelect()}
    >
      hide offline
    </button>
  );
}

export function AvailabilityFilterChip(props: {
  hideOffline: boolean;
  onChange: (hide: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <Badge
      variant={props.hideOffline ? "success" : "outline"}
      size="sm"
      removable
      onRemove={() => props.onRemove()}
    >
      <button
        type="button"
        aria-pressed={props.hideOffline}
        onClick={() => props.onChange(!props.hideOffline)}
        title="hide offline (click to toggle)"
        class="cursor-pointer hover:opacity-90 transition-opacity border-none bg-transparent p-0"
      >
        hide offline
      </button>
    </Badge>
  );
}
