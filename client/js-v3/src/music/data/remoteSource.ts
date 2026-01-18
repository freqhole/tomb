// remote data source implementation
// queries remote server for music library data
import type {
  AlbumSummary,
  ArtistSummary,
  MusicDataSource,
  PaginatedResponse,
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

    if (params.limit !== undefined)
      searchParams.set("limit", params.limit.toString());
    if (params.offset !== undefined)
      searchParams.set("offset", params.offset.toString());
    if (params.sort_by) searchParams.set("sort_by", params.sort_by);
    if (params.sort_direction)
      searchParams.set("sort_direction", params.sort_direction);
    if (params.search) searchParams.set("search", params.search);
    if (params.artist_id) searchParams.set("artist_id", params.artist_id);
    if (params.album_id) searchParams.set("album_id", params.album_id);
    if (params.genre_id) searchParams.set("genre_id", params.genre_id);

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
      throw new Error(
        `remote api error: ${response.status} ${response.statusText}`,
      );
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
  async getAlbums(
    params?: QueryParams,
  ): Promise<PaginatedResponse<AlbumSummary>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<AlbumSummary>>(`/api/albums${qs}`);
  }

  async getAlbumSongs(
    albumId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Song>>(
      `/api/albums/${albumId}/songs${qs}`,
    );
  }

  // artists
  async getArtists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<ArtistSummary>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<ArtistSummary>>(`/api/artists${qs}`);
  }

  async getArtistSongs(
    artistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const qs = this.buildQueryString(params);
    return this.fetch<PaginatedResponse<Song>>(
      `/api/artists/${artistId}/songs${qs}`,
    );
  }

  // note: genres and playlists not implemented in remote source yet
  // they would need GenreSummary and PlaylistSummary types defined

  // source metadata
  async getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
  }> {
    return this.fetch<{
      type: "local" | "remote";
      name: string;
      song_count: number;
    }>("/api/info");
  }
}
