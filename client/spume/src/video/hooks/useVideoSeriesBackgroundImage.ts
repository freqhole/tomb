// syncs a video series' poster into the app-wide background image, same
// as playlists do. a thin adapter over the shared useBackgroundImageSource
// hook. `poster_blob_id` holds a local reliquary blob id for local
// (browser) storage and a remote blob id for charnel/p2p remotes, so it's
// passed as both - the shared hook picks whichever matches the current
// remote (see VideoSeries's doc comment in ../data/types.ts).
import type { Accessor } from "solid-js";
import {
  useBackgroundImageSource,
  type BackgroundImageSource,
} from "../../app/hooks/useBackgroundImageSource";
import type { VideoSeries } from "../data/types";

export function useVideoSeriesBackgroundImage(series: Accessor<VideoSeries | null | undefined>) {
  useBackgroundImageSource((): BackgroundImageSource | null => {
    const s = series();
    if (!s?.poster_blob_id) return null;
    return {
      localBlobId: s.poster_blob_id,
      remoteBlobId: s.poster_blob_id,
      remoteServerId: s.remote_server_id,
    };
  });
}
