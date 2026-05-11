// inline header strip showing the current album-enrichment session.
// non-modal, slim, lives next to the view-switcher in the LibraryView
// header. fades in while a burst is active and lingers briefly with the
// final tally after the burst settles.
//
// shows aggregate progress across all three metadata sources
// (musicbrainz / last.fm / theaudiodb) plus a per-source breakdown.

import { Show, createMemo, For } from "solid-js";
import { Icon } from "../../components/icons/registry";
import {
  dismissMbSession,
  useMbSession,
  ENRICHMENT_SOURCES,
  type EnrichmentSource,
} from "../hooks/useMbLookupJobs";

const SOURCE_LABEL: Record<EnrichmentSource, string> = {
  mb: "musicbrainz",
  lastfm: "last.fm",
  audiodb: "theaudiodb",
};
const SOURCE_SHORT: Record<EnrichmentSource, string> = {
  mb: "mb",
  lastfm: "lf",
  audiodb: "ad",
};

export function MbProgressStrip() {
  const session = useMbSession();

  const visible = createMemo(() => {
    const s = session();
    return s.enqueued > 0 && (s.isActive || s.lastSettledAt !== null);
  });

  const settled = createMemo(() => !session().isActive);

  const totalDone = createMemo(() => {
    const s = session();
    return s.completed + s.failed;
  });

  const percent = createMemo(() => {
    const s = session();
    if (s.enqueued === 0) return 0;
    return Math.min(100, Math.round((totalDone() / s.enqueued) * 100));
  });

  return (
    <Show when={visible()}>
      <div
        class="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs border transition-opacity"
        classList={{
          "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]":
            !settled(),
          "bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-[var(--color-text-tertiary)] opacity-80":
            settled(),
        }}
        role="status"
        aria-live="polite"
      >
        <Show
          when={!settled()}
          fallback={
            <Icon name={session().failed > 0 ? "alertTriangle" : "checkCircle"} size={12} />
          }
        >
          <span
            class="inline-block w-2 h-2 rounded-full bg-[var(--color-accent-500)] animate-pulse"
            aria-hidden="true"
          />
        </Show>

        <Show when={!settled()} fallback={<SettledSummary />}>
          <span>
            enrichment: {totalDone()} / {session().enqueued}
            <Show when={session().failed > 0}>
              <span class="text-[var(--color-error-500)]"> · {session().failed} failed</span>
            </Show>
          </span>
          {/* aggregate progress bar */}
          <span
            class="inline-block h-1 w-24 rounded-full bg-[var(--color-bg-base)] overflow-hidden"
            aria-hidden="true"
          >
            <span
              class="block h-full bg-[var(--color-accent-500)] transition-[width] duration-300"
              style={{ width: `${percent()}%` }}
            />
          </span>
          {/* per-source breakdown */}
          <span class="flex items-center gap-1.5 ml-1">
            <For each={ENRICHMENT_SOURCES}>
              {(src) => {
                const c = () => session().bySource[src];
                const done = () => c().completed + c().failed;
                return (
                  <span
                    class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-bg-base)]"
                    title={`${SOURCE_LABEL[src]}: ${done()} / ${c().enqueued}${
                      c().failed > 0 ? ` · ${c().failed} failed` : ""
                    }${c().skippedAtEnqueue > 0 ? ` · ${c().skippedAtEnqueue} skipped` : ""}`}
                    classList={{
                      "text-[var(--color-error-500)]": c().failed > 0,
                      "text-[var(--color-text-tertiary)]": c().failed === 0,
                    }}
                  >
                    {SOURCE_SHORT[src]} {done()}/{c().enqueued}
                  </span>
                );
              }}
            </For>
          </span>
        </Show>

        <button
          type="button"
          class="ml-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] bg-transparent border-none cursor-pointer p-0 leading-none"
          aria-label="dismiss progress"
          onClick={() => dismissMbSession()}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
    </Show>
  );
}

function SettledSummary() {
  const session = useMbSession();
  return (
    <span>
      <Show
        when={session().failed === 0}
        fallback={
          <>
            <span class="text-[var(--color-error-500)]">{session().failed} failed</span>
            <Show when={session().completed > 0}>
              <span> · {session().completed} done</span>
            </Show>
          </>
        }
      >
        enrichment complete · {session().completed} job
        {session().completed === 1 ? "" : "s"}
      </Show>
      <Show when={session().lastError}>
        {(err) => (
          <span class="ml-2 text-[var(--color-text-tertiary)]" title={err()}>
            ({err()})
          </span>
        )}
      </Show>
    </span>
  );
}
