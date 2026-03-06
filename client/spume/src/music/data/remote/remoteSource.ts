// remote data source implementation
// queries remote server for music library data via app/api/client facade
import {
  createHttpClient,
  isAuthError,
  isNetworkError,
  permissions,
  utils,
  type ApiClient,
  type ApiQueryParams,
  type SafeParseResult,
} from "../../../app/api/client";
import type {
  AlbumSummary,
  ArtistSummary,
  FavoriteItem,
  FavoriteTarget,
  GenreSummary,
  ListFavoritesParams,
  MusicDataSource,
  PaginatedResponse,
  PlaylistSummary,
  QueryParams,
  SearchField,
  SearchResponse,
  SuggestionsResponse,
} from "../types";
import { adaptSongFromAPI, adaptApiImage, adaptApiUrls, type RemoteSong } from "./adapters";
import { setRemoteNeedsAuth } from "./authState";
import { markRemoteOffline, getRemoteById } from "../../../app/services/remotes/remoteManager";
import { getCurrentUser } from "../index";
import { debug, error } from "../../../utils/logger";
import { getRemoteMediaUrl } from "../../../utils/urls";
import { toast } from "../../../components/feedback/Toast";

// custom error class for remote offline errors - views can check for this type
export class RemoteOfflineError extends Error {
  readonly remoteId: string;
  readonly remoteName: string;

  constructor(remoteId: string, remoteName: string) {
    super(`${remoteName} is offline`);
    this.name = "RemoteOfflineError";
    this.remoteId = remoteId;
    this.remoteName = remoteName;
  }
}

// remote data source implementation
// uses session cookies for authentication (no api key needed)
export class RemoteMusicDataSource implements MusicDataSource {
  private baseUrl: string;
  private remoteId: string;
  private client: ApiClient;
  // track if we've already shown the offline toast this session
  private hasShownOfflineToast = false;

  constructor(baseUrl: string, remoteId: string) {
    this.baseUrl = baseUrl;
    this.remoteId = remoteId;
    this.client = createHttpClient(baseUrl);
  }

  // check a failed result for 401 auth errors and flag the remote if needed.
  // call this before throwing on any API failure.
  private checkAuthError(result: SafeParseResult<unknown>): void {
    if (isAuthError(result)) {
      setRemoteNeedsAuth(this.remoteId);
    }
  }

  // check a failed result for network errors (server unreachable).
  // marks the remote as offline and throws RemoteOfflineError.
  private async checkNetworkError(result: SafeParseResult<unknown>): Promise<void> {
    if (!isNetworkError(result)) return;

    // mark remote as offline in IDB
    await markRemoteOffline(this.remoteId);

    // get remote name for the error/toast
    const remote = await getRemoteById(this.remoteId);
    const remoteName = remote?.name ?? this.remoteId;

    // only show toast once per session to avoid spam
    if (!this.hasShownOfflineToast) {
      this.hasShownOfflineToast = true;
      toast.warning(`${remoteName} is offline`);
    }

    throw new RemoteOfflineError(this.remoteId, remoteName);
  }

  // helper to convert our QueryParams to API QueryParams
  private buildApiParams(params?: QueryParams): ApiQueryParams {
    const filters: Record<string, any> = {};

    // map our individual filter fields to the filters object
    if (params?.artist_id) filters.artist_id = params.artist_id;
    if (params?.album_id) filters.album_id = params.album_id;
    if (params?.genre_id) filters.genre_id = params.genre_id;

    // map tag filters
    if (params?.include_tags && params.include_tags.length > 0) {
      filters.include_tags = params.include_tags;
    }
    if (params?.exclude_tags && params.exclude_tags.length > 0) {
      filters.exclude_tags = params.exclude_tags;
    }

    return {
      q: params?.search || null,
      search_fields: null,
      filters,
      sort_by: params?.sort_by || null,
      sort_direction: params?.sort_direction || null,
      limit: params?.limit || null,
      offset: params?.offset || null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    };
  }

