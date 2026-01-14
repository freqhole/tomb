// test fixtures - typed minimal valid data for all schema types
import type * as s from "../codegen/schema.js";

// ============================================================================
// Constants & IDs
// ============================================================================

export const PLACEHOLDER_ID = "placeholder-id";

export const testIds = {
  song: "test-song-id",
  album: "test-album-id",
  artist: "test-artist-id",
  playlist: "test-playlist-id",
  genre: "test-genre-id",
  subGenre: "test-sub-genre-id",
  tag: "test-tag-id",
  job: "test-job-id",
  blob: "test-blob-id",
  user: "test-user-id",
};

// ============================================================================
// Common Query Params
// ============================================================================

export const queryParams: s.QueryParams = {
  q: null,
  search_fields: null,
  filters: {},
  sort_by: null,
  sort_direction: null,
  limit: 10,
  offset: 0,
  user_id: null,
  favorites_only: null,
  min_rating: null,
};

// ============================================================================
// Request Fixtures
// ============================================================================

// Artists
export const createArtistRequest: s.CreateArtistRequest = {
  name: "Test Artist",
};

export const getArtistRequest: s.GetArtistRequest = {
  id: PLACEHOLDER_ID,
};

export const deleteArtistRequest: s.DeleteArtistRequest = {
  id: PLACEHOLDER_ID,
};

// Albums
export const getAlbumRequest: s.GetAlbumRequest = {
  id: PLACEHOLDER_ID,
};

export const deleteAlbumRequest: s.DeleteAlbumRequest = {
  id: PLACEHOLDER_ID,
};

// Songs
export const recentSongsRequest: s.RecentSongsRequest = {
  limit: 10,
  offset: 0,
};

export const updateSongsRequest: s.UpdateSongsRequest = {
  song_ids: [PLACEHOLDER_ID],
  updates: {
    title: "Updated Title",
  },
};

export const deleteSongRequest: s.DeleteSongRequest = {
  id: PLACEHOLDER_ID,
};

// Playlists
export const createPlaylistRequest: s.CreatePlaylistRequest = {
  title: "Test Playlist",
  description: null,
  is_public: false,
};

export const updatePlaylistRequest: s.UpdatePlaylistRequest = {
  id: PLACEHOLDER_ID,
  title: "Updated Playlist",
  description: "Updated description",
};

export const deletePlaylistRequest: s.DeletePlaylistRequest = {
  id: PLACEHOLDER_ID,
  hard_delete: false,
};

export const queryPlaylistSongsRequest: s.QueryPlaylistSongsRequest = {
  playlist_id: PLACEHOLDER_ID,
  limit: 10,
  offset: 0,
  sort_by: null,
};

export const addSongsToPlaylistRequest: s.AddSongsToPlaylistRequest = {
  playlist_id: PLACEHOLDER_ID,
  song_ids: [PLACEHOLDER_ID],
};

export const removeSongsFromPlaylistRequest: s.RemoveSongsFromPlaylistRequest =
  {
    playlist_id: PLACEHOLDER_ID,
    song_ids: [PLACEHOLDER_ID],
  };

export const reorderPlaylistSongsRequest: s.ReorderPlaylistSongsRequest = {
  playlist_id: PLACEHOLDER_ID,
  song_positions: [
    { song_id: "song-1", position: 0 },
    { song_id: "song-2", position: 1 },
  ],
};

export const removePlaylistThumbnailRequest: s.RemovePlaylistThumbnailRequest =
  {
    playlist_id: PLACEHOLDER_ID,
    soft_delete: false,
  };

// Genres
export const getGenreRequest: s.GetGenreRequest = {
  id: PLACEHOLDER_ID,
};

// Sub-genres
export const getSubGenreRequest: s.GetSubGenreRequest = {
  id: PLACEHOLDER_ID,
};

export const createSubGenreRequest: s.CreateSubGenreRequest = {
  name: "Test Sub-Genre",
  genre_id: PLACEHOLDER_ID,
};

export const deleteSubGenreRequest: s.DeleteSubGenreRequest = {
  id: PLACEHOLDER_ID,
};

