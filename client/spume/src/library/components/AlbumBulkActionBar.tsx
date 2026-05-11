// floating bulk-action bar shown when one or more albums are selected.
//
// phase 4 ships a single action ("lookup musicbrainz for N selected") that
// is wired up in phase 5 (job dispatch). for now the action button calls a
// callback prop so the LibraryView can decide what to do with it.

import { Show } from "solid-js";
import { Icon } from "../../components/icons/registry";
import { clearAlbumSelection, useAlbumSelectionCount } from "../hooks/albumSelection";

interface AlbumBulkActionBarProps {
  /** invoked when the user clicks "lookup musicbrainz". phase 4 stub: shows
   *  a toast; phase 5 enqueues a JobType::MbAlbumSearch job per selected id. */
  onMbLookup?: () => void;
  /** disable destructive/admin actions when the user is not an admin on the
   *  selected remote. */
  isAdmin?: boolean;
}

export function AlbumBulkActionBar(props: AlbumBulkActionBarProps) {
  const count = useAlbumSelectionCount();

  return (
    <Show when={count() > 0}>
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]">
        <span class="text-xs text-[var(--color-text-secondary)] mr-2">{count()} selected</span>

        <button
          type="button"
          disabled={!props.onMbLookup || props.isAdmin === false}
          onClick={() => props.onMbLookup?.()}
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-500)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-transparent"
          title={
            props.isAdmin === false
              ? "requires admin on this remote"
              : "lookup musicbrainz for the selected albums"
          }
        >
          <Icon name="search" size={11} />
          lookup musicbrainz for {count()} selected
        </button>

        <button
          type="button"
          onClick={() => clearAlbumSelection()}
          class="flex items-center gap-1 px-2 py-1 text-xs rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] cursor-pointer border-none bg-transparent"
          title="clear selection (esc)"
        >
          <Icon name="close" size={11} />
          clear
        </button>
      </div>
    </Show>
  );
}
