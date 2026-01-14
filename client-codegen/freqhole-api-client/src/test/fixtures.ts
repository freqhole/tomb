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
  created_by: null,
};

export const getArtistRequest: s.GetArtistRequest = {
  id: PLACEHOLDER_ID,
};

export const deleteArtistRequest: s.DeleteArtistRequest = {
  id: PLACEHOLDER_ID,
  user_id: PLACEHOLDER_ID,
};

// Albums
export const getAlbumRequest: s.GetAlbumRequest = {
  id: PLACEHOLDER_ID,
};

export const deleteAlbumRequest: s.DeleteAlbumRequest = {
  id: PLACEHOLDER_ID,
  user_id: PLACEHOLDER_ID,
};

// Songs
export const recentSongsRequest: s.RecentSongsRequest = {
  limit: 10,
};

export const updateSongsRequest: s.UpdateSongsRequest = {
  song_ids: [PLACEHOLDER_ID],
  user_id: null,
  updated_by: null,
  title: "Updated Title",
  track_number: null,
  disc_number: null,
  duration: null,
  year: null,
  bpm: null,
  key_signature: null,
  lyrics: null,
  metadata: null,
  artist: null,
  artist_name: null,
  album: null,
  album_title: null,
  album_type: null,
  release_date: null,
  label: null,
  genre: null,
  sub_genre: null,
  thumbnail_blob_id: null,
  thumbnail_from_file: null,
  thumbnail_from_bytes: null,
  add_tags: null,
  remove_tags: null,
  replace_tags: null,
  set_favorite: null,
  favorite_song: false,
  favorite_artist: false,
  favorite_album: false,
  set_rating: null,
  rate_song: null,
  rate_artist: null,
  rate_album: null,
};

export const deleteSongRequest: s.DeleteSongRequest = {
  id: PLACEHOLDER_ID,
  user_id: PLACEHOLDER_ID,
};

// Playlists
export const createPlaylistRequest: s.CreatePlaylistRequest = {
  title: "Test Playlist",
  description: null,
  is_public: false,
  created_by_id: null,
};

export const updatePlaylistRequest: s.UpdatePlaylistRequest = {
  playlist_id: PLACEHOLDER_ID,
  title: "Updated Playlist",
  description: "Updated description",
  is_public: null,
  thumbnail_blob_id: null,
  updated_by: null,
};

export const deletePlaylistRequest: s.DeletePlaylistRequest = {
  playlist_id: PLACEHOLDER_ID,
  deleted_by: null,
};

export const queryPlaylistSongsRequest: s.QueryPlaylistSongsRequest = {
  playlist_id: PLACEHOLDER_ID,
  q: null,
  sort_by: null,
  sort_direction: null,
  limit: 10,
  offset: 0,
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
  song_ids: ["song-1", "song-2"],
  new_position: 0,
};

export const removePlaylistThumbnailRequest: s.RemovePlaylistThumbnailRequest =
  {
    playlist_id: PLACEHOLDER_ID,
    cleanup_blob: false,
    deleted_by: null,
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
  parent_genre_id: null,
};

export const deleteSubGenreRequest: s.DeleteSubGenreRequest = {
  id: PLACEHOLDER_ID,
};

export const querySubGenresRequest: s.QuerySubGenresRequest = {
  search: "test",
};

export const listSubGenresForGenreRequest: s.ListSubGenresForGenreRequest = {
  parent_genre_id: PLACEHOLDER_ID,
};

export const findOrCreateSubGenreRequest: s.FindOrCreateSubGenreRequest = {
  name: "Test Sub-Genre",
  parent_genre_id: PLACEHOLDER_ID,
};

// Favorites
export const listFavoritesRequest: s.ListFavoritesRequest = {
  user_id: PLACEHOLDER_ID,
  target_type: "song",
  limit: 10,
  offset: 0,
};

export const setFavoriteRequest: s.SetFavoriteRequest = {
  user_id: PLACEHOLDER_ID,
  target_type: "song",
  target_id: PLACEHOLDER_ID,
  is_favorite: true,
};

// Ratings
export const setRatingRequest: s.SetRatingRequest = {
  user_id: PLACEHOLDER_ID,
  target_type: "song",
  target_id: PLACEHOLDER_ID,
  rating: 5,
};

export const removeRatingRequest: s.RemoveRatingRequest = {
  user_id: PLACEHOLDER_ID,
  target_type: "song",
  target_id: PLACEHOLDER_ID,
};

export const getRatingStatsRequest: s.GetRatingStatsRequest = {
  target_type: "song",
  target_id: PLACEHOLDER_ID,
};

// Tags
export const queryTagsRequest: s.QueryTagsRequest = {
  search: "test",
};

export const getTagRequest: s.GetTagRequest = {
  tag_id: PLACEHOLDER_ID,
};

export const deleteTagRequest: s.DeleteTagRequest = {
  tag_id: PLACEHOLDER_ID,
  deleted_by: null,
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
  media_blob_id: PLACEHOLDER_ID,
  song_id: PLACEHOLDER_ID,
  session_id: null,
  event_data: null,
};

export const songAnalyticsRequest: s.SongAnalyticsRequest = {
  song_id: PLACEHOLDER_ID,
};

export const listeningHistoryRequest: s.ListeningHistoryRequest = {
  user_id: null,
  limit: 10,
  offset: 0,
};

export const topSongsRequest: s.TopSongsRequest = {
  limit: 10,
  days: 7,
};

export const topArtistsRequest: s.TopArtistsRequest = {
  limit: 10,
  days: 7,
};

export const topAlbumsRequest: s.TopAlbumsRequest = {
  limit: 10,
  days: 7,
};

export const feedRequest: s.FeedRequest = {
  limit: 10,
  offset: 0,
};

// MusicBrainz
export const searchReleasesRequest: s.SearchReleasesRequest = {
  query: "test query",
  artist: null,
  release: null,
  limit: null,
  offset: null,
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
  job_id: PLACEHOLDER_ID,
};

// Fetch
export const fetchMediaParams: s.FetchMediaParams = {
  url: "https://example.com/video",
  user_id: null,
};

// Auth
export const registerStartRequest: s.RegisterStartRequest = {
  username: "testuser",
  invite_code: null,
};

export const startLoginRequest: s.StartLoginRequest = {
  username: "testuser",
};

export const redeemInviteRequest: s.RedeemInviteRequest = {
  invite_code: "test-invite-code",
  username: "testuser",
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
    JSON.stringify(merged).replace(
      new RegExp(PLACEHOLDER_ID, "g"),
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