  // songs
  async getSongs(params?: QueryParams): Promise<PaginatedResponse<RemoteSong>> {
    const apiParams = this.buildApiParams(params);
    const result = await this.client.music.querySongs(apiParams);

    if (!result.success) {
      await this.checkNetworkError(result);
      this.checkAuthError(result);
      throw new Error("failed to query songs");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item, this.baseUrl, this.remoteId),
      ),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getSongById(id: string): Promise<RemoteSong | null> {
    // note: there's no getSong endpoint in the API yet
    // we'll need to query with filter
    const filters: Record<string, any> = { song_ids: [id] };
    const result = await this.client.music.querySongs({
      q: null,
      search_fields: null,
      filters,
      sort_by: null,
      sort_direction: null,
      limit: 1,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });

    if (!result.success || result.data.items.length === 0) {
      if (!result.success) this.checkAuthError(result);
      return null;
    }

    return adaptSongFromAPI(result.data.items[0], this.baseUrl, this.remoteId);
  }

  async getSongsByIds(ids: string[]): Promise<RemoteSong[]> {
    if (ids.length === 0) return [];

    // batch fetch all songs in a single request using song_ids filter
    const filters: Record<string, any> = { song_ids: ids };
    const result = await this.client.music.querySongs({
      q: null,
      search_fields: null,
      filters,
      sort_by: null,
      sort_direction: null,
      limit: ids.length,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      return [];
    }

    // build a map for fast lookup and preserve original order
    const songMap = new Map<string, RemoteSong>();
    for (const item of result.data.items) {
      const song = adaptSongFromAPI(item, this.baseUrl, this.remoteId);
      songMap.set(song.id, song);
    }

    // return songs in the same order as the input IDs, filtering out any not found
    return ids.map((id) => songMap.get(id)).filter((s): s is RemoteSong => s != null);
  }

  // albums
  async getAlbums(
    params?: QueryParams,
  ): Promise<PaginatedResponse<AlbumSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await this.client.music.queryAlbums(apiParams);

    if (!result.success) {
      await this.checkNetworkError(result);
      this.checkAuthError(result);
      throw new Error("failed to query albums");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => {
        return {
          album_id: item.album.id,
          title: item.album.title,
          artist_id: item.artist?.id || "",
          artist_name: item.artist?.name || "unknown artist",
          album_type: item.album.album_type,
          year: undefined, // TODO: extract year from release_date if present
          release_date: item.album.release_date ?? undefined,
          label: item.album.label ?? undefined,
          genres: item.album.genres ?? undefined,
          song_count: item.album.song_count,
          total_duration: item.album.total_duration,
          images: item.images && item.images.length > 0
            ? item.images.map((img) => adaptApiImage(img, this.baseUrl))
            : undefined,
          urls: adaptApiUrls(item.album.urls),
          is_favorite: item.is_favorite ?? undefined,
          user_rating: item.rating ?? undefined,
          tags: item.album_tags ?? undefined,
          created_at: item.album.created_at,
          updated_at: item.album.updated_at,
          created_by_username: item.album.created_by_username ?? undefined,
          updated_by_username: item.album.updated_by_username ?? undefined,
        };
      }),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getAlbumSongs(
    albumId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<RemoteSong>> {
    const apiParams = this.buildApiParams({
      ...params,
      album_id: albumId,
    });

    const result = await this.client.music.querySongs(apiParams);

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to query album songs");
    }

    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item, this.baseUrl, this.remoteId),
      ),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // artists
  async getArtists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<ArtistSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await this.client.music.queryArtists(apiParams);

