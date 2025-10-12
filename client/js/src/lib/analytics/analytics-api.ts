import { z } from "zod";

// Analytics API schemas - timestamps come as ISO strings from server

// Analytics API schemas following existing patterns
export const PlayAnalyticsSchema = z.object({
  media_blob_id: z.string(),
  total_plays: z.number(),
  complete_plays: z.number(),
  partial_plays: z.number(),
  unique_users: z.number(),
  unique_sessions: z.number(),
  avg_completion_rate: z.number(),
  total_play_time_seconds: z.number(),
  first_played_at: z.string().nullable(),
  last_played_at: z.string().nullable(),
  play_count_last_7d: z.number(),
  play_count_last_30d: z.number(),
});

export type PlayAnalytics = z.infer<typeof PlayAnalyticsSchema>;

export const SongAnalyticsResponseSchema = z.object({
  song_analytics: PlayAnalyticsSchema,
});

export type SongAnalyticsResponse = z.infer<typeof SongAnalyticsResponseSchema>;

export const TrendingSongSchema = z.object({
  media_blob_id: z.string(),
  domain_ids: z.array(z.string()).nullable(),
  current_period_plays: z.number(),
  previous_period_plays: z.number(),
  trend_score: z.number(),
  velocity_score: z.number(),
  unique_users: z.number(),
  completion_rate: z.number(),
  // Song details
  song_id: z.string().uuid().nullable(),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  album_artist: z.string().nullable(),
  track_number: z.number().nullable(),
  disc_number: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  genre: z.string().nullable(),
  sub_genres: z.array(z.string()).optional(),
  year: z.number().nullable(),
  bpm: z.number().nullable(),
  key_signature: z.string().nullable(),
  thumbnail_blob_id: z.string().nullable(),
  waveform_blob_id: z.string().nullable(),
  song_created_at: z.string().nullable(),
});

export type TrendingSong = z.infer<typeof TrendingSongSchema>;

export const UserListeningStreaksSchema = z.object({
  user_id: z.string(),
  current_streak_days: z.number(),
  longest_streak_days: z.number(),
  total_listening_days: z.number(),
  avg_daily_plays: z.number(),
  favorite_listening_hour: z.number(),
  most_played_day_of_week: z.number(),
  total_unique_songs: z.number(),
  completion_rate: z.number(),
});

export type UserListeningStreaks = z.infer<typeof UserListeningStreaksSchema>;

export const GenreListeningPatternSchema = z.object({
  genre: z.string(),
  total_plays: z.number(),
  unique_users: z.number(),
  unique_songs: z.number(),
  avg_completion_rate: z.number(),
  trend_direction: z.string(),
  popularity_rank: z.number(),
});

export type GenreListeningPattern = z.infer<typeof GenreListeningPatternSchema>;

export const ListeningTimePeriodSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  total_listening_seconds: z.number(),
  unique_songs_played: z.number(),
  total_play_events: z.number(),
  avg_session_length_minutes: z.number(),
});

export type ListeningTimePeriod = z.infer<typeof ListeningTimePeriodSchema>;

export const PopularSongSchema = z.object({
  media_blob_id: z.string(),
  domain_ids: z.array(z.string()).nullable(),
  play_count: z.number(),
  unique_users: z.number(),
  completion_rate: z.number(),
  momentum_score: z.number(),
  first_play_at: z.string(),
  latest_play_at: z.string(),
  // Song details
  song_id: z.string().uuid().nullable(),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  album_artist: z.string().nullable(),
  track_number: z.number().nullable(),
  disc_number: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  genre: z.string().nullable(),
  sub_genres: z.array(z.string()).optional(),
  year: z.number().nullable(),
  bpm: z.number().nullable(),
  key_signature: z.string().nullable(),
  thumbnail_blob_id: z.string().nullable(),
  waveform_blob_id: z.string().nullable(),
  song_created_at: z.string().nullable(),
});

export type PopularSong = z.infer<typeof PopularSongSchema>;

// Admin analytics query request schema
export const AdminAnalyticsQuerySchema = z.object({
  query_type: z.enum([
    "overview",
    "top_songs",
    "user_history",
    "trends",
    "song_analytics",
    "trending_songs",
    "user_streaks",
    "genre_patterns",
    "listening_time",
    "popular_songs",
    "top_collections",
    "collection_overview",
  ]),
  params: z.record(z.any()),
});

export type AdminAnalyticsQuery = z.infer<typeof AdminAnalyticsQuerySchema>;

