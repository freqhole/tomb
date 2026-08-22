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

import { createSignal, createResource, Show, For } from "solid-js";
import { type AdminClient } from "@freqhole/api-client";
import {
  listFilterSetFilters,
  addFilterSetFilter,
  removeFilterSetFilter,
} from "../../app/services/charnel";
import { getLocalAdminClient } from "../../app/api/adminClient";
import { SeedSuggestInput, SongSuggestInput } from "../../components/radio/SeedSuggestInputs";
import {
  REFERENCE_FILTER_TYPES,
  CRITERIA_FILTER_TYPES,
  type FilterType,
  isReferenceFilterType,
  isRatingFilterType,
  isScopableFilterType,
  filterDisplayValue,
  FILTER_MODES,
} from "../../components/radio/filterTypes";
import { toast } from "../../components/feedback/Toast";

export function FilterSetManager(props: { filterSetId: string; onFiltersChanged?: () => void }) {
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
      <FilterSetClauseEditor
        filterSetId={props.filterSetId}
        client={client!}
        onFiltersChanged={props.onFiltersChanged}
      />
    </Show>
  );
}

function FilterSetClauseEditor(props: {
  filterSetId: string;
  client: AdminClient;
  onFiltersChanged?: () => void;
}) {
  const [filters, { refetch: refetchFilters }] = createResource(
    () => props.filterSetId,
    (filterSetId) => listFilterSetFilters(filterSetId)
  );
  const [busy, setBusy] = createSignal(false);
  const [fType, setFType] = createSignal<FilterType>("tag");
  const [fValue, setFValue] = createSignal("");
  const [fMode, setFMode] = createSignal("include");
  const [fScope, setFScope] = createSignal<"me" | "everyone">("me");

  // song-count/projection preview lives in `StorageOverviewView.tsx` now
  // (see `getFilterSetProjection`) - it needs a device-wide, segmented
  // "actual vs projected" display, not just this editor's own clause
  // list, so `onFiltersChanged` tells it when to re-fetch.

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
        fMode(),
        isScopableFilterType(fType()) ? fScope() : undefined
      );
      if (!filter) {
        toast.error("failed to add filter");
        return;
      }
      setFValue("");
      await refetchFilters();
      props.onFiltersChanged?.();
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
      await refetchFilters();
      props.onFiltersChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-3">
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
                    {filterDisplayValue(f, "you")}
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
            setFScope("me");
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
        <Show when={isScopableFilterType(fType())}>
          <select
            class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
            value={fScope()}
            onChange={(e) => setFScope(e.currentTarget.value as "me" | "everyone")}
          >
            <option value="me">my {isRatingFilterType(fType()) ? "ratings" : "favorites"}</option>
            <option value="everyone">
              everyone's {isRatingFilterType(fType()) ? "ratings" : "favorites"}
            </option>
          </select>
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
