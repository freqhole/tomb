// filter-set editor: edit a device's one default filter-set's
// include/exclude clauses (see docs/removable-storage-sync-plan.md phase
// 6 - simplified from an earlier multi-named-filter-set design down to
// one default set per device; the resolved set/id is owned by
// `StorageOverviewView.tsx` and passed in here).
//
// mirrors `RadioAdminView.tsx`'s `StationSeedEditor` (same filter-clause
// vocabulary, same `SeedSuggestInput`/`SongSuggestInput` autocomplete),
// but wired to `grimoire::external_storage`'s filter-set commands instead
// of the radio admin dispatch.

import { createSignal, createResource, createEffect, Show, For } from "solid-js";
import { type AdminClient } from "@freqhole/api-client";
import {
  listFilterSetFilters,
  addFilterSetFilter,
  removeFilterSetFilter,
  resolveFilterSet,
} from "../../app/services/charnel";
import { getLocalAdminClient } from "../../app/api/adminClient";
import { SeedSuggestInput, SongSuggestInput } from "../../components/radio/SeedSuggestInputs";
import {
  REFERENCE_FILTER_TYPES,
  CRITERIA_FILTER_TYPES,
  type FilterType,
  isReferenceFilterType,
  isRatingFilterType,
  filterDisplayValue,
  FILTER_MODES,
} from "../../components/radio/filterTypes";
import { toast } from "../../components/feedback/Toast";

export function FilterSetManager(props: { filterSetId: string }) {
  const client = getLocalAdminClient();

  return (
    <Show
      when={client}
      fallback={
        <div class="text-xs text-[var(--color-text-muted)]">
          filter editing is only available in the desktop app.
        </div>
      }
    >
      <FilterSetClauseEditor filterSetId={props.filterSetId} client={client!} />
    </Show>
  );
}

function FilterSetClauseEditor(props: { filterSetId: string; client: AdminClient }) {
  const [filters, { refetch: refetchFilters }] = createResource(
    () => props.filterSetId,
    (filterSetId) => listFilterSetFilters(filterSetId)
  );
  const [songCount, setSongCount] = createSignal<number | null>(null);
  const [resolving, setResolving] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [fType, setFType] = createSignal<FilterType>("tag");
  const [fValue, setFValue] = createSignal("");
  const [fMode, setFMode] = createSignal("include");

  // song count is always computed, never behind a manual button - re-runs
  // whenever the filter-set id changes or its clauses are added/removed.
  // TODO(later phase): replace the count with a full song list (plus each
  // song's sync state) once storage-space-awareness lands - see
  // docs/removable-storage-sync-plan.md "future improvements".
  const refreshCount = async () => {
    setResolving(true);
    try {
      const ids = await resolveFilterSet(props.filterSetId);
      setSongCount(ids.length);
    } finally {
      setResolving(false);
    }
  };

  createEffect(() => {
    if (!filters.loading) void refreshCount();
  });

  const addFilter = async (e: Event) => {
    e.preventDefault();
    if (fType() !== "favorite" && !fValue().trim()) {
      toast.error("filter value required");
      return;
    }
    setBusy(true);
    try {
      const filter = await addFilterSetFilter(
        props.filterSetId,
        fType(),
        fType() === "favorite" ? "" : fValue().trim(),
        fMode()
      );
      if (!filter) {
        toast.error("failed to add filter");
        return;
      }
      setFValue("");
      setSongCount(null);
      await refetchFilters();
    } finally {
      setBusy(false);
    }
  };

  const removeFilter = async (filterId: string) => {
    setBusy(true);
    try {
      const ok = await removeFilterSetFilter(filterId);
      if (!ok) {
        toast.error("failed to remove filter");
        return;
      }
      setSongCount(null);
      await refetchFilters();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-2 text-xs">
        <div class="text-[var(--color-text-muted)]">
          include rows define the candidate set (intersection); exclude rows subtract from it.
        </div>
        <span class="px-2 py-1 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] whitespace-nowrap">
          {resolving() ? "counting..." : songCount() !== null ? `${songCount()} songs` : "\u2013"}
        </span>
      </div>

      <Show
        when={!filters.loading && (filters()?.length ?? 0) > 0}
        fallback={
          <div class="text-xs text-[var(--color-text-muted)]">
            {filters.loading ? "loading..." : "no filters yet"}
          </div>
        }
      >
        <ul class="flex flex-col gap-1">
          <For each={filters() ?? []}>
            {(f) => (
              <li class="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)]">
                <span>
                  <span
                    class={
                      f.mode === "include"
                        ? "px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 mr-2"
                        : "px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 mr-2"
                    }
                  >
                    {f.mode}
                  </span>
                  <code class="text-[var(--color-text-secondary)]">{f.filter_type}</code>
                  <span class="text-[var(--color-text-muted)]"> = </span>
                  <span class="text-[var(--color-text-primary)]" title={f.filter_value}>
                    {filterDisplayValue(f)}
                  </span>
                </span>
                <button
                  class="px-2 py-0.5 text-xs rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 disabled:opacity-50"
                  onClick={() => void removeFilter(f.id)}
                  disabled={busy()}
                >
                  remove
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <form class="flex flex-wrap items-end gap-2" onSubmit={addFilter}>
        <select
          class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
          value={fMode()}
          onChange={(e) => setFMode(e.currentTarget.value)}
        >
          <For each={FILTER_MODES}>{(m) => <option value={m}>{m}</option>}</For>
        </select>
        <select
          class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
          value={fType()}
          onChange={(e) => {
            setFType(e.currentTarget.value as FilterType);
            setFValue("");
          }}
        >
          <optgroup label="reference">
            <For each={REFERENCE_FILTER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
          </optgroup>
          <optgroup label="criteria (any user)">
            <For each={CRITERIA_FILTER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
          </optgroup>
        </select>
        <Show when={isReferenceFilterType(fType())}>
          <Show
            when={fType() === "track"}
            fallback={
              <SeedSuggestInput
                client={props.client}
                kind={fType() as "tag" | "taxon" | "artist" | "album" | "playlist"}
                value={fValue()}
                onChange={setFValue}
                placeholder={`${fType()} name`}
              />
            }
          >
            <SongSuggestInput client={props.client} value={fValue()} onChange={setFValue} />
          </Show>
        </Show>
        <Show when={fType() === "favorite"}>
          <span class="text-xs text-[var(--color-text-muted)] px-1">no value needed</span>
        </Show>
        <Show when={!isReferenceFilterType(fType()) && fType() !== "favorite"}>
          <input
            type="number"
            class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] w-24"
            min={isRatingFilterType(fType()) ? 1 : 0}
            max={isRatingFilterType(fType()) ? 5 : undefined}
            step={1}
            placeholder={isRatingFilterType(fType()) ? "1-5" : "0"}
            value={fValue()}
            onInput={(e) => setFValue(e.currentTarget.value)}
          />
        </Show>
        <button
          type="submit"
          class="px-3 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
          disabled={busy()}
        >
          + add filter
        </button>
      </form>
    </div>
  );
}
