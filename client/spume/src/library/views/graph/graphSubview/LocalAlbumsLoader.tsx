import { createResource, createEffect, onCleanup } from "solid-js";
import { localDataSource } from "../../../../music/data/local/localSource";
import { adaptAlbum } from "../adaptAlbum";
import type { AlbumNodeData } from "../../../../components/graph/types";

// loads the local indexeddb library into the graph as a synthetic
// "local" remote. mirrors RemoteAlbumsLoader's contract (onNodes +
// onFetchingChange) so the surrounding wiring in LibraryGraphSubview
// stays uniform.
export const LOCAL_GRAPH_REMOTE_ID = "local";

export function LocalAlbumsLoader(props: {
  search: () => string;
  onNodes: (remoteId: string, nodes: AlbumNodeData[]) => void;
  onFetchingChange?: (remoteId: string, fetching: boolean) => void;
}) {
  const [data] = createResource(
    () => props.search(),
    async (q): Promise<AlbumNodeData[]> => {
      props.onFetchingChange?.(LOCAL_GRAPH_REMOTE_ID, true);
      try {
        const resp = await localDataSource.getAlbums!({
          limit: 1000,
          offset: 0,
          search: q || undefined,
        });
        return resp.items.map((summary) =>
          adaptAlbum(summary, { remoteId: LOCAL_GRAPH_REMOTE_ID })
        );
      } finally {
        props.onFetchingChange?.(LOCAL_GRAPH_REMOTE_ID, false);
      }
    }
  );

  createEffect(() => {
    const nodes = data();
    if (!nodes) return;
    props.onNodes(LOCAL_GRAPH_REMOTE_ID, nodes);
  });

  onCleanup(() => {
    props.onFetchingChange?.(LOCAL_GRAPH_REMOTE_ID, false);
  });

  return null;
}
