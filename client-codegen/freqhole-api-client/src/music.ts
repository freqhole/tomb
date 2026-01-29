// music domain wrapper functions
import { call } from "./client.js";
import { routes } from "./codegen/routes.js";
import type * as s from "./codegen/schema.js";
import {
  UpdateAlbumRequestSchema,
  UpdateArtistRequestSchema,
  UpdateSongsRequestSchema,
} from "./codegen/schema.js";
import { ListFavoritesResponseSchema } from "./favorites.js";

// partial schema for update_songs - makes all fields optional except song_ids
const UpdateSongsRequestPartialSchema =
  UpdateSongsRequestSchema.partial().required({ song_ids: true });

// partial schema for update_artist - makes all fields optional except artist_id
const UpdateArtistRequestPartialSchema =
  UpdateArtistRequestSchema.partial().required({ artist_id: true });

// partial schema for update_album - makes all fields optional except album_id
const UpdateAlbumRequestPartialSchema =
  UpdateAlbumRequestSchema.partial().required({ album_id: true });

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

export function updateArtist(
  baseUrl: string,
  params: Partial<s.UpdateArtistRequest> & { artist_id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "update_artist",
    routes.music.update_artist.resp,
    UpdateArtistRequestPartialSchema,
    routes.music.update_artist.method,
    routes.music.update_artist.path,
    params,
    apiKey,
  );
}

export function getArtistImages(
  baseUrl: string,
  params: { id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_artist_images",
    routes.music.get_artist_images.resp,
    routes.music.get_artist_images.req,
    routes.music.get_artist_images.method,
    routes.music.get_artist_images.path,
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

export function updateAlbum(
  baseUrl: string,
  params: Partial<s.UpdateAlbumRequest> & { album_id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "update_album",
    routes.music.update_album.resp,
    UpdateAlbumRequestPartialSchema,
    routes.music.update_album.method,
    routes.music.update_album.path,
    params,
    apiKey,
  );
}

export function getAlbumImages(
  baseUrl: string,
  params: { id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_album_images",
    routes.music.get_album_images.resp,
    routes.music.get_album_images.req,
    routes.music.get_album_images.method,
    routes.music.get_album_images.path,
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
  params: Partial<s.UpdateSongsRequest> & { song_ids: string[] },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "update_songs",
    routes.music.update_songs.resp,
    UpdateSongsRequestPartialSchema,
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

/**
 * get playlist etag for sync checking
 * returns etag header value or null if not supported
 */
export async function getPlaylistETag(
  baseUrl: string,
  playlistId: string,
  apiKey?: string,
): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/music/playlists/${playlistId}/etag`,
      {
        method: "HEAD",
        headers: headers,
        credentials: apiKey ? "omit" : "include",
      },
    );

    if (!response.ok) {
      return null;
    }

    const etag = response.headers.get("etag");
    return etag;
  } catch (err) {
    return null;
  }
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

export function getPlaylistImages(
  baseUrl: string,
  params: { id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_playlist_images",
    routes.music.get_playlist_images.resp,
    routes.music.get_playlist_images.req,
    routes.music.get_playlist_images.method,
    routes.music.get_playlist_images.path,
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
    ListFavoritesResponseSchema, // use hand-rolled schema instead of broken codegen
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

export function getAlbumsTags(
  baseUrl: string,
  params: s.GetAlbumsTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "get_albums_tags",
    routes.music.get_albums_tags.resp,
    routes.music.get_albums_tags.req,
    routes.music.get_albums_tags.method,
    routes.music.get_albums_tags.path,
    params,
    apiKey,
  );
}

export function addAlbumsTags(
  baseUrl: string,
  params: s.AddAlbumsTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "add_albums_tags",
    routes.music.add_albums_tags.resp,
    routes.music.add_albums_tags.req,
    routes.music.add_albums_tags.method,
    routes.music.add_albums_tags.path,
    params,
    apiKey,
  );
}

export function removeAlbumsTags(
  baseUrl: string,
  params: s.RemoveAlbumsTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "remove_albums_tags",
    routes.music.remove_albums_tags.resp,
    routes.music.remove_albums_tags.req,
    routes.music.remove_albums_tags.method,
    routes.music.remove_albums_tags.path,
    params,
    apiKey,
  );
}

export function replaceAlbumsTags(
  baseUrl: string,
  params: s.ReplaceAlbumsTagsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "replace_albums_tags",
    routes.music.replace_albums_tags.resp,
    routes.music.replace_albums_tags.req,
    routes.music.replace_albums_tags.method,
    routes.music.replace_albums_tags.path,
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

// search
export function suggestions(
  baseUrl: string,
  params: s.SuggestionsRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "suggestions",
    routes.music.suggestions.resp,
    routes.music.suggestions.req,
    routes.music.suggestions.method,
    routes.music.suggestions.path,
    params,
    apiKey,
  );
}

export function search(
  baseUrl: string,
  params: s.SearchRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "search",
    routes.music.search.resp,
    routes.music.search.req,
    routes.music.search.method,
    routes.music.search.path,
    params,
    apiKey,
  );
}

// blob streaming and metadata
export function streamBlob(
  baseUrl: string,
  params: { id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "stream_blob",
    routes.music.stream_blob.resp,
    routes.music.stream_blob.req,
    routes.music.stream_blob.method,
    routes.music.stream_blob.path,
    params,
    apiKey,
  );
}

export function blobMetadata(
  baseUrl: string,
  params: { id: string },
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "blob_metadata",
    routes.music.blob_metadata.resp,
    routes.music.blob_metadata.req,
    routes.music.blob_metadata.method,
    routes.music.blob_metadata.path,
    params,
    apiKey,
  );
}

// uploads
export function uploadImage(
  baseUrl: string,
  params: FormData,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "upload_image",
    routes.music.upload_image.resp,
    routes.music.upload_image.req,
    routes.music.upload_image.method,
    routes.music.upload_image.path,
    params,
    apiKey,
  );
}

export function deleteImage(
  baseUrl: string,
  params: s.DeleteImageRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "delete_image",
    routes.music.delete_image.resp,
    routes.music.delete_image.req,
    routes.music.delete_image.method,
    routes.music.delete_image.path,
    params,
    apiKey,
  );
}

export function setPrimaryImage(
  baseUrl: string,
  params: s.SetPrimaryImageRequest,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "set_primary_image",
    routes.music.set_primary_image.resp,
    routes.music.set_primary_image.req,
    routes.music.set_primary_image.method,
    routes.music.set_primary_image.path,
    params,
    apiKey,
  );
}

export function uploadMusic(
  baseUrl: string,
  params: FormData,
  apiKey?: string,
) {
  return call(
    baseUrl,
    "music",
    "upload_music",
    routes.music.upload_music.resp,
    routes.music.upload_music.req,
    routes.music.upload_music.method,
    routes.music.upload_music.path,
    params,
    apiKey,
  );
}

// note: for blobs and uploads, see utils module for additional helpers
// - utils.getBlobUrl(baseUrl, blobId) - get streaming url for <audio src={...}>
// - utils.getBlobMetadataUrl(baseUrl, blobId) - get metadata endpoint url
// - utils.fetchBlobMetadata(baseUrl, blobId, apiKey) - fetch metadata as json
// - utils.uploadImage(baseUrl, file, apiKey) - upload image with FormData (recommended)
// - utils.uploadMusic(baseUrl, file, apiKey) - upload music with FormData (recommended)
