import { z } from "zod";
import type { ApiClient } from "../api-client";

// zod schemas for musicbrainz data validation
export const MusicBrainzConfigSchema = z.object({
  enabled: z.boolean(),
  user_agent: z.string(),
  rate_limit_ms: z.number(),
  base_url: z.string(),
  cover_art_url: z.string(),
  timeout_seconds: z.number(),
  max_concurrent_requests: z.number(),
  cache_ttl_hours: z.number(),
  max_retries: z.number(),
  duration_tolerance_seconds: z.number(),
  enable_duration_matching: z.boolean(),
  full_album_tag: z.string(),
  preferred_country: z.string(),
  preferred_status: z.string(),
  album_completion_threshold: z.number(),
  prefer_complete_albums: z.boolean(),
  max_album_suggestions: z.number(),
});

export const MusicBrainzMatchSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  year: z.number().optional(),
  confidence: z.number(),
  mbid: z.string(),
  recording_id: z.string().optional(),
  release_id: z.string().optional(),
});

export const SongWithMatchesSchema = z.object({
  song_id: z.string(),
  song_title: z.string(),
  song_artist: z.string().optional(),
  song_album: z.string().optional(),
  matches: z.array(MusicBrainzMatchSchema),
});

export const SongMatchesResponseSchema = z.object({
  songs: z.array(SongWithMatchesSchema),
});

export const MusicBrainzSearchRequestSchema = z.object({
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
  limit: z.number().optional().default(25),
});

export const MusicBrainzSearchResponseSchema = z.object({
  results: z.array(MusicBrainzMatchSchema),
  total: z.number(),
});

// type exports
export type MusicBrainzConfig = z.infer<typeof MusicBrainzConfigSchema>;
export type MusicBrainzMatch = z.infer<typeof MusicBrainzMatchSchema>;
export type SongWithMatches = z.infer<typeof SongWithMatchesSchema>;
export type SongMatchesResponse = z.infer<typeof SongMatchesResponseSchema>;
export type MusicBrainzSearchRequest = z.infer<
  typeof MusicBrainzSearchRequestSchema
>;
export type MusicBrainzSearchResponse = z.infer<
  typeof MusicBrainzSearchResponseSchema
>;

// api methods for musicbrainz integration
export const musicBrainzApiMethods = {
  /**
   * get musicbrainz configuration
   */
  async getMusicBrainzConfig(this: ApiClient): Promise<MusicBrainzConfig> {
    const response = await this.makeRequest<unknown>(
      "GET",
      "/api/admin/musicbrainz/config"
    );

    return MusicBrainzConfigSchema.parse(response);
  },

  /**
   * search musicbrainz for matches
   */
  async searchMusicBrainz(
    this: ApiClient,
    request: MusicBrainzSearchRequest
  ): Promise<MusicBrainzSearchResponse> {
    const validatedRequest = MusicBrainzSearchRequestSchema.parse(request);

    const response = await this.makeRequest<unknown>(
      "POST",
      "/api/musicbrainz/search",
      { data: validatedRequest }
    );

    return MusicBrainzSearchResponseSchema.parse(response);
  },

  /**
   * get existing musicbrainz matches for songs
   */
  async getSongMatches(
    this: ApiClient,
    songIds: string[]
  ): Promise<SongMatchesResponse> {
    if (songIds.length === 0) {
      return { songs: [] };
    }

    const response = await this.makeRequest<unknown>(
      "POST",
      "/api/musicbrainz/matches",
      { data: { song_ids: songIds } }
    );

    return SongMatchesResponseSchema.parse(response);
  },

  /**
   * apply musicbrainz metadata to songs
   */
  async applyMusicBrainzMetadata(
    this: ApiClient,
    songIds: string[],
    match: MusicBrainzMatch
  ): Promise<{ updated_songs: any[] }> {
    if (songIds.length === 0) {
      throw new Error("no songs provided");
    }

    const response = await this.makeRequest<{ updated_songs: any[] }>(
      "POST",
      "/api/musicbrainz/apply",
      {
        data: {
          song_ids: songIds,
          match: MusicBrainzMatchSchema.parse(match),
        },
      }
    );

    return response;
  },

  /**
   * scan songs for musicbrainz matches
   */
  async scanSongsForMatches(
    this: ApiClient,
    songIds: string[],
    options?: {
      force_rescan?: boolean;
      confidence_threshold?: number;
    }
  ): Promise<SongMatchesResponse> {
    if (songIds.length === 0) {
      return { songs: [] };
    }

    const response = await this.makeRequest<unknown>(
      "POST",
      "/api/musicbrainz/scan",
      {
        data: {
          song_ids: songIds,
          force_rescan: options?.force_rescan || false,
          confidence_threshold: options?.confidence_threshold || 85,
        },
      }
    );

    return SongMatchesResponseSchema.parse(response);
  },
};
