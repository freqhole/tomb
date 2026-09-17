// shared, dependency-free shape for reporting "sending reviewed albums to a
// remote" progress inline (no toasts) - used by both
// sendReviewedSessionToRemote.ts (grimoire-backed sessions) and
// sendReviewedLocalSessionToRemote.ts (browser-local-idb-backed sessions),
// and by the pure importSessionReducer.ts, which must NOT pull in either of
// those files (they transitively import the live api client / cenotaph
// playback stack, which touches browser-only globals like `Audio` at module
// load time - poisoning any plain unit test that imports the reducer).
export interface SendReviewProgress {
  targetName: string;
  totalAlbums: number;
  /** includes both successful and failed albums. */
  completedAlbums: number;
  failedAlbums: number;
  currentAlbumTitle: string | null;
  currentSongsDone: number;
  currentSongsTotal: number;
  /** noun for the currentSongsDone/currentSongsTotal line - "songs" for
   *  music, "videos" for video (see sendReviewedVideoSessionToRemote.ts's
   *  doc comment on why it reuses this album/song-shaped type). */
  itemLabel?: string;
  done: boolean;
  errors: string[];
}

export function emptyProgress(
  targetName: string,
  totalAlbums: number,
  itemLabel = "songs"
): SendReviewProgress {
  return {
    targetName,
    totalAlbums,
    completedAlbums: 0,
    failedAlbums: 0,
    currentAlbumTitle: null,
    currentSongsDone: 0,
    currentSongsTotal: 0,
    itemLabel,
    done: false,
    errors: [],
  };
}
