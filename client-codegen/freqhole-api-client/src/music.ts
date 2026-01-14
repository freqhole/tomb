// music domain wrapper functions
import { routes } from "./codegen/routes.js";
import type * as s from "./codegen/schema.js";
import { call } from "./client.js";

// artists
export function queryArtists(
  baseUrl: string,
  params: s.QueryParams,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "query_artists",
    routes.music.query_artists.resp,
    routes.music.query_artists.req,
    routes.music.query_artists.method,
    routes.music.query_artists.path,
    params,
    apiKey,
  );
}

export function getArtist(
  baseUrl: string,
  params: s.GetArtistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_artist",
    routes.music.get_artist.resp,
    routes.music.get_artist.req,
    routes.music.get_artist.method,
    routes.music.get_artist.path,
    params,
    apiKey,
  );
}

export function createArtist(
  baseUrl: string,
  params: s.CreateArtistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "create_artist",
    routes.music.create_artist.resp,
    routes.music.create_artist.req,
    routes.music.create_artist.method,
    routes.music.create_artist.path,
    params,
    apiKey,
  );
}

export function deleteArtist(
  baseUrl: string,
  params: s.DeleteArtistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "delete_artist",
    routes.music.delete_artist.resp,
    routes.music.delete_artist.req,
    routes.music.delete_artist.method,
    routes.music.delete_artist.path,
    params,
    apiKey,
  );
}

// albums
export function queryAlbums(
  baseUrl: string,
  params: s.QueryParams,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "query_albums",
    routes.music.query_albums.resp,
    routes.music.query_albums.req,
    routes.music.query_albums.method,
    routes.music.query_albums.path,
    params,
    apiKey,
  );
}

export function getAlbum(
  baseUrl: string,
  params: s.GetAlbumRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_album",
    routes.music.get_album.resp,
    routes.music.get_album.req,
    routes.music.get_album.method,
    routes.music.get_album.path,
    params,
    apiKey,
  );
}

export function deleteAlbum(
  baseUrl: string,
  params: s.DeleteAlbumRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "delete_album",
    routes.music.delete_album.resp,
    routes.music.delete_album.req,
    routes.music.delete_album.method,
    routes.music.delete_album.path,
    params,
    apiKey,
  );
}

// songs
export function querySongs(
  baseUrl: string,
  params: s.QueryParams,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "query_songs",
    routes.music.query_songs.resp,
    routes.music.query_songs.req,
    routes.music.query_songs.method,
    routes.music.query_songs.path,
    params,
    apiKey,
  );
}

export function recentSongs(
  baseUrl: string,
  params: s.RecentSongsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "recent_songs",
    routes.music.recent_songs.resp,
    routes.music.recent_songs.req,
    routes.music.recent_songs.method,
    routes.music.recent_songs.path,
    params,
    apiKey,
  );
}

export function updateSongs(
  baseUrl: string,
  params: s.UpdateSongsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "update_songs",
    routes.music.update_songs.resp,
    routes.music.update_songs.req,
    routes.music.update_songs.method,
    routes.music.update_songs.path,
    params,
    apiKey,
  );
}

export function deleteSong(
  baseUrl: string,
  params: s.DeleteSongRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "delete_song",
    routes.music.delete_song.resp,
    routes.music.delete_song.req,
    routes.music.delete_song.method,
    routes.music.delete_song.path,
    params,
    apiKey,
  );
}

// playlists
export function listPlaylists(
  baseUrl: string,
  params: s.QueryParams,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "list_playlists",
    routes.music.list_playlists.resp,
    routes.music.list_playlists.req,
    routes.music.list_playlists.method,
    routes.music.list_playlists.path,
    params,
    apiKey,
  );
}

export function getPlaylistById(
  baseUrl: string,
  params: { id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_playlist_by_id",
    routes.music.get_playlist_by_id.resp,
    routes.music.get_playlist_by_id.req,
    routes.music.get_playlist_by_id.method,
    routes.music.get_playlist_by_id.path,
    params,
    apiKey,
  );
}

export function createPlaylist(
  baseUrl: string,
  params: s.CreatePlaylistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "create_playlist",
    routes.music.create_playlist.resp,
    routes.music.create_playlist.req,
    routes.music.create_playlist.method,
    routes.music.create_playlist.path,
    params,
    apiKey,
  );
}

export function updatePlaylist(
  baseUrl: string,
  params: s.UpdatePlaylistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "update_playlist",
    routes.music.update_playlist.resp,
    routes.music.update_playlist.req,
    routes.music.update_playlist.method,
    routes.music.update_playlist.path,
    params,
    apiKey,
  );
}

