import { createUniqueId, type JSX, Show } from "solid-js";

export function Checkbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: JSX.Element;
}) {
  const id = createUniqueId();
  return (
    <label for={id} class="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
      <input
        id={id}
        type="checkbox"
        class="peer sr-only"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span
        aria-hidden="true"
        class="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--color-border-default)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-accent-500)] peer-disabled:opacity-40"
        classList={{
          "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]": props.checked,
        }}
      >
        <Show when={props.checked}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="m3 8 3 3 7-7" stroke="currentColor" stroke-width="2" />
          </svg>
        </Show>
      </span>
      {props.children}
    </label>
  );
}
