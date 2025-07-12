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
  SongsSearchResult,
  SuggestionsResult,
  MusicSearchOptions,
  SongsSearchOptions,
  SuggestionsOptions,
} from "./search/types.js";
import {
  SearchResultSchema,
  SongsSearchResultSchema,
  SuggestionsResultSchema,
} from "./search/types.js";
import { searchValidation } from "./search/validation.js";
import { musicApiMethods } from "./music/api-methods.js";

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
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return `${this.baseUrl}${url}`;
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
          requestUrl.searchParams.append(key, String(value));
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
      console.warn("Failed to parse response as JSON:", text);
      return text as T;
    }
  }

  // Search Methods - Music Domain
  async searchMusic(
    query: string,
    options: Omit<MusicSearchOptions, "q"> = {}
  ): Promise<SearchResult> {
    const params = { q: query, ...options };

    console.log("🔍 API searchMusic called with params:", params);
    console.log("🔍 Query:", query);
    console.log("🔍 Options:", options);

    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/music/search",
        { params }
      );

      return searchValidation.validateResponse(
        SearchResultSchema,
        response,
        "Music search"
      ) as SearchResult;
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(
          `Music search failed: ${error.message}`,
          error.status,
          error.responseText,
          "/api/music/search"
        );
      }
      throw error;
    }
  }

  async searchSongs(
    query: string,
    options: Omit<SongsSearchOptions, "q"> = {}
  ): Promise<SongsSearchResult> {
    const params = { q: query, ...options };

    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/music/search/songs",
        { params }
      );

      return searchValidation.validateResponse(
        SongsSearchResultSchema,
        response,
        "Songs search"
      ) as SongsSearchResult;
    } catch (error) {
      if (error instanceof ApiError) {
        throw new ApiError(
          `Songs search failed: ${error.message}`,
          error.status,
          error.responseText,
          "/api/music/search/songs"
        );
      }
      throw error;
    }
  }

  async getMusicSuggestions(
    query: string,
    options: Omit<SuggestionsOptions, "q"> = {}
  ): Promise<SuggestionsResult> {
    const params = { q: query, ...options };

    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/music/search/suggestions",
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
          "/api/music/search/suggestions"
        );
      }
      throw error;
    }
  }

  async filterMusic(
    options: Omit<MusicSearchOptions, "q"> = {}
  ): Promise<SearchResult> {
    const params = { ...options };

    console.log("🎛️ API filterMusic called with params:", params);
    console.log("🎛️ Filter options:", options);

    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/music/filter",
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
          "/api/music/filter"
        );
      }
      throw error;
    }
  }

  // Music API methods - Songs
  async getSongs(options?: {
    limit?: number;
    offset?: number;
    page?: number;
    page_size?: number;
  }) {
    return musicApiMethods.getSongs.call(this, options);
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

  async getAlbumTracks(album: string, artist?: string) {
    return musicApiMethods.getAlbumTracks.call(this, album, artist);
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
