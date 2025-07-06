//! Music filter API client with proper error handling and validation

import { ApiClient } from "../../api-client";
import {
  FilterParams,
  FilterParamsSchema,
  GenreFiltersResponseSchema,
  ArtistFiltersResponseSchema,
  YearFiltersResponseSchema,
  AllFiltersResponseSchema,
  ValidatedGenreFiltersResponse,
  ValidatedArtistFiltersResponse,
  ValidatedYearFiltersResponse,
  ValidatedAllFiltersResponse,
} from "./filter-types";

export class MusicFilterApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: any
  ) {
    super(message);
    this.name = "MusicFilterApiError";
  }
}

export class MusicFilterClient {
  private apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  /**
   * Get genre filter options with counts
   */
  async getGenreFilters(
    params: FilterParams = {}
  ): Promise<ValidatedGenreFiltersResponse> {
    try {
      // Validate input parameters
      const validatedParams = FilterParamsSchema.parse(params);

      // Build query string
      const queryParams = new URLSearchParams();
      if (validatedParams.limit !== undefined) {
        queryParams.set("limit", validatedParams.limit.toString());
      }
      if (validatedParams.min_count !== undefined) {
        queryParams.set("min_count", validatedParams.min_count.toString());
      }

      const url = `/api/music/filters/genres?${queryParams.toString()}`;
      const response = await this.apiClient.makeRequest<unknown>("GET", url);

      // Validate response
      const validatedResponse = GenreFiltersResponseSchema.parse(response);
      return validatedResponse;
    } catch (error) {
      if (error instanceof MusicFilterApiError) {
        throw error;
      }
      throw new MusicFilterApiError(
        `Error fetching genre filters: ${(error as Error).message}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get artist filter options with counts
   */
  async getArtistFilters(
    params: FilterParams = {}
  ): Promise<ValidatedArtistFiltersResponse> {
    try {
      // Validate input parameters
      const validatedParams = FilterParamsSchema.parse(params);

      // Build query string
      const queryParams = new URLSearchParams();
      if (validatedParams.limit !== undefined) {
        queryParams.set("limit", validatedParams.limit.toString());
      }
      if (validatedParams.min_count !== undefined) {
        queryParams.set("min_count", validatedParams.min_count.toString());
      }

      const url = `/api/music/filters/artists?${queryParams.toString()}`;
      const response = await this.apiClient.makeRequest<unknown>("GET", url);

      // Validate response
      const validatedResponse = ArtistFiltersResponseSchema.parse(response);
      return validatedResponse;
    } catch (error) {
      if (error instanceof MusicFilterApiError) {
        throw error;
      }
      throw new MusicFilterApiError(
        `Error fetching artist filters: ${(error as Error).message}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get year filter options with counts
   */
  async getYearFilters(
    params: FilterParams = {}
  ): Promise<ValidatedYearFiltersResponse> {
    try {
      // Validate input parameters
      const validatedParams = FilterParamsSchema.parse(params);

      // Build query string
      const queryParams = new URLSearchParams();
      if (validatedParams.limit !== undefined) {
        queryParams.set("limit", validatedParams.limit.toString());
      }
      if (validatedParams.min_count !== undefined) {
        queryParams.set("min_count", validatedParams.min_count.toString());
      }

      const url = `/api/music/filters/years?${queryParams.toString()}`;
      const response = await this.apiClient.makeRequest<unknown>("GET", url);

      // Validate response
      const validatedResponse = YearFiltersResponseSchema.parse(response);
      return validatedResponse;
    } catch (error) {
      if (error instanceof MusicFilterApiError) {
        throw error;
      }
      throw new MusicFilterApiError(
        `Error fetching year filters: ${(error as Error).message}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get all filter metadata in a single request
   */
  async getAllFilters(
    params: FilterParams = {}
  ): Promise<ValidatedAllFiltersResponse> {
    try {
      // Validate input parameters
      const validatedParams = FilterParamsSchema.parse(params);

      // Build query string
      const queryParams = new URLSearchParams();
      if (validatedParams.limit !== undefined) {
        queryParams.set("limit", validatedParams.limit.toString());
      }
      if (validatedParams.min_count !== undefined) {
        queryParams.set("min_count", validatedParams.min_count.toString());
      }

      const url = `/api/music/filters/metadata?${queryParams.toString()}`;
      const response = await this.apiClient.makeRequest<unknown>("GET", url);

      // Validate response
      const validatedResponse = AllFiltersResponseSchema.parse(response);
      return validatedResponse;
    } catch (error) {
      if (error instanceof MusicFilterApiError) {
        throw error;
      }
      throw new MusicFilterApiError(
        `Error fetching all filters: ${(error as Error).message}`,
        undefined,
        error
      );
    }
  }

  /**
   * Refresh all filter data and return comprehensive metadata
   * This is a convenience method that calls getAllFilters with sensible defaults
   */
  async refreshFilterData(): Promise<ValidatedAllFiltersResponse> {
    return this.getAllFilters({
      limit: 50,
      min_count: 1,
    });
  }

  /**
   * Get popular filters (high count items only)
   */
  async getPopularFilters(
    minCount: number = 5
  ): Promise<ValidatedAllFiltersResponse> {
    return this.getAllFilters({
      limit: 25,
      min_count: minCount,
    });
  }
}

/**
 * Create a new MusicFilterClient instance
 */
export function createMusicFilterClient(
  apiClient: ApiClient
): MusicFilterClient {
  return new MusicFilterClient(apiClient);
}

/**
 * Factory function for creating filter client with default API client
 */
export function createDefaultMusicFilterClient(): MusicFilterClient {
  const apiClient = new ApiClient({
    baseUrl: "",
    timeout: 10000,
  });
  return new MusicFilterClient(apiClient);
}
