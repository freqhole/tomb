// Music module main exports
export * from "./schemas/index.js";
export * from "./validation.js";
export * from "./error-handling.js";
export type {
  Song,
  Album,
  ArtistSummary,
  Playlist,
  PlaylistSong,
  QueueItem,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  AddSongsToPlaylistRequest,
  RemoveSongsFromPlaylistRequest,
} from "./schemas/index.js";

export type {
  MusicErrorContext,
  MusicApiLogger,
  RetryOptions,
} from "./error-handling.js";
