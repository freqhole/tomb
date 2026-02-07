// metadata display - shows a JSON object in a nice definition list format
import { For, Show } from "solid-js";

interface MetadataDisplayProps {
  /** JSON string or object to display */
  data: string | object | null | undefined;
  /** optional title for the section */
  title?: string;
}

type MetadataValue = string | number | boolean | null | object | MetadataValue[];

/** recursively render a value */
function renderValue(value: MetadataValue, depth: number = 0): any {
  if (value === null || value === undefined) {
    return <span class="text-[var(--color-text-tertiary)] italic">null</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span class={value ? "text-[var(--color-success-500)]" : "text-[var(--color-text-tertiary)]"}>
        {value ? "yes" : "no"}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span class="text-[var(--color-accent-500)] font-mono">{value.toLocaleString()}</span>;
  }

  if (typeof value === "string") {
    // check if it's a URL
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          class="text-[var(--color-accent-500)] hover:underline break-all"
        >
          {value}
        </a>
      );
    }
    return <span class="text-[var(--color-text-primary)] break-words">{value}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span class="text-[var(--color-text-tertiary)] italic">empty array</span>;
    }
    return (
      <ul class="list-disc list-inside pl-2 space-y-0.5">
        <For each={value}>
          {(item) => (
            <li class="text-[var(--color-text-primary)]">{renderValue(item, depth + 1)}</li>
          )}
        </For>
      </ul>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span class="text-[var(--color-text-tertiary)] italic">empty object</span>;
    }
    return (
      <dl class={depth > 0 ? "pl-4 border-l border-[var(--color-border-default)]" : ""}>
        <For each={entries}>
          {([key, val]) => (
            <>
              <dt class="text-sm text-[var(--color-text-secondary)] mt-2 first:mt-0">{key}</dt>
              <dd class="ml-0">{renderValue(val as MetadataValue, depth + 1)}</dd>
            </>
          )}
        </For>
      </dl>
    );
  }

  return <span class="text-[var(--color-text-primary)]">{String(value)}</span>;
}

export function MetadataDisplay(props: MetadataDisplayProps) {
  const parsedData = () => {
    if (!props.data) return null;
    if (typeof props.data === "string") {
      try {
        return JSON.parse(props.data);
      } catch {
        return { raw: props.data };
      }
    }
    return props.data;
  };

  return (
    <div class="space-y-4">
      <Show when={props.title}>
        <h3 class="text-sm font-medium text-[var(--color-text-secondary)]">{props.title}</h3>
      </Show>

      <Show
        when={parsedData()}
        fallback={
          <div class="text-sm text-[var(--color-text-tertiary)] italic py-4 text-center">
            no metadata available
          </div>
        }
      >
        <div>{renderValue(parsedData())}</div>
      </Show>
    </div>
  );
}