export function deletePlaylist(
  baseUrl: string,
  params: s.DeletePlaylistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "delete_playlist",
    routes.music.delete_playlist.resp,
    routes.music.delete_playlist.req,
    routes.music.delete_playlist.method,
    routes.music.delete_playlist.path,
    params,
    apiKey,
  );
}

export function queryPlaylistSongs(
  baseUrl: string,
  params: s.QueryPlaylistSongsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "query_playlist_songs",
    routes.music.query_playlist_songs.resp,
    routes.music.query_playlist_songs.req,
    routes.music.query_playlist_songs.method,
    routes.music.query_playlist_songs.path,
    params,
    apiKey,
  );
}

export function addSongsToPlaylist(
  baseUrl: string,
  params: s.AddSongsToPlaylistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "add_songs_to_playlist",
    routes.music.add_songs_to_playlist.resp,
    routes.music.add_songs_to_playlist.req,
    routes.music.add_songs_to_playlist.method,
    routes.music.add_songs_to_playlist.path,
    params,
    apiKey,
  );
}

export function removeSongsFromPlaylist(
  baseUrl: string,
  params: s.RemoveSongsFromPlaylistRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "remove_songs_from_playlist",
    routes.music.remove_songs_from_playlist.resp,
    routes.music.remove_songs_from_playlist.req,
    routes.music.remove_songs_from_playlist.method,
    routes.music.remove_songs_from_playlist.path,
    params,
    apiKey,
  );
}

export function reorderPlaylistSongs(
  baseUrl: string,
  params: s.ReorderPlaylistSongsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "reorder_playlist_songs",
    routes.music.reorder_playlist_songs.resp,
    routes.music.reorder_playlist_songs.req,
    routes.music.reorder_playlist_songs.method,
    routes.music.reorder_playlist_songs.path,
    params,
    apiKey,
  );
}

export function removePlaylistThumbnail(
  baseUrl: string,
  params: s.RemovePlaylistThumbnailRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "remove_playlist_thumbnail",
    routes.music.remove_playlist_thumbnail.resp,
    routes.music.remove_playlist_thumbnail.req,
    routes.music.remove_playlist_thumbnail.method,
    routes.music.remove_playlist_thumbnail.path,
    params,
    apiKey,
  );
}

// genres
export function queryGenres(
  baseUrl: string,
  params: s.QueryParams,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "query_genres",
    routes.music.query_genres.resp,
    routes.music.query_genres.req,
    routes.music.query_genres.method,
    routes.music.query_genres.path,
    params,
    apiKey,
  );
}

export function getGenre(
  baseUrl: string,
  params: s.GetGenreRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_genre",
    routes.music.get_genre.resp,
    routes.music.get_genre.req,
    routes.music.get_genre.method,
    routes.music.get_genre.path,
    params,
    apiKey,
  );
}

export function listSubGenres(baseUrl: string, apiKey?: string) {
  return call(
    baseUrl,
    "music",
    "list_sub_genres",
    routes.music.list_sub_genres.resp,
    routes.music.list_sub_genres.req,
    routes.music.list_sub_genres.method,
    routes.music.list_sub_genres.path,
    undefined,
    apiKey,
  );
}

export function querySubGenres(
  baseUrl: string,
  params: s.QuerySubGenresRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "query_sub_genres",
    routes.music.query_sub_genres.resp,
    routes.music.query_sub_genres.req,
    routes.music.query_sub_genres.method,
    routes.music.query_sub_genres.path,
    params,
    apiKey,
  );
}

export function getSubGenre(
  baseUrl: string,
  params: s.GetSubGenreRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_sub_genre",
    routes.music.get_sub_genre.resp,
    routes.music.get_sub_genre.req,
    routes.music.get_sub_genre.method,
    routes.music.get_sub_genre.path,
    params,
    apiKey,
  );
}

export function createSubGenre(
  baseUrl: string,
  params: s.CreateSubGenreRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "create_sub_genre",
    routes.music.create_sub_genre.resp,
    routes.music.create_sub_genre.req,
    routes.music.create_sub_genre.method,
    routes.music.create_sub_genre.path,
    params,
    apiKey,
  );
}

export function deleteSubGenre(
  baseUrl: string,
  params: s.DeleteSubGenreRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "delete_sub_genre",
    routes.music.delete_sub_genre.resp,
    routes.music.delete_sub_genre.req,
    routes.music.delete_sub_genre.method,
    routes.music.delete_sub_genre.path,
    params,
    apiKey,
  );
}