// Response schemas for different query types
export const OverviewResponseSchema = z.object({
  total_events: z.number(),
  total_plays: z.number(),
  unique_users: z.number(),
  active_sessions: z.number(),
});

export const TopSongsResponseSchema = z.object({
  songs: z.array(PopularSongSchema),
  period_hours: z.number(),
  limit: z.number(),
});

export const TrendingResponseSchema = z.object({
  trending_songs: z.array(TrendingSongSchema),
  time_period_hours: z.number(),
  limit: z.number(),
});

// Collection history item schema for album/playlist/artist/genre plays
export const CollectionHistoryItemSchema = z.object({
  domain_type: z.enum(["album", "playlist", "artist", "genre"]),
  domain_ids: z.array(z.string()),
  event_type: z.string(),
  event_data: z.record(z.any()).nullable(),
  created_at: z.string(),
  session_id: z.string().nullable(),
  // Collection details (can come from event_data or direct fields)
  collection_name: z.string().nullable().optional(),
  total_songs: z.number().nullable().optional(),
  shuffle_enabled: z.boolean().nullable().optional(),
});

export const UserHistoryResponseSchema = z.object({
  user_id: z.string(),
  history: z.array(
    z.object({
      media_blob_id: z.string().nullable(),
      event_type: z.string(),
      event_data: z.record(z.any()).nullable(),
      domain_type: z.string().nullable(),
      domain_ids: z.array(z.string()).nullable(),
      session_id: z.string().nullable(),
      created_at: z.string(),
      // Song details
      song_id: z.string().uuid().nullable(),
      title: z.string().nullable(),
      artist: z.string().nullable(),
      album: z.string().nullable(),
      album_artist: z.string().nullable(),
      track_number: z.number().nullable(),
      disc_number: z.number().nullable(),
      duration_seconds: z.number().nullable(),
      genre: z.string().nullable(),
      sub_genres: z.array(z.string()).optional(),
      year: z.number().nullable(),
      bpm: z.number().nullable(),
      key_signature: z.string().nullable(),
      thumbnail_blob_id: z.string().nullable(),
      waveform_blob_id: z.string().nullable(),
      song_created_at: z.string().nullable(),
    })
  ),
});

export const UserStreaksResponseSchema = z.object({
  user_id: z.string(),
  streaks: UserListeningStreaksSchema.nullable(),
});

export const GenrePatternsResponseSchema = z.object({
  genre_patterns: z.array(GenreListeningPatternSchema),
  days_back: z.number(),
  min_plays: z.number(),
});

export const ListeningTimeResponseSchema = z.object({
  user_id: z.string(),
  period_type: z.string(),
  listening_periods: z.array(ListeningTimePeriodSchema),
});

export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
export type TopSongsResponse = z.infer<typeof TopSongsResponseSchema>;
export type TrendingResponse = z.infer<typeof TrendingResponseSchema>;
export type UserHistoryResponse = z.infer<typeof UserHistoryResponseSchema>;
export type UserStreaksResponse = z.infer<typeof UserStreaksResponseSchema>;
export type GenrePatternsResponse = z.infer<typeof GenrePatternsResponseSchema>;

// Feed schemas
export const ActivityTileSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  image_url: z.string().nullable(),
  domain_type: z.enum(["album", "playlist", "song", "artist", "genre"]),
});

export const UserActivitySummarySchema = z.object({
  recent_albums: z.array(ActivityTileSchema).nullable(),
  recent_playlists: z.array(ActivityTileSchema).nullable(),
  recent_songs: z.array(ActivityTileSchema).nullable(),
  period_description: z.string().nullable(),
  total_events: z.number().nullable(),
  last_activity: z.string().nullable(),
  grouping_level: z.string().nullable(),
  user_play_count: z.number().nullable(),
  session_duration: z.number().nullable(),
  total_play_count: z.number().nullable(),
  unique_collections: z.number().nullable(),
});

