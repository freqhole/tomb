export { usePlayerQueue } from "./usePlayerQueue";
export { useMusicState } from "./useMusicState";
export { usePlayerState } from "./usePlayerState";
export { useViewState } from "./useViewState";
export { useFreqholeState } from "./useFreqholeState";
export {
  useInfiniteScroll,
  createApiFetcher,
  transformLegacyResponse,
} from "./useInfiniteScroll";

export type {
  UsePlayerQueueOptions,
  Song,
  QueueItem,
  PlaylistSong,
  Playlist,
  ArtistSummary,
  Album,
} from "./usePlayerQueue";

export type { MusicState, MusicActions } from "./useMusicState";

export type { PlayerStateActions } from "./usePlayerState";

export type { ViewState, ViewStateActions } from "./useViewState";

export type { FreqholeStateActions } from "./useFreqholeState";

export type {
  PaginationMetadata,
  InfiniteScrollOptions,
  InfiniteScrollState,
  InfiniteScrollActions,
  UseInfiniteScrollResult,
} from "./useInfiniteScroll";
