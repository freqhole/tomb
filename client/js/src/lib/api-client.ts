import { z } from "zod";
import { API_SPEC } from "./api-spec.js";
import type {
  RegisterStartResponse,
  RegisterFinishRequest,
  RegisterFinishResponse,
  LoginStartResponse,
  LoginFinishRequest,
  LoginFinishResponse,
  LogoutResponse,
  AuthStatusResponse,
  HealthResponse,
} from "./api-spec.js";
import type {
  SearchResult,
  SuggestionsResult,
  UnifiedSearchResult,
  MusicSearchOptions,
  SuggestionsOptions,
  UnifiedSearchOptions,
  PostSearchRequest,
  PostSearchResponse,
} from "./search/types.js";
import type { FilterOptionsResponse } from "./search/music/filter-types.js";
import {
  SearchResultSchema,
  SuggestionsResultSchema,
  UnifiedSearchResultSchema,
  PostSearchRequestSchema,
  PostSearchResponseSchema,
} from "./search/types.js";
import { FilterOptionsResponseSchema } from "./search/music/filter-types.js";
import { searchValidation } from "./search/validation.js";
import { musicApiMethods } from "./music/api-methods.js";
import { musicAdminApiMethods } from "./music/api-admin-methods.js";
import { musicBrainzApiMethods } from "./musicbrainz/api-methods.js";
import type {
  MusicBrainzSearchRequest,
  AlbumSearchRequest,
  AlbumSearchResponse,
} from "./musicbrainz/api-methods.js";
import type {
  ArtistsFilterRequest,
  AlbumsFilterRequest,
} from "./music/schemas/index.js";
import {
  getMetadataFieldKeys,
  getUserPreferenceFieldKeys,
  type EditableSongFields,
} from "./music/schemas/form-schemas.js";

// Error handling
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public responseText: string,
    public endpoint?: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  static async fromResponse(
    response: Response,
    endpoint?: string
  ): Promise<ApiError> {
    const responseText = await response.text();
    return new ApiError(
      `HTTP ${response.status}: ${responseText}`,
      response.status,
      responseText,
      endpoint
    );
  }
}

// Configuration interface
export interface ApiClientConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  credentials?: RequestCredentials;
}