export const FeedItemMetadataSchema = z.object({
  total_songs: z.number().nullable(),
  artist_name: z.string().nullable(),
  album_name: z.string().nullable(),
  playlist_name: z.string().nullable(),
  genre_name: z.string().nullable(),
  user_activity: UserActivitySummarySchema.nullable(),
  social_context: z
    .object({
      action_type: z.string(),
      frequency: z.number(),
      is_trending: z.boolean(),
      rating: z.number().nullable().optional(),
      age_category: z.string().nullable(),
      grouping_level: z.string().nullable(),
    })
    .nullable()
    .optional(),
  collection_grid: z
    .object({
      total_songs: z.number().nullish(),
      grouping_level: z.string().nullish(),
      songs: z
        .array(
          z.object({
            id: z.string(),
            title: z.string().nullish(),
            artist: z.string().nullish(),
            album: z.string().nullish(),
            year: z.number().nullish(),
            genre: z.string().nullish(),
            sub_genres: z.array(z.string()).nullish(),
            tags: z.array(z.string()).nullish(),
            disc_number: z.number().nullish(),
            track_number: z.number().nullish(),
            duration: z.string().nullish(),
            thumbnail_blob_id: z.string().nullish(),
            domain_type: z.string().nullish(),
            user_rating: z.number().nullish(),
            is_favorite: z.boolean().nullish(),
          })
        )
        .nullish(),
    })
    .nullable()
    .optional(),
});

export const FeedItemSchema = z.object({
  item_type: z.enum([
    "recent_album",
    "recent_playlist",
    "user_activity_group",
    "trending_collection",
    "user_played_album",
    "user_played_playlist",
    "user_played_artist",
    "user_played_genre",
    "user_played_song",
    "user_favorited_album",
    "user_favorited_playlist",
    "user_favorited_song",
    "user_unfavorited_song",
    "user_rated_song",
    "user_listening_session",
    "user_daily_activity",
    "user_weekly_activity",
    "user_monthly_activity",
    "user_music_archive",
  ]),
  domain_type: z
    .enum(["album", "playlist", "artist", "genre", "song", "collection"])
    .nullable(),
  domain_ids: z.array(z.string()).nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  image_url: z.string().nullable(),
  metadata: FeedItemMetadataSchema,
  play_count: z.number().nullable(),
  last_played_at: z.string().nullable(),
  created_at: z.string(),
  user_id: z.string().nullable(),
  username: z.string().nullable(),
});