export const querySubGenresRequest: s.QuerySubGenresRequest = {
  genre_id: PLACEHOLDER_ID,
  q: "test",
};

export const listSubGenresForGenreRequest: s.ListSubGenresForGenreRequest = {
  genre_id: PLACEHOLDER_ID,
};

export const findOrCreateSubGenreRequest: s.FindOrCreateSubGenreRequest = {
  name: "Test Sub-Genre",
  genre_id: PLACEHOLDER_ID,
};

// Favorites
export const listFavoritesRequest: s.ListFavoritesRequest = {
  entity_type: "song",
  limit: 10,
  offset: 0,
};

export const setFavoriteRequest: s.SetFavoriteRequest = {
  entity_type: "song",
  entity_id: PLACEHOLDER_ID,
  is_favorite: true,
};

// Ratings
export const setRatingRequest: s.SetRatingRequest = {
  entity_type: "song",
  entity_id: PLACEHOLDER_ID,
  rating: 5,
};

export const removeRatingRequest: s.RemoveRatingRequest = {
  entity_type: "song",
  entity_id: PLACEHOLDER_ID,
};

export const getRatingStatsRequest: s.GetRatingStatsRequest = {
  entity_type: "song",
  entity_id: PLACEHOLDER_ID,
};

// Tags
export const queryTagsRequest: s.QueryTagsRequest = {
  q: "test",
};

export const getTagRequest: s.GetTagRequest = {
  id: PLACEHOLDER_ID,
};

export const deleteTagRequest: s.DeleteTagRequest = {
  id: PLACEHOLDER_ID,
};

export const getAlbumTagsRequest: s.GetAlbumTagsRequest = {
  album_id: PLACEHOLDER_ID,
};

export const addAlbumTagsRequest: s.AddAlbumTagsRequest = {
  album_id: PLACEHOLDER_ID,
  tag_ids: [PLACEHOLDER_ID],
};

export const removeAlbumTagsRequest: s.RemoveAlbumTagsRequest = {
  album_id: PLACEHOLDER_ID,
  tag_ids: [PLACEHOLDER_ID],
};

export const replaceAlbumTagsRequest: s.ReplaceAlbumTagsRequest = {
  album_id: PLACEHOLDER_ID,
  tag_ids: [PLACEHOLDER_ID],
};

// Analytics
export const recordPlayRequest: s.RecordPlayRequest = {
  song_id: PLACEHOLDER_ID,
  duration_ms: 180000,
  timestamp: Date.now(),
};

export const songAnalyticsRequest: s.SongAnalyticsRequest = {
  song_id: PLACEHOLDER_ID,
};

export const listeningHistoryRequest: s.ListeningHistoryRequest = {
  limit: 10,
  offset: 0,
  start_date: null,
  end_date: null,
};

export const topSongsRequest: s.TopSongsRequest = {
  limit: 10,
  time_range: "week",
};

export const topArtistsRequest: s.TopArtistsRequest = {
  limit: 10,
  time_range: "week",
};

export const topAlbumsRequest: s.TopAlbumsRequest = {
  limit: 10,
  time_range: "week",
};

export const feedRequest: s.FeedRequest = {
  limit: 10,
  offset: 0,
};

// MusicBrainz
export const searchReleasesRequest: s.SearchReleasesRequest = {
  query: "test query",
};

export const getReleaseRequest: s.GetReleaseRequest = {
  mbid: PLACEHOLDER_ID,
};

// Jobs
export const listJobsRequest: s.ListJobsRequest = {
  session_id: null,
  status: null,
  limit: 10,
  offset: 0,
};

export const getJobRequest: s.GetJobRequest = {
  id: PLACEHOLDER_ID,
};

// Fetch
export const fetchMediaParams: s.FetchMediaParams = {
  url: "https://example.com/video",
  format: null,
  quality: null,
};

// Auth
export const registerStartRequest: s.RegisterStartRequest = {
  username: "testuser",
};

export const startLoginRequest: s.StartLoginRequest = {
  username: "testuser",
};

export const redeemInviteRequest: s.RedeemInviteRequest = {
  invite_code: "test-invite-code",
};

