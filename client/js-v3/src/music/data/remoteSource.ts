// remote data source implementation
// queries remote server for music library data
import type {
    Album,
    Artist,
    Genre,
    MusicDataSource,
    PaginatedResponse,
    Playlist,
    QueryParams,
    Song,
} from "./types";

// remote data source implementation
// TODO: implement when server api is ready
export class RemoteMusicDataSource implements MusicDataSource {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  // helper to build query string from params
  private buildQueryString(params?: QueryParams): string {
    if (!params) return "";

    const searchParams = new URLSearchParams();

    if (params.limit !== undefined) searchParams.set("limit", params.limit.toString());
    if (params.offset !== undefined) searchParams.set("offset", params.offset.toString());
    if (params.sort_by) searchParams.set("sort_by", params.sort_by);
    if (params.sort_direction) searchParams.set("sort_direction", params.sort_direction);
    if (params.search) searchParams.set("search", params.search);
    if (params.artist) searchParams.set("artist", params.artist);
    if (params.album) searchParams.set("album", params.album);
    if (params.genre) searchParams.set("genre", params.genre);

    const qs = searchParams.toString();
    return qs ? `?${qs}` : "";
  }

  // helper to make authenticated fetch requests
  private async fetch<T>(path: string): Promise<T> {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`remote api error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // songs
  async getSongs(params?: QueryParams): Promise<PaginatedResponse<Song>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Song>>(`/api/songs${qs}`);
  }

  async getSongById(id: string): Promise<Song | null> {
    try {
      return await this.fetch<Song>(`/api/songs/${id}`);
    } catch (error) {
      console.error(`failed to fetch song ${id}:`, error);
      return null;
    }
  }

  // albums
  async getAlbums(params?: QueryParams): Promise<PaginatedResponse<Album>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Album>>(`/api/albums${qs}`);
  }

  async getAlbumById(id: string): Promise<Album | null> {
    try {
      return await this.fetch<Album>(`/api/albums/${id}`);
    } catch (error) {
      console.error(`failed to fetch album ${id}:`, error);
      return null;
    }
  }

  async getAlbumSongs(
    albumId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Song>>(`/api/albums/${albumId}/songs${qs}`);
  }

  // artists
  async getArtists(params?: QueryParams): Promise<PaginatedResponse<Artist>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Artist>>(`/api/artists${qs}`);
  }

  async getArtistById(id: string): Promise<Artist | null> {
    try {
      return await this.fetch<Artist>(`/api/artists/${id}`);
    } catch (error) {
      console.error(`failed to fetch artist ${id}:`, error);
      return null;
    }
  }

  async getArtistAlbums(
    artistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Album>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Album>>(`/api/artists/${artistId}/albums${qs}`);
  }

  async getArtistSongs(
    artistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Song>>(`/api/artists/${artistId}/songs${qs}`);
  }

  // genres
  async getGenres(params?: QueryParams): Promise<PaginatedResponse<Genre>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Genre>>(`/api/genres${qs}`);
  }

  async getGenreById(id: string): Promise<Genre | null> {
    try {
      return await this.fetch<Genre>(`/api/genres/${id}`);
    } catch (error) {
      console.error(`failed to fetch genre ${id}:`, error);
      return null;
    }
  }

  async getGenreSongs(
    genreId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Song>>(`/api/genres/${genreId}/songs${qs}`);
  }

  // playlists
  async getPlaylists(params?: QueryParams): Promise<PaginatedResponse<Playlist>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Playlist>>(`/api/playlists${qs}`);
  }

  async getPlaylistById(id: string): Promise<Playlist | null> {
    try {
      return await this.fetch<Playlist>(`/api/playlists/${id}`);
    } catch (error) {
      console.error(`failed to fetch playlist ${id}:`, error);
      return null;
    }
  }

  async getPlaylistSongs(
    playlistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Song>>(`/api/playlists/${playlistId}/songs${qs}`);
  }

  // source metadata
  async getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
    album_count: number;
    artist_count: number;
  }> {
    return this.fetch<{
      type: "local" | "remote";
      name: string;
      song_count: number;
      album_count: number;
      artist_count: number;
    }>("/api/info");
  }
}
