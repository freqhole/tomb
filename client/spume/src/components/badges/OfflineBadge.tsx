import { Show } from "solid-js";

export function OfflineBadge(props: { isOffline?: boolean }) {
  return (
    <Show when={props.isOffline}>
      <span
        class="px-2 py-0.5 rounded text-xs flex-shrink-0 border border-[var(--color-border-default)] text-[var(--color-text-muted)]"
        title="media is on offline storage"
      >
        offline
      </span>
    </Show>
  );
}