// ============================================================================
// Helper Functions
// ============================================================================

// merge fixture with overrides, replacing PLACEHOLDER_ID with real IDs
export function merge<T extends Record<string, any>>(
  fixture: T,
  overrides: Partial<T>,
): T {
  const merged = { ...fixture, ...overrides };

  // recursively replace PLACEHOLDER_ID in the merged object
  return JSON.parse(
    JSON.stringify(merged).replaceAll(
      PLACEHOLDER_ID,
      (overrides.id as string) || PLACEHOLDER_ID,
    ),
  );
}

// create a fixture with specific ID
export function withId<T extends { id?: string }>(fixture: T, id: string): T {
  return { ...fixture, id };
}

// create a fixture with specific entity_id
export function withEntityId<T extends { entity_id?: string }>(
  fixture: T,
  entityId: string,
): T {
  return { ...fixture, entity_id: entityId };
}

// create a fixture with specific playlist_id
export function withPlaylistId<T extends { playlist_id?: string }>(
  fixture: T,
  playlistId: string,
): T {
  return { ...fixture, playlist_id: playlistId };
}

// create a fixture with specific album_id
export function withAlbumId<T extends { album_id?: string }>(
  fixture: T,
  albumId: string,
): T {
  return { ...fixture, album_id: albumId };
}

// ============================================================================
// Fixture Collections (for convenience)
// ============================================================================

export const fixtures = {
  // common
  queryParams,

  // artists
  createArtist: createArtistRequest,
  getArtist: getArtistRequest,
  deleteArtist: deleteArtistRequest,

  // albums
  getAlbum: getAlbumRequest,
  deleteAlbum: deleteAlbumRequest,

  // songs
  recentSongs: recentSongsRequest,
  updateSongs: updateSongsRequest,
  deleteSong: deleteSongRequest,

  // playlists
  createPlaylist: createPlaylistRequest,
  updatePlaylist: updatePlaylistRequest,
  deletePlaylist: deletePlaylistRequest,
  queryPlaylistSongs: queryPlaylistSongsRequest,
  addSongsToPlaylist: addSongsToPlaylistRequest,
  removeSongsFromPlaylist: removeSongsFromPlaylistRequest,
  reorderPlaylistSongs: reorderPlaylistSongsRequest,
  removePlaylistThumbnail: removePlaylistThumbnailRequest,

  // genres
  getGenre: getGenreRequest,

  // sub-genres
  getSubGenre: getSubGenreRequest,
  createSubGenre: createSubGenreRequest,
  deleteSubGenre: deleteSubGenreRequest,
  querySubGenres: querySubGenresRequest,
  listSubGenresForGenre: listSubGenresForGenreRequest,
  findOrCreateSubGenre: findOrCreateSubGenreRequest,

  // favorites
  listFavorites: listFavoritesRequest,
  setFavorite: setFavoriteRequest,

  // ratings
  setRating: setRatingRequest,
  removeRating: removeRatingRequest,
  getRatingStats: getRatingStatsRequest,

  // tags
  queryTags: queryTagsRequest,
  getTag: getTagRequest,
  deleteTag: deleteTagRequest,
  getAlbumTags: getAlbumTagsRequest,
  addAlbumTags: addAlbumTagsRequest,
  removeAlbumTags: removeAlbumTagsRequest,
  replaceAlbumTags: replaceAlbumTagsRequest,

  // analytics
  recordPlay: recordPlayRequest,
  songAnalytics: songAnalyticsRequest,
  listeningHistory: listeningHistoryRequest,
  topSongs: topSongsRequest,
  topArtists: topArtistsRequest,
  topAlbums: topAlbumsRequest,
  feed: feedRequest,

  // musicbrainz
  searchReleases: searchReleasesRequest,
  getRelease: getReleaseRequest,

  // jobs
  listJobs: listJobsRequest,
  getJob: getJobRequest,

  // fetch
  fetchMedia: fetchMediaParams,

  // auth
  registerStart: registerStartRequest,
  startLogin: startLoginRequest,
  redeemInvite: redeemInviteRequest,
};