export function listSubGenresForGenre(
  baseUrl: string,
  params: s.ListSubGenresForGenreRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "list_sub_genres_for_genre",
    routes.music.list_sub_genres_for_genre.resp,
    routes.music.list_sub_genres_for_genre.req,
    routes.music.list_sub_genres_for_genre.method,
    routes.music.list_sub_genres_for_genre.path,
    params,
    apiKey,
  );
}

export function findOrCreateSubGenre(
  baseUrl: string,
  params: s.FindOrCreateSubGenreRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "find_or_create_sub_genre",
    routes.music.find_or_create_sub_genre.resp,
    routes.music.find_or_create_sub_genre.req,
    routes.music.find_or_create_sub_genre.method,
    routes.music.find_or_create_sub_genre.path,
    params,
    apiKey,
  );
}

// favorites
export function listFavorites(
  baseUrl: string,
  params: s.ListFavoritesRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "list_favorites",
    routes.music.list_favorites.resp,
    routes.music.list_favorites.req,
    routes.music.list_favorites.method,
    routes.music.list_favorites.path,
    params,
    apiKey,
  );
}

export function setFavorite(
  baseUrl: string,
  params: s.SetFavoriteRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "set_favorite",
    routes.music.set_favorite.resp,
    routes.music.set_favorite.req,
    routes.music.set_favorite.method,
    routes.music.set_favorite.path,
    params,
    apiKey,
  );
}

// ratings
export function setRating(
  baseUrl: string,
  params: s.SetRatingRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "set_rating",
    routes.music.set_rating.resp,
    routes.music.set_rating.req,
    routes.music.set_rating.method,
    routes.music.set_rating.path,
    params,
    apiKey,
  );
}

export function removeRating(
  baseUrl: string,
  params: s.RemoveRatingRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "remove_rating",
    routes.music.remove_rating.resp,
    routes.music.remove_rating.req,
    routes.music.remove_rating.method,
    routes.music.remove_rating.path,
    params,
    apiKey,
  );
}

export function getRatingStats(
  baseUrl: string,
  params: s.GetRatingStatsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_rating_stats",
    routes.music.get_rating_stats.resp,
    routes.music.get_rating_stats.req,
    routes.music.get_rating_stats.method,
    routes.music.get_rating_stats.path,
    params,
    apiKey,
  );
}

// tags
export function listTags(baseUrl: string, apiKey?: string) {
  return call(
    baseUrl,
    "music",
    "list_tags",
    routes.music.list_tags.resp,
    routes.music.list_tags.req,
    routes.music.list_tags.method,
    routes.music.list_tags.path,
    undefined,
    apiKey,
  );
}

export function queryTags(
  baseUrl: string,
  params: s.QueryTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "query_tags",
    routes.music.query_tags.resp,
    routes.music.query_tags.req,
    routes.music.query_tags.method,
    routes.music.query_tags.path,
    params,
    apiKey,
  );
}

export function getTag(
  baseUrl: string,
  params: s.GetTagRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_tag",
    routes.music.get_tag.resp,
    routes.music.get_tag.req,
    routes.music.get_tag.method,
    routes.music.get_tag.path,
    params,
    apiKey,
  );
}

export function deleteTag(
  baseUrl: string,
  params: s.DeleteTagRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "delete_tag",
    routes.music.delete_tag.resp,
    routes.music.delete_tag.req,
    routes.music.delete_tag.method,
    routes.music.delete_tag.path,
    params,
    apiKey,
  );
}

export function getAlbumTags(
  baseUrl: string,
  params: s.GetAlbumTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_album_tags",
    routes.music.get_album_tags.resp,
    routes.music.get_album_tags.req,
    routes.music.get_album_tags.method,
    routes.music.get_album_tags.path,
    params,
    apiKey,
  );
}

export function addAlbumTags(
  baseUrl: string,
  params: s.AddAlbumTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "add_album_tags",
    routes.music.add_album_tags.resp,
    routes.music.add_album_tags.req,
    routes.music.add_album_tags.method,
    routes.music.add_album_tags.path,
    params,
    apiKey,
  );
}

export function removeAlbumTags(
  baseUrl: string,
  params: s.RemoveAlbumTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "remove_album_tags",
    routes.music.remove_album_tags.resp,
    routes.music.remove_album_tags.req,
    routes.music.remove_album_tags.method,
    routes.music.remove_album_tags.path,
    params,
    apiKey,
  );
}

export function replaceAlbumTags(
  baseUrl: string,
  params: s.ReplaceAlbumTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "replace_album_tags",
    routes.music.replace_album_tags.resp,
    routes.music.replace_album_tags.req,
    routes.music.replace_album_tags.method,
    routes.music.replace_album_tags.path,
    params,
    apiKey,
  );
}

