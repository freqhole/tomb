import type { ApiClient } from "../api-client.js";
import { musicValidation } from "./validation.js";
import { musicApiUtils } from "./error-handling.js";
import {
  BulkUpdateSongsRequestSchema,
  BulkUpdateSongsResponseSchema,
} from "./schemas/index.js";
import type {
  BulkUpdateSongsRequest,
  BulkUpdateSongsResponse,
} from "./schemas/index.js";

/**
 * Admin-only music API methods
 * These methods require admin privileges and should only be used by administrators
 */
export const musicAdminApiMethods = {
  // Bulk song metadata update methods (admin-only)
  async bulkUpdateSongs(
    this: ApiClient,
    request: BulkUpdateSongsRequest
  ): Promise<BulkUpdateSongsResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        // Validate request
        const validatedRequest = musicValidation.validateResponse(
          BulkUpdateSongsRequestSchema,
          request,
          "bulk update songs request"
        );

        const response = await this.makeRequest<unknown>(
          "PUT",
          "/api/media/songs/bulk",
          {
            data: validatedRequest,
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          BulkUpdateSongsResponseSchema,
          response,
          "bulk update songs response"
        );
      },
      "/api/media/songs/bulk",
      "bulkUpdateSongs",
      { songCount: request.song_ids.length },
      request
    );
  },

  // Convenience methods for single songs
  async updateSongTags(
    this: ApiClient,
    songId: string,
    tags: string[]
  ): Promise<BulkUpdateSongsResponse> {
    return this.bulkUpdateSongs({
      song_ids: [songId],
      updates: { tags: { type: "Replace", tags } },
    });
  },

  async addTagsToSongs(
    this: ApiClient,
    songIds: string[],
    tags: string[]
  ): Promise<BulkUpdateSongsResponse> {
    return this.bulkUpdateSongs({
      song_ids: songIds,
      updates: { tags: { type: "Add", tags } },
    });
  },

  async removeTagsFromSongs(
    this: ApiClient,
    songIds: string[],
    tags: string[]
  ): Promise<BulkUpdateSongsResponse> {
    return this.bulkUpdateSongs({
      song_ids: songIds,
      updates: { tags: { type: "Remove", tags } },
    });
  },

  async replaceTagsForSongs(
    this: ApiClient,
    songIds: string[],
    tags: string[]
  ): Promise<BulkUpdateSongsResponse> {
    return this.bulkUpdateSongs({
      song_ids: songIds,
      updates: { tags: { type: "Replace", tags } },
    });
  },
};
