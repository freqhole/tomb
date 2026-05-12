// ImagePickGrid — phase 11 / slice 3 (album images).
//
// presentational grid of remote image candidates surfaced from
// stored metadata snapshots (audiodb thumbs, musicbrainz coverart,
// etc). each tile lets the user toggle selection — actual http
// fetch + dedup happens during the modal's save action, not on
// click. parent owns the selected-url set so re-renders during
// the bulk review walk don't lose state.

import { For, Show } from "solid-js";

/** matches `AlbumImageCandidateSchema` in codegen/schema.ts. */
export interface ImageCandidateLike {
  url: string;
  source: string; // "audiodb" | "musicbrainz" | ...
  kind: string; // "front" | "back" | "thumb_hq" | "cdart" | ...
}

export interface ImagePickGridProps {
  /** human-readable section title (e.g. "album images"). */
  title: string;
  candidates: ImageCandidateLike[];
  /** count of images currently linked to the target entity. */
  ingestedCount: number;
  /** urls the user has marked for ingest on save. */
  selected: Set<string>;
  /** invoked when the user clicks a tile (parent toggles `selected`). */
  onToggle: (candidate: ImageCandidateLike) => void;
}

export function ImagePickGrid(props: ImagePickGridProps) {
  return (
    <div class="flex flex-col gap-2 p-2 rounded border border-[var(--color-border-subtle)]">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
          {props.title}
        </span>
        <span class="text-[10px] text-[var(--color-text-disabled)]">
          {props.candidates.length} candidates · {props.ingestedCount} in library ·{" "}
          {props.selected.size} selected
        </span>
      </div>

      <Show
        when={props.candidates.length > 0}
        fallback={
          <span class="text-xs text-[var(--color-text-disabled)] italic">
            no candidates from stored metadata
          </span>
        }
      >
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          <For each={props.candidates}>
            {(c) => {
              const isSelected = () => props.selected.has(c.url);
              return (
                <button
                  type="button"
                  class="relative flex flex-col items-stretch gap-1 p-1 rounded border cursor-pointer hover:bg-[var(--color-bg-hover)] text-left"
                  classList={{
                    "border-[var(--color-accent-500)] ring-2 ring-[var(--color-accent-500)]":
                      isSelected(),
                    "border-[var(--color-border-subtle)]": !isSelected(),
                  }}
                  onClick={() => props.onToggle(c)}
                  title={`${c.source} · ${c.kind}\n${c.url}`}
                >
                  <div class="aspect-square w-full overflow-hidden rounded bg-[var(--color-bg-subtle)] flex items-center justify-center">
                    <img
                      src={c.url}
                      alt={`${c.source} ${c.kind}`}
                      class="w-full h-full object-cover"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      onError={(e) => {
                        // hide broken thumbnails — server will still
                        // attempt fetch on save in case the broken
                        // hotlink is just a referer issue.
                        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                      }}
                    />
                  </div>
                  <div class="flex items-center justify-between gap-1 text-[10px] text-[var(--color-text-secondary)]">
                    <span class="truncate">{c.kind}</span>
                    <span class="text-[var(--color-text-disabled)]">{c.source}</span>
                  </div>
                  <Show when={isSelected()}>
                    <div class="absolute top-1 right-1 px-1 py-0.5 rounded bg-[var(--color-accent-500)] text-[10px] text-white">
                      selected
                    </div>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