export const FeedResponseSchema = z.object({
  items: z.array(FeedItemSchema),
  has_more: z.boolean(),
  total_count: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type ActivityTile = z.infer<typeof ActivityTileSchema>;
export type UserActivitySummary = z.infer<typeof UserActivitySummarySchema>;
export type FeedItemMetadata = z.infer<typeof FeedItemMetadataSchema>;
export type FeedItem = z.infer<typeof FeedItemSchema>;
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

// Collection analytics schemas
export const CollectionItemSchema = z.object({
  domain_type: z.string(),
  domain_ids: z.array(z.string()),
  play_count: z.number(),
  unique_users: z.number(),
  collection_name: z.string().nullable(),
  last_played_at: z.string().nullable(),
});

export const TopCollectionsResponseSchema = z.object({
  collections: z.array(CollectionItemSchema),
  days_back: z.number(),
  limit: z.number(),
  domain_type: z.string().nullable().optional(),
});

export const CollectionOverviewResponseSchema = z.object({
  overview: z.object({
    total_collection_plays: z.number(),
    total_song_plays: z.number(),
    breakdown: z.object({
      album_plays: z.number(),
      artist_plays: z.number(),
      genre_plays: z.number(),
      playlist_plays: z.number(),
    }),
    unique_collections: z.object({
      albums: z.number(),
      artists: z.number(),
      genres: z.number(),
      playlists: z.number(),
    }),
  }),
  days_back: z.number(),
});

export type TopCollectionsResponse = z.infer<
  typeof TopCollectionsResponseSchema
>;
export type CollectionOverviewResponse = z.infer<
  typeof CollectionOverviewResponseSchema
>;
export type ListeningTimeResponse = z.infer<typeof ListeningTimeResponseSchema>;

// Analytics dashboard state
export interface AnalyticsDashboardState {
  overview: OverviewResponse | null;
  topSongs: TopSongsResponse | null;
  trending: TrendingResponse | null;
  genrePatterns: GenrePatternsResponse | null;
  loading: {
    overview: boolean;
    topSongs: boolean;
    trending: boolean;
    genrePatterns: boolean;
  };
  error: {
    overview: string | null;
    topSongs: string | null;
    trending: string | null;
    genrePatterns: string | null;
  };
  lastUpdated: Date | null;
}

// Analytics API client function that takes an ApiClient instance
export const createAnalyticsApi = (
  apiClient: () => import("../api-client.js").ApiClient
) => {
  const makeRequest = async <T>(
    query: AdminAnalyticsQuery,
    schema: z.ZodSchema<T>
  ): Promise<T> => {
    const client = apiClient();
    // Use the existing ApiClient's makeRequest method
    const response = await client.makeRequest(
      "POST",
      "/api/admin/analytics/query",
      {
        data: query,
      }
    );
    return schema.parse(response);
  };

  return {
    async getOverview(): Promise<OverviewResponse> {
      return makeRequest(
        {
          query_type: "overview",
          params: {},
        },
        OverviewResponseSchema
      );
    },

    async getTopSongs(
      periodHours: number = 168,
      limit: number = 20
    ): Promise<TopSongsResponse> {
      return makeRequest(
        {
          query_type: "top_songs",
          params: {
            period_hours: periodHours,
            limit,
            min_plays: 1,
          },
        },
        TopSongsResponseSchema
      );
    },

    async getTrendingSongs(
      timePeriodHours: number = 24,
      limit: number = 50
    ): Promise<TrendingResponse> {
      return makeRequest(
        {
          query_type: "trending_songs",
          params: {
            time_period_hours: timePeriodHours,
            limit,
            domain_filter: "song",
          },
        },
        TrendingResponseSchema
      );
    },

    async getUserStreaks(userId: string): Promise<UserStreaksResponse> {
      return makeRequest(
        {
          query_type: "user_streaks",
          params: {
            user_id: userId,
          },
        },
        UserStreaksResponseSchema
      );
    },

    async getGenrePatterns(
      daysBack: number = 30,
      minPlays: number = 5
    ): Promise<GenrePatternsResponse> {
      return makeRequest(
        {
          query_type: "genre_patterns",
          params: {
            days_back: daysBack,
            min_plays: minPlays,
          },
        },
        GenrePatternsResponseSchema
      );
    },

    async getUserListeningTime(
      userId: string,
      periodType: string = "day"
    ): Promise<ListeningTimeResponse> {
      return makeRequest(
        {
          query_type: "listening_time",
          params: {
            user_id: userId,
            period_type: periodType,
          },
        },
        ListeningTimeResponseSchema
      );
    },

    async getSongAnalytics(
      mediaBlobId: string
    ): Promise<SongAnalyticsResponse> {
      return makeRequest(
        {
          query_type: "song_analytics",
          params: {
            media_blob_id: mediaBlobId,
          },
        },
        SongAnalyticsResponseSchema
      );
    },

    async getUserHistory(
      userId: string,
      limit: number = 50,
      offset: number = 0
    ): Promise<UserHistoryResponse> {
      return makeRequest(
        {
          query_type: "user_history",
          params: {
            user_id: userId,
            limit,
            offset,
          },
        },
        UserHistoryResponseSchema
      );
    },

    async getTopCollections(
      daysBack: number = 7,
      limit: number = 20,
      domainType?: string
    ): Promise<TopCollectionsResponse> {
      return makeRequest(
        {
          query_type: "top_collections",
          params: {
            days: daysBack,
            limit,
            domain_type: domainType,
          },
        },
        TopCollectionsResponseSchema
      );
    },

    async getCollectionOverview(
      daysBack: number = 30
    ): Promise<CollectionOverviewResponse> {
      return makeRequest(
        {
          query_type: "collection_overview",
          params: {
            days: daysBack,
          },
        },
        CollectionOverviewResponseSchema
      );
    },

    async getSocialFeed(
      limit: number = 20,
      offset: number = 0,
      daysBack: number = 7
    ): Promise<FeedResponse> {
      const client = apiClient();
      const url = `${client.getBaseUrl()}/api/feed`;
      const response = await client.makeRequest("GET", url, {
        params: {
          limit,
          offset,
          days: daysBack,
        },
      });

      return FeedResponseSchema.parse(response);
    },
  };
};

// Utility functions for formatting analytics data
export const formatDuration = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
};

export const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
};

export const formatPercentage = (value: number): string => {
  return `${Math.round(value * 100) / 100}%`;
};

export const getDayOfWeekName = (dayOfWeek: number): string => {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[dayOfWeek] || "Unknown";
};

export const formatHour = (hour: number): string => {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
};

export const getTrendIcon = (trendDirection: string): string => {
  switch (trendDirection) {
    case "rising":
      return "↗";
    case "declining":
      return "↘";
    case "stable":
      return "→";
    default:
      return "→";
  }
};

export const getTrendColor = (trendDirection: string): string => {
  switch (trendDirection) {
    case "rising":
      return "text-green-400";
    case "declining":
      return "text-red-400";
    case "stable":
      return "text-gray-400";
    default:
      return "text-gray-400";
  }
};