// Main API Client class
export class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;
  private credentials: RequestCredentials;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? API_SPEC.baseUrl;
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.timeout = config.timeout ?? 30000;
    this.credentials = config.credentials ?? "include";
  }

  // Header management
  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  removeHeader(key: string): void {
    delete this.defaultHeaders[key];
  }

  getHeaders(): Record<string, string> {
    return { ...this.defaultHeaders };
  }

  // Configuration updates
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  setTimeout(timeout: number): void {
    this.timeout = timeout;
  }

  setCredentials(credentials: RequestCredentials): void {
    this.credentials = credentials;
  }

  // Getter for baseUrl
  getBaseUrl(): string {
    return this.baseUrl;
  }

  // Private method to build URL with path parameters and query parameters
  private buildUrl(
    path: string,
    pathParams?: Record<string, string>,
    queryParams?: Record<string, unknown>
  ): string {
    let url = path;

    // Replace path parameters
    if (pathParams) {
      Object.entries(pathParams).forEach(([key, value]) => {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      });
    }

    // Add query parameters
    if (queryParams) {
      const searchParams = new URLSearchParams();
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            // For arrays, add each item as a separate parameter with the same key
            value.forEach((item) => {
              searchParams.append(key, String(item));
            });
          } else {
            searchParams.append(key, String(value));
          }
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const finalUrl = `${this.baseUrl}${url}`;

    return finalUrl;
  }

  // Generic request method with timeout and validation
  private async request<T>(
    method: string,
    url: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      responseSchema?: z.ZodSchema<T>;
      requestSchema?: z.ZodSchema<unknown>;
      endpoint?: string;
    } = {}
  ): Promise<T> {
    const {
      body,
      headers = {},
      responseSchema,
      requestSchema,
      endpoint,
    } = options;

    // Validate request body if schema provided
    if (requestSchema && body !== undefined) {
      requestSchema.parse(body);
    }

    const requestHeaders = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body !== undefined ? JSON.stringify(body) : null,
        credentials: this.credentials,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await ApiError.fromResponse(response, endpoint);
      }

      // Handle void responses
      if (responseSchema instanceof z.ZodVoid || !responseSchema) {
        return undefined as T;
      }

      let data: unknown;
      const contentType = response.headers.get("content-type");

      if (contentType?.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = text || undefined;
      }

      // Validate response if schema provided
      if (responseSchema) {
        return responseSchema.parse(data);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(
          `Request timeout after ${this.timeout}ms`,
          408,
          "Request Timeout",
          endpoint
        );
      }

      throw new ApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        String(error),
        endpoint
      );
    }
  }

  // WebAuthn Registration Flow
  async registerStart(
    username: string,
    queryParams?: { invite_code?: string }
  ): Promise<RegisterStartResponse> {
    const config = API_SPEC.endpoints.registerStart;
    const url = this.buildUrl(config.path, { username }, queryParams);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "registerStart",
    });
  }

  async registerFinish(
    request: RegisterFinishRequest
  ): Promise<RegisterFinishResponse> {
    const config = API_SPEC.endpoints.registerFinish;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      body: request,
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "registerFinish",
    });
  }

  // WebAuthn Login Flow
  async loginStart(username: string): Promise<LoginStartResponse> {
    const config = API_SPEC.endpoints.loginStart;
    const url = this.buildUrl(config.path, { username });

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "loginStart",
    });
  }

  async loginFinish(request: LoginFinishRequest): Promise<LoginFinishResponse> {
    const config = API_SPEC.endpoints.loginFinish;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      body: request,
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "loginFinish",
    });
  }

  // Authentication Management
  async logout(): Promise<LogoutResponse> {
    const config = API_SPEC.endpoints.logout;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "logout",
    });
  }

  async authStatus(): Promise<AuthStatusResponse> {
    const config = API_SPEC.endpoints.authStatus;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "authStatus",
    });
  }

  // Health Check
  async health(): Promise<HealthResponse> {
    const config = API_SPEC.endpoints.health;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "health",
    });
  }

  // Generic request method for sync and other endpoints
  async makeRequest<T>(
    method: string,
    url: string,
    options: {
      data?: unknown;
      params?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const requestUrl = new URL(url, this.baseUrl);

    // Add query parameters if provided
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          // Handle arrays specially
          if (Array.isArray(value)) {
            // If array has items, append each one with the same key
            if (value.length > 0) {
              value.forEach((item) => {
                if (item !== undefined && item !== null) {
                  requestUrl.searchParams.append(key, String(item));
                }
              });
            }
          } else {
            requestUrl.searchParams.append(key, String(value));
          }
        }
      });
    }

    const requestHeaders = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    if (options.data && method !== "GET") {
      requestHeaders["Content-Type"] = "application/json";
    }

    const response = await fetch(requestUrl.toString(), {
      method,
      headers: requestHeaders,
      body: options.data ? JSON.stringify(options.data) : undefined,
      credentials: this.credentials,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API request failed: ${method} ${requestUrl.toString()}`, {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText.substring(0, 500), // Trim long error messages
        headers: Object.fromEntries(response.headers.entries()),
      });
      throw new ApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorText,
        requestUrl.toString()
      );
    }

    // For DELETE operations and other methods that might return empty responses,
    // check if there's content before trying to parse JSON
    const contentLength = response.headers.get("content-length");
    const contentType = response.headers.get("content-type");

    // If content-length is 0 or there's no content-type indicating JSON, return null
    if (
      contentLength === "0" ||
      (!contentType?.includes("application/json") && method === "DELETE")
    ) {
      return null as T;
    }

    // Check if response body is empty by trying to peek at it
    const text = await response.text();
    if (!text.trim()) {
      return null as T;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      // If JSON parsing fails but we have text, it might not be JSON
      console.warn("Failed to parse response as JSON:", {
        url: requestUrl.toString(),
        method,
        text: text.substring(0, 500), // Trim long responses
        error,
      });
      return text as T;
    }
  }

  // Search Methods - Music Domain

  // @deprecated LEGACY: Use searchPost() instead for consistent filtering and pagination
  async searchUnified(
    options: Partial<UnifiedSearchOptions> = {}
  ): Promise<UnifiedSearchResult> {
    try {
      // Build URL manually to handle array serialization properly
      const url = new URL("/api/music/search", this.baseUrl);

      // Handle array parameters specially for proper serialization
      Object.entries(options).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            // For arrays, append each item as a separate parameter
            value.forEach((item) => {
              if (item !== undefined && item !== null) {
                url.searchParams.append(key, String(item));
              }
            });
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      });

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          ...this.defaultHeaders,
        },
        credentials: this.credentials,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ApiError(
          `Unified search failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText,
          url.toString()
        );
      }

      const data = await response.json();

      return searchValidation.validateResponse(
        UnifiedSearchResultSchema,
        data,
        "Unified search"
      ) as UnifiedSearchResult;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        `Unified search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        String(error),
        "/api/music/search"
      );
    }
  }

  // PREFERRED METHOD: Use this for all search/filtering operations
  async searchPost(
    request: Partial<PostSearchRequest>
  ): Promise<PostSearchResponse> {
    try {
      // Validate request with Zod
      const validatedRequest = PostSearchRequestSchema.parse(request);

      const response = await fetch(`${this.baseUrl}/api/music/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.defaultHeaders,
        },
        body: JSON.stringify(validatedRequest),
        credentials: this.credentials,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ApiError(
          `POST search failed: ${response.status} ${response.statusText}`,
          response.status,
          errorText,
          "/api/music/search"
        );
      }

      const data = await response.json();

      // Validate response with Zod
      return searchValidation.validateResponse(
        PostSearchResponseSchema,
        data,
        "POST search"
      ) as PostSearchResponse;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        `POST search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        String(error),
        "/api/music/search"
      );
    }
  }

  async getMusicSuggestions(
    query: string,
    options: Partial<SuggestionsOptions> = {}
  ): Promise<SuggestionsResult> {
    // Server expects field and partial parameters
    const params = {
      field: options.field || "all",
      partial: query,
      page_size: options.limit || 25,
    };

    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/music/suggestions",
        { params }
      );

      return searchValidation.validateResponse(
        SuggestionsResultSchema,
        response,
        "Music suggestions"
      ) as SuggestionsResult;
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(
          `Music suggestions failed: ${error.message}`,
          error.status,
          error.responseText,
          `/api/music/suggestions`
        );
      }
      throw error;
    }
  }

  async filterMusic(
    options: Omit<MusicSearchOptions, "q"> = {}
  ): Promise<SearchResult> {
    const params = { ...options };

    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/music/search",
        { params }
      );

      return searchValidation.validateResponse(
        SearchResultSchema,
        response,
        "Music filter"
      ) as SearchResult;
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(
          `Music filter failed: ${error.message}`,
          error.status,
          error.responseText,
          "/api/music/search"
        );
      }
      throw error;
    }
  }

  // Music API methods - Songs
  async getSong(songId: string) {
    return musicApiMethods.getSong.call(this, songId);
  }

  // Music API methods - Artists
  async getArtists(options?: {
    limit?: number;
    offset?: number;
    page?: number;
    page_size?: number;
  }) {
    return musicApiMethods.getArtists.call(this, options);
  }

  async filterArtists(request: ArtistsFilterRequest) {
    return musicApiMethods.filterArtists.call(this, request);
  }

  async getArtistByName(artistName: string) {
    return musicApiMethods.getArtistByName.call(this, artistName);
  }

  async getArtistSongs(
    artist: string,
    options?: {
      limit?: number;
      offset?: number;
      page?: number;
      page_size?: number;
    }
  ) {
    return musicApiMethods.getArtistSongs.call(this, artist, options);
  }

  // Music API methods - Albums
  async getAlbums(options?: {
    limit?: number;
    offset?: number;
    page?: number;
    page_size?: number;
  }) {
    return musicApiMethods.getAlbums.call(this, options);
  }

  async filterAlbums(request: AlbumsFilterRequest) {
    return musicApiMethods.filterAlbums.call(this, request);
  }

  // Convenient helper methods for common filtering scenarios
  async getArtistsByTags(
    tags: string[],
    options?: {
      query?: string;
      sort_by?: string;
      sort_direction?: string;
      page?: number;
      page_size?: number;
    }
  ) {
    return this.filterArtists({
      tags,
      query: options?.query,
      sort_by: options?.sort_by || "artist",
      sort_direction: options?.sort_direction || "asc",
      page: options?.page,
      page_size: options?.page_size,
    });
  }

  async getAlbumsByTags(
    tags: string[],
    options?: {
      query?: string;
      artist?: string;
      year_min?: number;
      year_max?: number;
      sort_by?: string;
      sort_direction?: string;
      page?: number;
      page_size?: number;
    }
  ) {
    return this.filterAlbums({
      tags,
      query: options?.query,
      artist: options?.artist,
      year_min: options?.year_min,
      year_max: options?.year_max,
      sort_by: options?.sort_by || "year",
      sort_direction: options?.sort_direction || "desc",
      page: options?.page,
      page_size: options?.page_size,
    });
  }

  async searchArtists(
    query: string,
    options?: {
      sort_by?: string;
      sort_direction?: string;
      page?: number;
      page_size?: number;
    }
  ) {
    return this.filterArtists({
      query,
      sort_by: options?.sort_by || "artist",
      sort_direction: options?.sort_direction || "asc",
      page: options?.page,
      page_size: options?.page_size,
    });
  }

  async searchAlbums(
    query: string,
    options?: {
      artist?: string;
      year_min?: number;
      year_max?: number;
      sort_by?: string;
      sort_direction?: string;
      page?: number;
      page_size?: number;
    }
  ) {
    return this.filterAlbums({
      query,
      artist: options?.artist,
      year_min: options?.year_min,
      year_max: options?.year_max,
      sort_by: options?.sort_by || "year",
      sort_direction: options?.sort_direction || "desc",
      page: options?.page,
      page_size: options?.page_size,
    });
  }

  async getAlbumTracks(album: string, artist?: string) {
    return musicApiMethods.getAlbumTracks.call(this, album, artist);
  }

  async getAlbumByName(albumName: string, artistName?: string) {
    return musicApiMethods.getAlbumByName.call(this, albumName, artistName);
  }

  // Music API methods - Playlists
  async getPlaylists(options?: {
    limit?: number;
    offset?: number;
    page?: number;
    page_size?: number;
  }) {
    return musicApiMethods.getPlaylists.call(this, options);
  }

  async getPlaylistSongs(playlistId: string) {
    return musicApiMethods.getPlaylistSongs.call(this, playlistId);
  }

  async createPlaylist(request: any) {
    return musicApiMethods.createPlaylist.call(this, request);
  }

  async updatePlaylist(playlistId: string, request: any) {
    return musicApiMethods.updatePlaylist.call(this, playlistId, request);
  }

  async addSongsToPlaylist(playlistId: string, songIds: string[]) {
    return musicApiMethods.addSongsToPlaylist.call(this, playlistId, songIds);
  }

  async removeSongsFromPlaylist(playlistId: string, songIds: string[]) {
    return musicApiMethods.removeSongsFromPlaylist.call(
      this,
      playlistId,
      songIds
    );
  }

  async deletePlaylist(playlistId: string) {
    return musicApiMethods.deletePlaylist.call(this, playlistId);
  }

  async getPlaylistSummaries() {
    return musicApiMethods.getPlaylistSummaries.call(this);
  }

  // User preference methods
  async updateSongPreferences(songId: string, request: any) {
    return musicApiMethods.updateSongPreferences.call(this, songId, request);
  }

  async bulkUpdateUserPreferences(request: any) {
    return musicApiMethods.bulkUpdateUserPreferences.call(this, request);
  }

  // LEGACY: old method - TODO: migrate to schema-driven bulkUpdateUserPreferencesFromChanges

  // schema-driven user preferences update - automatically extracts preference fields
  async bulkUpdateUserPreferencesFromChanges(request: {
    song_ids: string[];
    updates: Partial<EditableSongFields>;
  }) {
    // automatically extract user preference fields using schema
    const userPrefFields = new Set(getUserPreferenceFieldKeys());

    const userPrefUpdates = Object.fromEntries(
      Object.entries(request.updates)
        .filter(([key]) => userPrefFields.has(key as any))
        .filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(userPrefUpdates).length === 0) {
      throw new Error("no user preference updates provided");
    }

    console.log("API: bulkUpdateUserPreferences payload:", {
      song_ids: request.song_ids,
      updates: userPrefUpdates,
    });

    return musicApiMethods.bulkUpdateUserPreferences.call(this, {
      song_ids: request.song_ids,
      updates: userPrefUpdates,
    });
  }

  async toggleSongFavorite(songId: string, isFavorite: boolean) {
    return musicApiMethods.toggleSongFavorite.call(this, songId, isFavorite);
  }

  async rateSong(songId: string, rating: number | null) {
    return musicApiMethods.rateSong.call(
      this,
      songId,
      rating === null ? 0 : rating
    );
  }

  // musicbrainz methods
  async getMusicBrainzConfig() {
    return musicBrainzApiMethods.getMusicBrainzConfig.call(this);
  }

  async searchMusicBrainz(request: MusicBrainzSearchRequest) {
    return musicBrainzApiMethods.searchMusicBrainz.call(this, request);
  }

  async searchMusicBrainzAlbums(
    request: AlbumSearchRequest
  ): Promise<AlbumSearchResponse> {
    return musicBrainzApiMethods.searchAlbums.call(this, request);
  }

  async getSongMatches(songIds: string[]) {
    return musicBrainzApiMethods.getSongMatches.call(this, songIds);
  }

  async applyMusicBrainzMetadata(songIds: string[], match: any) {
    return musicBrainzApiMethods.applyMusicBrainzMetadata.call(
      this,
      songIds,
      match
    );
  }

  async scanSongsForMatches(songIds: string[], options?: any) {
    return musicBrainzApiMethods.scanSongsForMatches.call(
      this,
      songIds,
      options
    );
  }

  async bulkToggleFavorite(songIds: string[], isFavorite: boolean) {
    return musicApiMethods.bulkToggleFavorite.call(this, songIds, isFavorite);
  }

  async bulkRateSongs(songIds: string[], rating: number | null) {
    return musicApiMethods.bulkRateSongs.call(
      this,
      songIds,
      rating === null ? 0 : rating
    );
  }

  // Playlist preference methods
  async updatePlaylistPreference(playlistId: string, isFavorite: boolean) {
    return musicApiMethods.updatePlaylistPreference.call(
      this,
      playlistId,
      isFavorite
    );
  }

  async getPlaylistsWithUserContext() {
    return musicApiMethods.getPlaylistsWithUserContext.call(this);
  }

  async bulkFavoritePlaylistSongs(playlistId: string, isFavorite: boolean) {
    return musicApiMethods.bulkFavoritePlaylistSongs.call(
      this,
      playlistId,
      isFavorite
    );
  }

  // Album preference methods
  async bulkFavoriteAlbum(album: string, isFavorite: boolean) {
    return musicApiMethods.bulkFavoriteAlbum.call(this, album, isFavorite);
  }

  async getAlbumFavoriteStatus(album: string) {
    return musicApiMethods.getAlbumFavoriteStatus.call(this, album);
  }

  // Bulk song metadata update methods (admin-only)
  async bulkUpdateSongs(request: any) {
    return musicAdminApiMethods.bulkUpdateSongs.call(this, request);
  }

  // LEGACY: old method - TODO: migrate to schema-driven bulkUpdateSongsFromChanges

  // schema-driven bulk update - automatically separates metadata from user preferences
  async bulkUpdateSongsFromChanges(request: {
    song_ids: string[];
    updates: Partial<EditableSongFields>;
  }) {
    // automatically separate metadata from user preferences using schema
    const metadataFields = new Set(getMetadataFieldKeys());

    const metadataUpdates = Object.fromEntries(
      Object.entries(request.updates).filter(([key]) =>
        metadataFields.has(key as any)
      )
    );

    // filter out undefined/null values to create clean payloads
    const cleanMetadataUpdates = Object.fromEntries(
      Object.entries(metadataUpdates).filter(
        ([_, value]) => value !== undefined
      )
    );

    if (Object.keys(cleanMetadataUpdates).length === 0) {
      throw new Error("no metadata updates provided");
    }

    console.log("API: bulkUpdateSongs payload:", {
      song_ids: request.song_ids,
      updates: cleanMetadataUpdates,
    });

    return musicAdminApiMethods.bulkUpdateSongs.call(this, {
      song_ids: request.song_ids,
      updates: cleanMetadataUpdates,
    });
  }

  async updateSongTags(songId: string, tags: string[]) {
    return musicAdminApiMethods.updateSongTags.call(this, songId, tags);
  }

  async addTagsToSongs(songIds: string[], tags: string[]) {
    return musicAdminApiMethods.addTagsToSongs.call(this, songIds, tags);
  }

  async removeTagsFromSongs(songIds: string[], tags: string[]) {
    return musicAdminApiMethods.removeTagsFromSongs.call(this, songIds, tags);
  }

  async replaceTagsForSongs(songIds: string[], tags: string[]) {
    return musicAdminApiMethods.replaceTagsForSongs.call(this, songIds, tags);
  }

  async deleteSongs(songIds: string[]) {
    return musicAdminApiMethods.deleteSongs.call(this, songIds);
  }

  // Filter options methods
  async getFilterOptions(): Promise<FilterOptionsResponse> {
    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/music/filter-options"
      );

      // Parse and validate the response with Zod
      const validatedResponse = FilterOptionsResponseSchema.parse(response);
      return validatedResponse;
    } catch (error) {
      console.error("failed to fetch filter options:", error);

      // Return a safe fallback that matches the schema
      return {
        artists: {
          items: [],
          total_count: 0,
          page: 1,
          page_size: 50,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        },
        albums: {
          items: [],
          total_count: 0,
          page: 1,
          page_size: 50,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        },
        genres: {
          items: [],
          total_count: 0,
          page: 1,
          page_size: 50,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        },
        tags: {
          items: [],
          total_count: 0,
          page: 1,
          page_size: 50,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        },
        years: [],
        year_ranges: [],
        rating_distribution: [],
        avg_rating: 0,
        file_formats: [],
        bitrate_ranges: [],
        duration_ranges: [],
        key_signatures: [],
        bpm_ranges: [],
        mood_categories: [],
        favorites_count: 0,
        has_thumbnail_count: 0,
        has_lyrics_count: 0,
        compilation_count: 0,
        statistics: {
          total_songs: 0,
          total_artists: 0,
          total_albums: 0,
          total_genres: 0,
          total_tags: 0,
          total_playtime_seconds: 0,
          avg_song_duration: 0,
          total_file_size_bytes: 0,
          last_updated: "",
        },
      };
    }
  }
}

// Default client instance
export const apiClient = new ApiClient();

// Re-export types for convenience
export type {
  RegisterStartRequest,
  RegisterStartResponse,
  RegisterFinishRequest,
  RegisterFinishResponse,
  LoginStartRequest,
  LoginStartResponse,
  LoginFinishRequest,
  LoginFinishResponse,
  LogoutRequest,
  LogoutResponse,
  HealthRequest,
  HealthResponse,
  AuthStatusRequest,
  AuthStatusResponse,
  WebAuthnCredential,
  WebAuthnAssertion,
} from "./api-spec.js";

export { API_SPEC } from "./api-spec.js";

// Re-export music types for convenience
export type {
  Song,
  Album,
  ArtistSummary,
  Playlist,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  SongListResponse,
  PlaylistListResponse,
  ArtistsListResponse,
  AlbumListResponse,
} from "./music/schemas/index.js";