    if (!result.success) {
      await this.checkNetworkError(result);
      this.checkAuthError(result);
      throw new Error("failed to query artists");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => {
        return {
          artist_id: item.artist.id,
          name: item.artist.name,
          bio: item.artist.bio,
          album_count: item.album_count,
          song_count: item.song_count,
          total_duration: item.total_duration ? Math.floor(item.total_duration / 1000) : 0, // convert ms to seconds
          images: item.images && item.images.length > 0
            ? item.images.map((img) => adaptApiImage(img, this.baseUrl))
            : undefined,
          urls: adaptApiUrls(item.artist.urls),
          is_favorite: item.is_favorite ?? undefined,
          user_rating: item.rating ?? undefined,
        };
      }),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getArtistSongs(
    artistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<RemoteSong>> {
    const apiParams = this.buildApiParams({
      ...params,
      artist_id: artistId,
    });

    const result = await this.client.music.querySongs(apiParams);

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to query artist songs");
    }

    const mappedItems = result.data.items.map((item) =>
      adaptSongFromAPI(item, this.baseUrl, this.remoteId),
    );

    return {
      items: mappedItems,
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // genres
  async getGenres(
    params?: QueryParams,
  ): Promise<PaginatedResponse<GenreSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await this.client.music.queryGenres(apiParams);

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to query genres");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => ({
        genre_id: item.genre.id,
        name: item.genre.name,
        album_count: item.album_count || 0,
        song_count: item.song_count || 0,
      })),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getGenreSongs(
    genreId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<RemoteSong>> {
    const apiParams = this.buildApiParams({
      ...params,
      genre_id: genreId,
    });

    const result = await this.client.music.querySongs(apiParams);

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to query genre songs");
    }

    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item, this.baseUrl, this.remoteId),
      ),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // playlists
  async getPlaylists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<PlaylistSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await this.client.music.listPlaylists(apiParams);

    if (!result.success) {
      await this.checkNetworkError(result);
      this.checkAuthError(result);
      throw new Error("failed to query playlists");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => ({
        playlist_id: item.playlist.id,
        title: item.playlist.title,
        description: item.playlist.description,
        is_public: item.playlist.is_public === 1,
        images: item.playlist.images && item.playlist.images.length > 0
          ? item.playlist.images.map((img) => adaptApiImage(img, this.baseUrl))
          : undefined,
        urls: adaptApiUrls(item.playlist.urls),
        song_count: item.song_count,
        created_at: item.playlist.created_at * 1000, // convert seconds to milliseconds
        updated_at: item.playlist.updated_at * 1000, // convert seconds to milliseconds
        is_favorite: item.is_favorite ?? undefined,
        created_by_id: item.playlist.created_by_id,
      })),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getPlaylistSongs(
    playlistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<RemoteSong>> {
    const result = await this.client.music.queryPlaylistSongs({
      playlist_id: playlistId,
      q: params?.search || null,
      sort_by: params?.sort_by || null,
      sort_direction: params?.sort_direction || null,
      limit: params?.limit || null,
      offset: params?.offset || null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to query playlist songs");
    }

    // adapt API response to our interface
    // playlist songs have same structure as regular song queries
    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item.details, this.baseUrl, this.remoteId),
      ),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async createPlaylist(params: {
    title: string;
    description?: string | null;
    is_public?: boolean;
  }): Promise<PlaylistSummary> {
    const result = await this.client.music.createPlaylist({
      title: params.title,
      description: params.description || null,
      is_public: params.is_public ?? false,
      created_by_id: null, // server will use authenticated user
    });

    if (!result.success) {
      this.checkAuthError(result);
      console.error("create playlist failed:", result);
      throw new Error("failed to create playlist - check console for details");
    }

    return {
      playlist_id: result.data.id,
      title: result.data.title,
      description: result.data.description,
      is_public: result.data.is_public === 1,
      song_count: result.data.song_count,
      created_at: result.data.created_at * 1000, // convert seconds to milliseconds
      updated_at: result.data.updated_at * 1000, // convert seconds to milliseconds
    };
  }

  async updatePlaylist(
    playlistId: string,
    params: {
      title?: string | null;
      description?: string | null;
      is_public?: boolean | null;
      entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }>;
    },
  ): Promise<PlaylistSummary> {
    const result = await this.client.music.updatePlaylist({
      playlist_id: playlistId,
      title: params.title || null,
      description: params.description || null,
      is_public: params.is_public ?? null,
      entity_urls: params.entity_urls?.map(u => ({ id: u.id ?? null, name: u.name ?? null, url: u.url })) ?? null,
      updated_by: null, // server will use authenticated user
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to update playlist");
    }

    return {
      playlist_id: result.data.id,
      title: result.data.title,
      description: result.data.description,
      is_public: result.data.is_public === 1,
      song_count: result.data.song_count,
      created_at: result.data.created_at * 1000, // convert seconds to milliseconds
      updated_at: result.data.updated_at * 1000, // convert seconds to milliseconds
    };
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    const result = await this.client.music.deletePlaylist({
      playlist_id: playlistId,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to delete playlist");
    }
  }

  async deleteSong(songId: string): Promise<void> {
    const result = await this.client.music.deleteSong({
      id: songId,
      user_id: null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to delete song");
    }
  }

  async deleteAlbum(albumId: string): Promise<void> {
    const result = await this.client.music.deleteAlbum({
      id: albumId,
      user_id: null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to delete album");
    }
  }

  async deleteArtist(artistId: string): Promise<void> {
    const result = await this.client.music.deleteArtist({
      id: artistId,
      user_id: null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to delete artist");
    }
  }

  async addSongsToPlaylist(
    playlistId: string,
    songIds: string[],
  ): Promise<void> {
    const result = await this.client.music.addSongsToPlaylist({
      playlist_id: playlistId,
      song_ids: songIds,
    });

    if (!result.success) {
      this.checkAuthError(result);
      console.error("add songs to playlist failed:", result);
      throw new Error(
        "failed to add songs to playlist - check console for details",
      );
    }
  }

  async removeSongsFromPlaylist(
    playlistId: string,
    songIds: string[],
  ): Promise<void> {
    const result = await this.client.music.removeSongsFromPlaylist({
      playlist_id: playlistId,
      song_ids: songIds,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to remove songs from playlist");
    }
  }

  async reorderPlaylistSongs(
    playlistId: string,
    songIds: string[],
    newPosition: number,
  ): Promise<void> {
    const result = await this.client.music.reorderPlaylistSongs({
      playlist_id: playlistId,
      song_ids: songIds,
      new_position: newPosition,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to reorder playlist songs");
    }
  }

  // search suggestions
  async searchSuggestions(params: {
    field: SearchField;
    partial: string;
    page?: number;
    page_size?: number;
  }): Promise<SuggestionsResponse> {
    const result = await this.client.music.suggestions({
      field: params.field,
      partial: params.partial,
      page: params.page || 1,
      page_size: params.page_size || 10,
      context: null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to get search suggestions");
    }

    return result.data;
  }

  // full search
  async search(params: {
    query: string;
    field?: SearchField | null;
    page?: number;
    page_size?: number;
  }): Promise<SearchResponse> {
    const result = await this.client.music.search({
      query: params.query,
      field: params.field || null,
      page: params.page || null,
      page_size: params.page_size || null,
      context: null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to search");
    }

    return result.data;
  }

  // favorites
  async listFavorites(
    params?: ListFavoritesParams,
  ): Promise<PaginatedResponse<FavoriteItem>> {
    const result = await this.client.music.listFavorites({
      user_id: null, // server uses authenticated user from session
      target_type: params?.target_type || null,
      offset: params?.offset ?? null,
      limit: params?.limit ?? null,
    });

    if (!result.success || !result.data) {
      if (!result.success) this.checkAuthError(result);
      const errorMsg = result.success === false && 'error' in result 
        ? JSON.stringify(result.error) 
        : 'unknown error';
      throw new Error(`failed to list favorites: ${errorMsg}`);
    }

    // transform API's discriminated union to app's discriminated union
    const items: FavoriteItem[] = result.data.favorites.map((apiFav) => {
      switch (apiFav.type) {
        case "song":
          return {
            type: "song" as const,
            favorited_at: apiFav.favorited_at,
            data: adaptSongFromAPI(apiFav.song, this.baseUrl, this.remoteId),
          };
        case "album":
          return {
            type: "album" as const,
            favorited_at: apiFav.favorited_at,
            data: {
              album_id: apiFav.album.album.id,
              title: apiFav.album.album.title,
              artist_id: apiFav.album.artist?.id || "",
              artist_name: apiFav.album.artist?.name || "unknown artist",
              album_type: apiFav.album.album.album_type,
              year: undefined,
              release_date: apiFav.album.album.release_date || undefined,
              label: apiFav.album.album.label || undefined,
              genres: apiFav.album.album.genres || undefined,
              song_count: apiFav.album.album.song_count,
              total_duration: apiFav.album.album.total_duration,
              images: apiFav.album.images && apiFav.album.images.length > 0
                ? apiFav.album.images.map((img) => ({
                    remote_url: getRemoteMediaUrl(this.baseUrl, img.blob_id),
                    is_primary: img.is_primary ? true : false,
                    blob_type: 'thumbnail' as const,
                  }))
                : undefined,
              is_favorite: apiFav.album.is_favorite,
              user_rating: apiFav.album.rating,
              tags: apiFav.album.album_tags || undefined,
              created_at: apiFav.album.album.created_at,
              updated_at: apiFav.album.album.updated_at,
              created_by_username: apiFav.album.album.created_by_username ?? undefined,
              updated_by_username: apiFav.album.album.updated_by_username ?? undefined,
            } as AlbumSummary,
          };
        case "artist":
          return {
            type: "artist" as const,
            favorited_at: apiFav.favorited_at,
            data: {
              artist_id: apiFav.artist.artist.id,
              name: apiFav.artist.artist.name,
              bio: apiFav.artist.artist.bio,
              album_count: apiFav.artist.album_count,
              song_count: apiFav.artist.song_count,
              total_duration: apiFav.artist.total_duration ? Math.floor(apiFav.artist.total_duration / 1000) : 0,
              images: apiFav.artist.images && apiFav.artist.images.length > 0
                ? apiFav.artist.images.map((img) => ({
                    remote_url: getRemoteMediaUrl(this.baseUrl, img.blob_id),
                    is_primary: img.is_primary ? true : false,
                    blob_type: 'thumbnail' as const,
                  }))
                : undefined,
              is_favorite: apiFav.artist.is_favorite,
              user_rating: apiFav.artist.rating,
            } as ArtistSummary,
          };
        case "playlist":
          return {
            type: "playlist" as const,
            favorited_at: apiFav.favorited_at,
            data: {
              playlist_id: apiFav.playlist.playlist.id,
              title: apiFav.playlist.playlist.title,
              description: apiFav.playlist.playlist.description,
              is_public: apiFav.playlist.playlist.is_public === 1,
              images: (apiFav.playlist.playlist.images || []).map((img) => ({
                blob_id: img.blob_id,
                remote_url: getRemoteMediaUrl(this.baseUrl, img.blob_id),
                is_primary: img.is_primary === 1,
                blob_type: img.blob_type as 'thumbnail' | 'waveform',
              })),
              song_count: apiFav.playlist.song_count,
              created_at: apiFav.playlist.playlist.created_at * 1000,
              updated_at: apiFav.playlist.playlist.updated_at * 1000,
              is_favorite: apiFav.playlist.is_favorite,
            } as PlaylistSummary,
          };
      }
    });

    return {
      items,
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // mutations
  async setFavorite(params: {
    targetType: FavoriteTarget;
    targetId: string;
    isFavorite: boolean;
  }): Promise<void> {
    const result = await this.client.music.setFavorite({
      user_id: null, // server will use authenticated user from session
      target_type: params.targetType,
      target_id: params.targetId,
      is_favorite: params.isFavorite,
    });

    if (!result.success) {
      this.checkAuthError(result);
      const errorMsg = 'error' in result ? JSON.stringify(result.error) : 'unknown error';
      throw new Error(`failed to set favorite: ${errorMsg}`);
    }

    if (!result.data?.success) {
      throw new Error(result.data?.message || "failed to set favorite");
    }
  }

  async setRating(params: {
    targetType: "song" | "album" | "artist";
    targetId: string;
    rating: number;
  }): Promise<void> {
    // validate rating
    if (params.rating < 0 || params.rating > 5) {
      throw new Error("rating must be between 0 and 5");
    }

    const result = await this.client.music.setRating({
      user_id: null, // server will use authenticated user from session
      target_type: params.targetType,
      target_id: params.targetId,
      rating: params.rating,
    });

    if (!result.success) {
      this.checkAuthError(result);
      const errorMsg = 'error' in result ? JSON.stringify(result.error) : 'unknown error';
      throw new Error(`failed to set rating: ${errorMsg}`);
    }

    if (!result.data?.success) {
      throw new Error(result.data?.message || "failed to set rating");
    }
  }

  async updateArtist(params: {
    artist_id: string;
    name?: string;
    bio?: string;
    entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }>;
  }): Promise<void> {
    const result = await this.client.music.updateArtist({
      artist_id: params.artist_id,
      name: params.name ?? null,
      bio: params.bio ?? null,
      entity_urls: params.entity_urls?.map(u => ({ id: u.id ?? null, name: u.name ?? null, url: u.url })) ?? null,
      updated_by: null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to update artist");
    }
  }

  async updateAlbum(params: {
    album_id: string;
    title?: string;
    artist_id?: string;
    artist_name?: string;
    album_type?: string;
    release_date?: string;
    label?: string;
    genre_ids?: string[];
    genres?: string[]; // new genre names to create
    year?: number;
    entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }>;
    merge_into_album_id?: string;
  }): Promise<void> {
    const result = await this.client.music.updateAlbum({
      album_id: params.album_id,
      title: params.title ?? null,
      artist_id: params.artist_id ?? null,
      artist_name: params.artist_name ?? null,
      album_type: params.album_type ?? null,
      release_date: params.release_date ?? null,
      label: params.label ?? null,
      genre_ids: params.genre_ids ?? null,
      genres: params.genres ?? null,
      entity_urls: params.entity_urls?.map(u => ({ id: u.id ?? null, name: u.name ?? null, url: u.url })) ?? null,
      updated_by: null,
      merge_into_album_id: params.merge_into_album_id ?? null,
    });

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to update album");
    }
  }

  async updateSong(params: {
    song_ids: string[];
    title?: string | null;
    artist?: string | null;
    artist_id?: string | null;
    album?: string | null;
    album_id?: string | null;
    genre?: string | null;
    genre_id?: string | null;
    track_number?: number | null;
    disc_number?: number | null;
    year?: number | null;
    duration?: number | null;
    bpm?: number | null;
    lyrics?: string | null;
    track_artist?: string | null;
    entity_urls?: Array<{ id?: string; name?: string | null; url: string }>;
    user_id?: string | null;
    updated_by?: string | null;
  }): Promise<void> {
    // map simpler params to API schema
    // prefer _id fields when available, fall back to string name fields
    const apiParams: any = {
      song_ids: params.song_ids,
      title: params.title,
      artist_id: params.artist_id,      // direct ID (preferred)
      artist_name: params.artist,        // name fallback
      album_id: params.album_id,         // direct ID (preferred)
      album_title: params.album,         // name fallback
      track_number: params.track_number,
      disc_number: params.disc_number,
      year: params.year,
      duration: params.duration,
      bpm: params.bpm,
      lyrics: params.lyrics,
      track_artist: params.track_artist,
      genre: params.genre,
      entity_urls: params.entity_urls,
      user_id: params.user_id,
      updated_by: params.updated_by,
    };
    
    const result = await this.client.music.updateSongs(apiParams);

    if (!result.success) {
      this.checkAuthError(result);
      // #TODO: should be able to remove the `as any` cast after turning strict mode on!
      const err = result.error;
      console.error("updateSongs failed:", err);
      throw new Error(`failed to update song: ${err?.message || JSON.stringify(err)}`);
    }
  }

  async getTags(): Promise<{ tag_id: string; name: string; created_at: number }[]> {
    const result = await this.client.music.listTags();

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to get tags");
    }

    return result.data.map((tag: any) => ({
      tag_id: tag.id,
      name: tag.name,
      created_at: tag.created_at,
    }));
  }

  async addTag(_params: { name: string }): Promise<void> {
    // Note: there may not be an addTag endpoint, might need to be done via album/song tagging
    throw new Error("addTag not implemented for remote source");
  }

  async deleteTag(_params: { name: string }): Promise<void> {
    // Note: there may not be a deleteTag endpoint
    throw new Error("deleteTag not implemented for remote source");
  }

  // source metadata
  async getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
  }> {
    // use whoami to get server info
    const result = await this.client.auth.whoami();

    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to get source info");
    }

    return {
      type: "remote",
      name: result.data.username || this.baseUrl,
      song_count: 0, // TODO: get actual song count from API
    };
  }

  // album tags
  async getAlbumTags(albumId: string): Promise<string[]> {
    const result = await this.client.music.getAlbumsTags({ album_ids: [albumId] });
    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to get album tags");
    }
    return result.data.map((t: any) => t.tag.name);
  }

  async addTagsToAlbum(albumId: string, tagNames: string[]): Promise<void> {
    const result = await this.client.music.addAlbumsTags({ album_ids: [albumId], tag_ids: [], tag_names: tagNames });
    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to add tags to album");
    }
  }

  async removeTagsFromAlbum(albumId: string, tagIds: string[]): Promise<void> {
    const result = await this.client.music.removeAlbumsTags({ album_ids: [albumId], tag_ids: tagIds });
    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to remove tags from album");
    }
  }

  // image operations - delegate to API client
  async uploadImage(params: {
    file: File;
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    isPrimary?: boolean;
  }): Promise<{ blob_id: string; job_id: string }> {
    const result = await utils.uploadImage(this.baseUrl, params.file, {
      associate: {
        entity_type: params.entityType,
        entity_id: params.entityId,
        is_primary: params.isPrimary ?? false,
      },
    });
    
    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to upload image");
    }
    
    return { blob_id: result.data.blob_id, job_id: result.data.job_id };
  }

  async getEntityImages(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
  }): Promise<string[]> {
    // map entity type to API function
    switch (params.entityType) {
      case 'artist': {
        const result = await this.client.music.getArtistImages({ id: params.entityId });
        if (!result.success) {
          this.checkAuthError(result);
          throw new Error("failed to get artist images");
        }
        return result.data.map((blobId: string) => getRemoteMediaUrl(this.baseUrl, blobId));
      }
      case 'album':
      case 'song':
      case 'playlist':
        // TODO: implement album/song/playlist image APIs once available
        return [];
      default:
        throw new Error(`unsupported entity type: ${params.entityType}`);
    }
  }

  async removeImage(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    blobId: string;
  }): Promise<void> {
    debug("remoteSource", 'removeImage called with:', params);
    
    const result = await this.client.music.deleteImage({
      entity_type: params.entityType,
      entity_id: params.entityId,
      blob_id: params.blobId,
    });
    
    debug("remoteSource", 'deleteImage result:', result);
    
    if (!result.success) {
      this.checkAuthError(result);
      error("remoteSource", 'deleteImage failed:', result);
      throw new Error("failed to remove image");
    }
  }

  async setPrimaryImage(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    blobId: string;
  }): Promise<void> {
    const result = await this.client.music.setPrimaryImage({
      entity_type: params.entityType,
      entity_id: params.entityId,
      blob_id: params.blobId,
    });
    
    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to set primary image");
    }
  }

  // permission checks - use api-client permission helpers with current user context
  canDeletePlaylist(playlist: { created_by_id?: string | null }): boolean {
    const user = getCurrentUser();
    if (!user) return false;
    return permissions.canDeletePlaylist(user.userId, playlist.created_by_id ?? null, user.role);
  }

  canUpdatePlaylist(playlist: { created_by_id?: string | null }): boolean {
    const user = getCurrentUser();
    if (!user) return false;
    return permissions.canUpdatePlaylist(user.userId, playlist.created_by_id ?? null, user.role);
  }

  canDeleteSong(): boolean {
    const user = getCurrentUser();
    if (!user) return false;
    return permissions.canDeleteSong(user.role);
  }

  canDeleteAlbum(): boolean {
    const user = getCurrentUser();
    if (!user) return false;
    return permissions.canDeleteAlbum(user.role);
  }

  canDeleteArtist(): boolean {
    const user = getCurrentUser();
    if (!user) return false;
    return permissions.canDeleteArtist(user.role);
  }

  // listen session operations
  async getListenSession(sessionId: string): Promise<import("../types").ListenSession | null> {
    const result = await this.client.music.getListenSession(sessionId);
    if (!result.success) {
      this.checkAuthError(result);
      return null;
    }
    const data = result.data;
    return {
      id: data.id,
      user_id: data.user_id,
      session_type: data.session_type,
      entity_id: data.entity_id ?? null,
      label: data.label,
      status: data.status,
      song_ids: data.song_ids,
      total_songs: data.total_songs,
      songs_completed: data.songs_completed,
      current_song_index: data.current_song_index,
      current_song_position_ms: data.current_song_position_ms,
      progress_percent: data.progress_percent,
      total_duration_ms: data.total_duration_ms,
      listened_duration_ms: data.listened_duration_ms,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  async deleteListenSession(sessionId: string): Promise<void> {
    const result = await this.client.music.deleteListenSession(sessionId);
    if (!result.success) {
      this.checkAuthError(result);
      throw new Error("failed to delete listen session");
    }
  }

  // musicbrainz operations
  async searchMusicbrainzReleases(params: {
    artist: string | null;
    release: string | null;
    limit: number | null;
    offset: number | null;
  }): Promise<import("../types").MbSearchReleasesResponse | null> {
    const result = await this.client.music.searchMusicbrainzReleases(params);
    if (!result.success) {
      this.checkAuthError(result);
      return null;
    }
    return result.data;
  }

  async getMusicbrainzRelease(mbid: string): Promise<import("../types").MbReleaseDetail | null> {
    const result = await this.client.music.getMusicbrainzRelease({ mbid });
    if (!result.success) {
      this.checkAuthError(result);
      return null;
    }
    return result.data;
  }
}
