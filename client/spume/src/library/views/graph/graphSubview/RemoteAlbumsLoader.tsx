import { createEffect, onCleanup } from "solid-js";
import type { Remote } from "../../../../app/services/storage/schemas/remote";
import { useLibraryAlbumsQuery } from "../../../queries/useLibraryAlbums";
import { adaptAlbum } from "../adaptAlbum";
import type { AlbumNodeData } from "../../../../components/graph/types";

/** mounts one infinite query per remote, emits adapted album nodes
 *  back via onNodes as pages stream in. */
export function RemoteAlbumsLoader(props: {
  remote: Remote;
  search: () => string;
  onNodes: (remoteId: string, nodes: AlbumNodeData[]) => void;
  onFetchingChange?: (remoteId: string, fetching: boolean) => void;
}) {
  // 2026-05-26: lazy-load phase 1. previously this loader auto-paginated
  // the entire album catalogue per remote to populate relation hubs.
  // now we only fetch page 1 (a sample sized for first-render usefulness)
  // and rely on per-pivot query_taxons / query_albums calls to fill in
  // the rest on demand. ramp-up + fetchNextPage loop removed.
  const PAGE_SIZE = 200;

  const albumsQuery = useLibraryAlbumsQuery({
    remote: () => props.remote,
    search: () => props.search() || undefined,
    pageSize: PAGE_SIZE,
    disablePolling: true,
  });

  // report in-flight status. only the first page now, so this clears as
  // soon as that single fetch settles.
  createEffect(() => {
    const q = albumsQuery;
    const fetching = q.isFetching;
    props.onFetchingChange?.(props.remote.remote_id, fetching);
  });
  onCleanup(() => {
    props.onFetchingChange?.(props.remote.remote_id, false);
  });

  // emit adapted nodes per page (only fires when page count/total changes)
  let lastPages = -1;
  let lastCount = -1;
  createEffect(() => {
    const pages = albumsQuery.data?.pages ?? [];
    if (pages.length === 0) return;
    const id = props.remote.remote_id;
    const out: AlbumNodeData[] = [];
    for (const page of pages) {
      for (const summary of page.items) {
        out.push(adaptAlbum(summary, { remoteId: id }));
      }
    }
    if (pages.length === lastPages && out.length === lastCount) return;
    lastPages = pages.length;
    lastCount = out.length;
    props.onNodes(id, out);
  });

  return null;
}
