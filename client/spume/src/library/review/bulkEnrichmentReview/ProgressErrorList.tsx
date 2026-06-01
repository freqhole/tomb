import { For, Show } from "solid-js";
import { isFailed, sourceShort } from "./helpers";

// inline expandable error list — surfaces backend failure messages so
// the user can see *why* a source returned no candidates (e.g. mb api
// rate-limit, network error, mismatched artist/title).
export function ProgressErrorList(props: {
  progress: Array<{ source: string; status: string; last_error?: string | null }>;
}) {
  const errors = () => props.progress.filter((p) => p.last_error || isFailed(p.status));
  return (
    <Show when={errors().length > 0}>
      <details class="text-[10px] text-[var(--color-error-500)] mt-0.5">
        <summary class="cursor-pointer">
          {errors().length} enrichment error{errors().length === 1 ? "" : "s"} — click to show
        </summary>
        <ul class="mt-1 pl-3 flex flex-col gap-0.5">
          <For each={errors()}>
            {(p) => (
              <li>
                <span class="font-medium">{sourceShort(p.source)}</span>:
                <span class="opacity-90 break-all">{p.last_error || p.status}</span>
              </li>
            )}
          </For>
        </ul>
      </details>
    </Show>
  );
}
