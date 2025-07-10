// Music module main exports
export * from "./schemas/index.js";
export * from "./validation.js";
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