// analytics
export function recordPlay(
  baseUrl: string,
  params: s.RecordPlayRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "record_play",
    routes.music.record_play.resp,
    routes.music.record_play.req,
    routes.music.record_play.method,
    routes.music.record_play.path,
    params,
    apiKey,
  );
}

export function songAnalytics(
  baseUrl: string,
  params: s.SongAnalyticsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "song_analytics",
    routes.music.song_analytics.resp,
    routes.music.song_analytics.req,
    routes.music.song_analytics.method,
    routes.music.song_analytics.path,
    params,
    apiKey,
  );
}

export function listeningHistory(
  baseUrl: string,
  params: s.ListeningHistoryRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "listening_history",
    routes.music.listening_history.resp,
    routes.music.listening_history.req,
    routes.music.listening_history.method,
    routes.music.listening_history.path,
    params,
    apiKey,
  );
}

export function topSongs(
  baseUrl: string,
  params: s.TopSongsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "top_songs",
    routes.music.top_songs.resp,
    routes.music.top_songs.req,
    routes.music.top_songs.method,
    routes.music.top_songs.path,
    params,
    apiKey,
  );
}

export function topArtists(
  baseUrl: string,
  params: s.TopArtistsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "top_artists",
    routes.music.top_artists.resp,
    routes.music.top_artists.req,
    routes.music.top_artists.method,
    routes.music.top_artists.path,
    params,
    apiKey,
  );
}

export function topAlbums(
  baseUrl: string,
  params: s.TopAlbumsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "top_albums",
    routes.music.top_albums.resp,
    routes.music.top_albums.req,
    routes.music.top_albums.method,
    routes.music.top_albums.path,
    params,
    apiKey,
  );
}

export function activityFeed(
  baseUrl: string,
  params: s.FeedRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "activity_feed",
    routes.music.activity_feed.resp,
    routes.music.activity_feed.req,
    routes.music.activity_feed.method,
    routes.music.activity_feed.path,
    params,
    apiKey,
  );
}

// musicbrainz
export function searchMusicbrainzReleases(
  baseUrl: string,
  params: s.SearchReleasesRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "search_musicbrainz_releases",
    routes.music.search_musicbrainz_releases.resp,
    routes.music.search_musicbrainz_releases.req,
    routes.music.search_musicbrainz_releases.method,
    routes.music.search_musicbrainz_releases.path,
    params,
    apiKey,
  );
}

export function getMusicbrainzRelease(
  baseUrl: string,
  params: s.GetReleaseRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_musicbrainz_release",
    routes.music.get_musicbrainz_release.resp,
    routes.music.get_musicbrainz_release.req,
    routes.music.get_musicbrainz_release.method,
    routes.music.get_musicbrainz_release.path,
    params,
    apiKey,
  );
}

// jobs
export function listJobs(
  baseUrl: string,
  params: s.ListJobsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "list_jobs",
    routes.music.list_jobs.resp,
    routes.music.list_jobs.req,
    routes.music.list_jobs.method,
    routes.music.list_jobs.path,
    params,
    apiKey,
  );
}

export function getJobStatus(
  baseUrl: string,
  params: s.GetJobRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_job_status",
    routes.music.get_job_status.resp,
    routes.music.get_job_status.req,
    routes.music.get_job_status.method,
    routes.music.get_job_status.path,
    params,
    apiKey,
  );
}

// fetch jobs
export function createFetchJob(
  baseUrl: string,
  params: s.FetchMediaParams,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "create_fetch_job",
    routes.music.create_fetch_job.resp,
    routes.music.create_fetch_job.req,
    routes.music.create_fetch_job.method,
    routes.music.create_fetch_job.path,
    params,
    apiKey,
  );
}

export function getFetchJob(
  baseUrl: string,
  params: { id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_fetch_job",
    routes.music.get_fetch_job.resp,
    routes.music.get_fetch_job.req,
    routes.music.get_fetch_job.method,
    routes.music.get_fetch_job.path,
    params,
    apiKey,
  );
}

// note: for blobs and uploads, see utils module
// - utils.getBlobUrl(baseUrl, blobId) - get streaming url for <audio src={...}>
// - utils.getBlobMetadataUrl(baseUrl, blobId) - get metadata endpoint url
// - utils.fetchBlobMetadata(baseUrl, blobId, apiKey) - fetch metadata as json
// - utils.uploadImage(baseUrl, file, apiKey) - upload image with FormData
// - utils.uploadMusic(baseUrl, file, apiKey) - upload music with FormData
