// floating bulk-action bar shown when one or more albums are selected.
//
// the primary action enriches the selected albums against all three
// metadata sources (musicbrainz, last.fm, theaudiodb) in parallel.
// rate limiting and retry/backoff are enforced server-side per source.

import { createSignal, Show } from "solid-js";
import { Icon } from "../../components/icons/registry";
import { clearAlbumSelection, useAlbumSelectionCount } from "../hooks/albumSelection";
import { isNarrowViewport } from "../../config/breakpoints";

interface AlbumBulkActionBarProps {
  /** invoked when the user clicks "enrich". fans out to all
   *  three metadata-source enqueue endpoints (mb / lastfm / audiodb). */
  onEnrich?: () => void;
  /** invoked when the user clicks "review" (phase 14.9). kicks
   *  off a bulk enrichment session and opens the album editor in
   *  review-mode pointing at the first selected album. */
  onReview?: () => void;
  /** invoked when the user clicks "mark done". flips
   *  `mb_lookup_status='enriched'` on every selected album without
   *  going through the review wizard. */
  onMarkDone?: () => void;
  /** opens the bulk-edit modal in metadata mode (rename single album,
   *  pick album_type for any number, optionally combine the selection
   *  into one). */
  onEditMetadata?: () => void;
  /** opens the bulk-edit modal in disc-number mode (sets a disc # on
   *  every song in every selected album). */
  onSetDiscNumber?: () => void;
  /** opens the album-tag picker for every selected album. */
  onManageTags?: () => void;
  /** flip `mb_lookup_status='skipped'` on the selected albums: removes
   *  them from future bulk lookups until explicitly un-skipped. */
  onSkip?: () => void;
  /** resets `mb_lookup_status='not_attempted'` on selected albums that are
   *  currently `skipped`, so they re-enter the lookup queue. */
  onUnskip?: () => void;
  /** disable destructive/admin actions when the user is not an admin on the
   *  selected remote. */
  isAdmin?: boolean;
}

export function AlbumBulkActionBar(props: AlbumBulkActionBarProps) {
  const [isNarrow] = createSignal(isNarrowViewport());
  const count = useAlbumSelectionCount();

  return (
    <Show when={count() > 0}>
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
        <Show when={count() > 1}>
          <span class="text-xs text-[var(--color-text-secondary)] mr-2">
            {count()}
            <Show when={!isNarrow()} fallback="">
              selected
            </Show>
          </span>
        </Show>

        <button
          type="button"
          disabled={!props.onEnrich || props.isAdmin === false}
          onClick={() => props.onEnrich?.()}
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
          title={
            props.isAdmin === false
              ? "requires admin on this remote"
              : "look up musicbrainz + last.fm + theaudiodb for the selected albums"
          }
        >
          <Icon name="search" size={11} />
          <Show when={!isNarrow()} fallback="">
            enrich
          </Show>
        </button>

        <Show when={props.onReview}>
          <button
            type="button"
            disabled={props.isAdmin === false}
            onClick={() => props.onReview?.()}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
            title={
              props.isAdmin === false
                ? "requires admin on this remote"
                : "enrich + walk through each album in the editor"
            }
          >
            <Icon name="edit" size={11} />
            <Show when={!isNarrow()} fallback="">
              review
            </Show>
          </button>
        </Show>

        <Show when={props.onMarkDone}>
          <button
            type="button"
            disabled={props.isAdmin === false}
            onClick={() => props.onMarkDone?.()}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-success-500)]/40 text-[var(--color-success-500)] hover:bg-[var(--color-success-500)]/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
            title={
              props.isAdmin === false
                ? "requires admin on this remote"
                : "flip mb_lookup_status to 'enriched' on the selected albums (no review)"
            }
          >
            <Icon name="check" size={11} />
            <Show when={!isNarrow()} fallback="">
              mark done
            </Show>
          </button>
        </Show>

        <Show when={props.onEditMetadata}>
          <button
            type="button"
            disabled={props.isAdmin === false}
            onClick={() => props.onEditMetadata?.()}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
            title={
              props.isAdmin === false
                ? "requires admin on this remote"
                : "edit album title / type, or combine selected albums into one"
            }
          >
            <Icon name="edit" size={11} />

            <Show when={!isNarrow()} fallback="">
              edit
            </Show>
          </button>
        </Show>

        <Show when={props.onSetDiscNumber}>
          <button
            type="button"
            disabled={props.isAdmin === false}
            onClick={() => props.onSetDiscNumber?.()}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
            title={
              props.isAdmin === false
                ? "requires admin on this remote"
                : "set a disc number on every song in every selected album"
            }
          >
            <Icon name="album" size={11} />
            <Show when={!isNarrow()} fallback="">
              set disc #
            </Show>
          </button>
        </Show>

        <Show when={props.onManageTags}>
          <button
            type="button"
            disabled={props.isAdmin === false}
            onClick={() => props.onManageTags?.()}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
            title={
              props.isAdmin === false
                ? "requires admin on this remote"
                : "manage tags across the selected albums"
            }
          >
            <Icon name="tag" size={11} />
            <Show when={!isNarrow()} fallback="">
              tags
            </Show>
          </button>
        </Show>

        <Show when={props.onSkip}>
          <button
            type="button"
            disabled={props.isAdmin === false}
            onClick={() => props.onSkip?.()}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
            title={
              props.isAdmin === false
                ? "requires admin on this remote"
                : "skip musicbrainz lookup for selected albums (won't appear in future bulk lookups)"
            }
          >
            <Show when={!isNarrow()} fallback="skip">
              <Icon name="close" size={11} />
              skip lookup
            </Show>
          </button>
        </Show>

        <Show when={props.onUnskip}>
          <button
            type="button"
            disabled={props.isAdmin === false}
            onClick={() => props.onUnskip?.()}
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent whitespace-nowrap"
            title={
              props.isAdmin === false
                ? "requires admin on this remote"
                : "re-enable lookup for selected albums (resets status to not attempted)"
            }
          >
            <Show when={!isNarrow()} fallback="unskip">
              <Icon name="add" size={11} />
              un-skip
            </Show>
          </button>
        </Show>

        <button
          type="button"
          onClick={() => clearAlbumSelection()}
          class="flex items-center gap-1 px-2 py-1 text-xs rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer border-none bg-transparent"
          title="clear selection (esc)"
        >
          <Icon name="close" size={11} />
          <Show when={!isNarrow()} fallback="">
            clear
          </Show>
        </button>
      </div>
    </Show>
  );
}
