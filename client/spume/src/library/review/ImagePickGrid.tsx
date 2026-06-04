// ImagePickGrid — phase 11 / slice 3 (album images).
//
// presentational grid of remote image candidates surfaced from
// stored metadata snapshots (audiodb thumbs, musicbrainz coverart,
// etc). each tile lets the user toggle selection — actual http
// fetch + dedup happens during the modal's save action, not on
// click. parent owns the selected-url set so re-renders during
// the bulk review walk don't lose state.

import { For, Show, createSignal } from "solid-js";

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

/** per-tile state machine: loading -> loaded | error. cycling
 *  through retries bumps a cache-buster on the src so the browser
 *  re-issues the request. */
type TileState = "loading" | "loaded" | "error";

function ImageTile(props: {
  candidate: ImageCandidateLike;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const [state, setState] = createSignal<TileState>("loading");
  const [retryNonce, setRetryNonce] = createSignal(0);
  const src = () => {
    const n = retryNonce();
    if (n === 0) return props.candidate.url;
    const sep = props.candidate.url.includes("?") ? "&" : "?";
    return `${props.candidate.url}${sep}_retry=${n}`;
  };
  const retry = (e?: MouseEvent) => {
    e?.stopPropagation();
    setState("loading");
    setRetryNonce((n) => n + 1);
  };
  return (
    <button
      type="button"
      class="relative flex flex-col items-stretch gap-1 p-1 rounded border cursor-pointer hover:bg-[var(--color-bg-hover)] text-left"
      classList={{
        "border-[var(--color-accent-500)] ring-2 ring-[var(--color-accent-500)]": props.isSelected,
        "border-[var(--color-border-subtle)]": !props.isSelected,
      }}
      onClick={() => props.onToggle()}
      title={`${props.candidate.source} · ${props.candidate.kind}\n${props.candidate.url}`}
    >
      <div class="relative aspect-square w-full overflow-hidden rounded bg-[var(--color-bg-subtle)] flex items-center justify-center">
        <Show when={state() !== "error"}>
          <img
            src={src()}
            alt={`${props.candidate.source} ${props.candidate.kind}`}
            class="w-full h-full object-cover"
            classList={{ "opacity-0": state() === "loading" }}
            loading="lazy"
            referrerpolicy="no-referrer"
            onLoad={() => setState("loaded")}
            onError={() => setState("error")}
          />
        </Show>
        <Show when={state() === "loading"}>
          <div class="absolute inset-0 flex items-center justify-center text-[10px] text-[var(--color-text-disabled)]">
            <div class="w-4 h-4 border-2 border-[var(--color-border-subtle)] border-t-[var(--color-accent-500)] rounded-full animate-spin" />
          </div>
        </Show>
        <Show when={state() === "error"}>
          <div
            role="button"
            tabindex="0"
            onClick={(e) => retry(e)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") retry();
            }}
            class="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[10px] text-[var(--color-text-disabled)] hover:bg-[var(--color-bg-hover)]"
            title="image failed to load (cover-art-archive can be flaky) — click to retry"
          >
            <div class="text-base">↻</div>
            <div>retry</div>
          </div>
        </Show>
      </div>
      <div class="flex items-center justify-between gap-1 text-[10px] text-[var(--color-text-secondary)]">
        <span class="truncate">{props.candidate.kind}</span>
        <span class="text-[var(--color-text-disabled)]">{props.candidate.source}</span>
      </div>
      <Show when={props.isSelected}>
        <div class="absolute top-1 right-1 px-1 py-0.5 rounded bg-[var(--color-accent-500)] text-[10px] text-white">
          selected
        </div>
      </Show>
    </button>
  );
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
            {(c) => (
              <ImageTile
                candidate={c}
                isSelected={props.selected.has(c.url)}
                onToggle={() => props.onToggle(c)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
