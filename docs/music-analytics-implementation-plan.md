# Music Analytics Implementation Plan

## 🚨 CRITICAL RULES - NEVER FORGET 🚨

1. **NO EMOJIS**: Keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
2. **File Size Limit**: Maximum ~500 lines per file
3. **Dark Theme Design**: UI must use dark theme with primary colors black, white, and magenta accents. Use other colors sparingly. Avoid borders and no rounded corner border radius (border-radius: 0)
4. **Modular Architecture**: Use solidjs hooks for reactive logic, leverage createResource/produce/mutate for optimal reactivity, keep components presentational, central context providers for state, avoid prop drilling
5. **Data Validation**: Use zod for all json api data parsing and validation (existing pattern)
6. **Code Reuse**: Leverage existing lib code and hooks where possible, build new generic utilities in `client/js/src/lib/`
7. **Domain Separation**: Keep admin logic generic in views/admin/, music-specific code in lib/music/ and hooks/music/
8. **Generic Library Focus**: Build reusable patterns in `client/js/src/lib/`
9. **LEGACY CODE MARKING**: When implementing new better patterns, clearly mark old code as `@deprecated`, `// LEGACY:`, or `// TODO: migrate to X` so we know which system to use and can clean up later. This prevents confusion between "this is broken and needs debugging now" vs "this works but should be migrated as part of the plan"
10. **MAXIMUM CODE REUSE**: Reuse existing song edit forms, bulk operations, filtering APIs, and modal systems.

## overview

this plan builds on existing analytics infrastructure to implement simple song play tracking. we already have the database schema (`media_events` table) and basic request analytics - now we need to implement client-side event emission, server-side apis, and reporting systems.

### existing foundation

- `media_events` table with comprehensive schema for tracking music interactions
- basic request analytics infrastructure in grimoire and server modules
- websocket notification system with analytics channel
- music player components (identify during implementation)

### goals

- track song plays: "complete play" (listened to 90%+ of song) vs "partial play" (paused/skipped before 90%)
- simple client-side event emission with batching
- admin analytics dashboard
- historical reporting and trend analysis
- session-based tracking using existing cookie session system

## phase 0: music player integration points

### player architecture overview

the freqhole music player uses a clean event-driven architecture:

- **player component**: `client/js/src/views/freqhole/components/player/Player.tsx`
- **global store**: `client/js/src/views/freqhole/store/index.tsx` with player state
- **event system**: `client/js/src/views/freqhole/hooks/useGlobalEvents.ts` for communication
- **audio element**: raw html5 audio with custom controls

### key integration points for analytics

**audio event listeners** (already in player component):

- `loadedmetadata` - audio duration available
- `timeupdate` - playback progress updates
- `ended` - song completed naturally

**player state changes** (tracked in store):

- `player.isPlaying` - play/pause state
- `player.currentSong` - current song info
- `player.currentTime` - playback position
- `player.duration` - song duration

**global events** (can extend existing events):

- `song:play` - already exists for queue management
- `queue:next` / `queue:previous` - already exists for navigation
- can add: `analytics:play-start`, `analytics:play-complete`, `analytics:play-partial`

## phase 1: server-side media events api ✅ COMPLETE

implement rest endpoints for receiving and storing media events.

### 1.1 grimoire media events models ✅

create `grimoire/src/analytics/media_events.rs`:

- ✅ `MediaEvent` struct matching database schema
- ✅ `MediaEventType` enum with all event types from migration
- ✅ `MediaEventData` typed structs for common event payloads
- ✅ validation and serialization logic

### 1.2 grimoire media events repository ✅

extend `grimoire/src/analytics/repository.rs`:

- ✅ `record_media_event()` method
- ✅ `get_media_events_for_session()` method
- ✅ `get_song_play_analytics()` method for aggregated song plays
- ✅ `get_user_listening_history()` method

### 1.3 grimoire media events service ✅

extend `grimoire/src/analytics/service.rs`:

- ✅ business logic for event validation
- ✅ session management for grouping related events
- ✅ play completion detection logic
- ✅ rate limiting and spam protection

### 1.4 server endpoints ✅

create `server/src/analytics/media_handlers.rs`:

- ✅ `POST /api/analytics/events` - receive events (single or batch array)
- ✅ `GET /api/analytics/songs/{song_id}/plays` - get play count for song
- ✅ `GET /api/analytics/history` - get current user's listening history
- ✅ `POST /api/admin/analytics/query` - flexible admin endpoint for all analytics queries

### 1.5 route configuration ✅

extend `server/src/analytics/routes.rs`:

```rust
// protected routes (require authentication)
let protected_routes = Router::new()
    .route("/api/analytics/events", post(record_events))
    .route("/api/analytics/songs/{song_id}/plays", get(get_song_plays))
    .route("/api/analytics/history", get(get_user_history))
    .layer(axum_middleware::from_fn(require_authentication));

// admin routes (require admin role)
let admin_routes = Router::new()
    .route("/api/admin/analytics/query", post(admin_analytics_query))
    .layer(axum_middleware::from_fn(require_admin))
    .layer(axum_middleware::from_fn(require_authentication));

analytics_routes.merge(protected_routes).merge(admin_routes)
```

**testing**: ✅ curl commands tested - all endpoints working with proper authentication

## phase 2: client-side event tracking system ✅ COMPLETE

build generic event tracking infrastructure for music player integration.

### 2.1 analytics client library ✅

create `client/js/src/lib/analytics/`:

- ✅ `analytics-client.ts` - http client with zod validation, retry logic, proper base URL integration
- ✅ `event-buffer.ts` - in-memory buffer with 10-second batching, page unload handling
- ✅ `session-manager.ts` - client-side session generation with localStorage persistence
- ✅ `event-types.ts` - typescript types and event builder classes
- ✅ `index.ts` - clean exports and convenience functions

key buffering strategy:

- ✅ batch events every 10 seconds (configurable)
- ✅ single retry attempt on failure
- ✅ sendBeacon for page unload with fallback to fetch
- ✅ fire-and-forget approach - analytics failures never block music playback
- ✅ max 1000 events in buffer

### 2.2 music analytics hook ✅

create `client/js/src/hooks/music/useMusicAnalytics.ts`:

- ✅ reactive session management with 30-minute timeout
- ✅ methods to emit events: `trackPlayStart`, `trackPlayComplete`, `trackPlayPartial`, `trackProgress`, `trackSeek`
- ✅ automatic batching via event buffer integration
- ✅ session-based deduplication (one play event per song per session)
- ✅ 90% completion threshold for complete vs partial plays
- ✅ play detection logic with minimum 5-second meaningful play time

### 2.3 music player instrumentation ✅

integrated analytics with existing player component (`Player.tsx`):

- ✅ analytics hook initialized with debug logging enabled
- ✅ proper base URL configuration using `apiClient.getBaseUrl()`
- ✅ `timeupdate` listener tracks progress for auto-completion detection
- ✅ `ended` listener emits completion events before queue navigation
- ✅ song loading effects emit play start events when audio actually begins
- ✅ play/pause state changes emit partial play events when pausing
- ✅ `playNext()` and `playPrevious()` emit partial plays before switching songs
- ✅ `seekTo()` and `seekToTime()` emit seek events with from/to positions

**testing**: ✅ verified working with real music playback:

- 22 total events collected during testing session
- 13 play events, 7 complete events, 2 seek events
- proper session grouping and user association
- api endpoints returning correct aggregated data

## phase 3: song play aggregation system ✅ COMPLETE

implement logic to convert raw events into meaningful play metrics and create advanced reporting.

### current state

analytics events are being collected successfully with proper session tracking and user association. all three phases completed with enhanced sql functions, materialized views, and background job processing. system is operational and processing jobs automatically.

### 3.1 enhanced sql aggregation functions ✅ COMPLETE

migration `059_enhanced_analytics_aggregation.sql` implemented:

- ✅ enhanced `get_song_play_analytics()` with play time calculations and recent activity metrics
- ✅ added `get_trending_songs(time_period, limit)` for velocity and momentum-based popularity trends
- ✅ added `get_user_listening_streaks(user_id)` for engagement patterns and listening habits
- ✅ added `get_genre_listening_patterns()` for music taste analysis and genre trends
- ✅ added `calculate_listening_time_by_period(user_id, period)` for time-based listening stats
- ✅ added `get_popular_songs_by_period()` for momentum-scored popular songs
- ✅ all functions tested with real data and integrated into rust repository/service layers
- ✅ new api endpoints: trending_songs, user_streaks, genre_patterns, listening_time, popular_songs

### 3.2 materialized view optimizations ✅ COMPLETE

migration `060_analytics_materialized_views.sql` implemented:

- ✅ `song_play_summary` - daily/weekly/monthly pre-aggregated play counts with rankings (39 songs populated)
- ✅ `user_listening_summary` - user engagement metrics by time period with listening patterns
- ✅ `trending_analysis` - pre-calculated trending scores and momentum for fast queries
- ✅ optimized query functions: `get_top_songs_from_materialized()`, `get_trending_from_materialized()`
- ✅ refresh strategy with `refresh_all_analytics_views()` function and timing information
- ✅ performance indexes for fast lookups, rankings, and period-based queries
- ✅ integrated into repository with refresh capabilities

### 3.3 background analytics jobs ✅ COMPLETE

migration `061_analytics_jobs.sql` and job queue system implemented:

- ✅ created `AnalyticsJobQueue` following existing job queue patterns from thumbnails/music jobs
- ✅ implemented scheduled aggregation jobs with `analytics_jobs` table and proper indexing
- ✅ daily rollup jobs with materialized view refresh and statistics aggregation
- ✅ weekly trend analysis jobs with trending songs calculation and caching
- ✅ cleanup jobs for old raw events with configurable retention (90 days default)
- ✅ analytics milestones detection system for notifications
- ✅ integrated into server startup with 2 background workers and notification support
- ✅ automatic job scheduling: daily rollup (2am), weekly trends (3am monday), materialized view refresh (every 6h), monthly cleanup
- ✅ job queue management with retry logic, exponential backoff, and statistics tracking
- ✅ database functions: `schedule_recurring_analytics_jobs()`, `get_analytics_job_queue_status()`, `retry_failed_analytics_jobs()`

**testing**: ✅ PRODUCTION VERIFIED - first materialized view refresh job completed successfully in 24ms, 39 songs tracked, jobs scheduled automatically (next refresh 7am, daily rollup tomorrow 2am)

### implementation approach ✅ COMPLETE

built on existing foundation successfully:

- ✅ extended `grimoire/src/analytics/repository.rs` with materialized view refresh methods
- ✅ added job scheduling system using proven patterns from existing job queues
- ✅ enhanced admin dashboard queries in `server/src/analytics/media_handlers.rs` with new analytics endpoints
- ✅ leveraged existing `POST /api/admin/analytics/query` endpoint with 5 new query types
- ✅ integrated into server startup alongside thumbnail and music job queues

## phase 4: analytics dashboard ui (NEXT)

build admin interface for viewing analytics data using pre-built api endpoints and materialized views.

### current state

phase 3 provides a complete foundation with 5 enhanced api endpoints, materialized views, and automated background processing. all server-side analytics infrastructure is ready for dashboard ui implementation.

### 4.1 analytics api endpoints ✅ FOUNDATION

extend `server/src/analytics/media_handlers.rs` with admin query handler:

the single admin endpoint handles all analytics queries with request body:

```rust
// EXISTING - working foundation
pub async fn admin_analytics_query(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(database): Extension<DatabaseConnection>,
    Json(query): Json<AdminAnalyticsQuery>,
) -> Result<impl IntoResponse, AppError> {
    match query.query_type.as_str() {
        "overview" => handle_overview_query(&analytics_service, query.params).await,
        "top_songs" => handle_top_songs_query(&analytics_service, query.params).await,
        "user_history" => handle_admin_user_history_query(&analytics_service, query.params).await,
        "trends" => handle_trends_query(&analytics_service, query.params).await,
        "song_analytics" => handle_song_analytics_query(&analytics_service, query.params).await,
        _ => Err(AppError::BadRequest("Unknown query type".into())),
    }
}
```

✅ foundation in place - ready for phase 3 enhanced query implementations

### 4.2 analytics dashboard components (NEXT)

create `client/js/src/views/admin/analytics/` using existing patterns:

- `AnalyticsDashboard.tsx` - main dashboard layout with dark theme
- `PlayMetricsCard.tsx` - song play statistics cards
- `TrendChart.tsx` - time series visualization using chart.js
- `TopSongsTable.tsx` - most played songs table with existing table components
- `UserActivityChart.tsx` - user engagement metrics visualization
- leverage existing admin layout patterns from `client/js/src/views/admin/`
- use existing hooks and utilities from `client/js/src/lib/`
- follow dark theme design rules (black, white, magenta accents, no borders, no rounded corners)

### 4.3 real-time updates

extend existing websocket system:

- emit analytics events via websocket for real-time dashboard updates
- update play counts in real-time as events occur
- live user activity indicators using existing notification infrastructure
- leverage existing `ConnectionManager` and notification patterns

### implementation approach

build on existing ui foundation:

- extend existing admin routes in `client/js/src/routes/admin/`
- use existing admin authentication and layout components
- leverage existing api client patterns for analytics endpoints
- implement using solidjs createResource for reactive data loading
- follow existing component patterns for tables, cards, and charts

**testing**: navigate to admin analytics dashboard, verify data loads from materialized views, test real-time updates

## phase 5: user-facing analytics features

implement analytics features for regular users.

### 5.1 user listening history

create user-facing endpoints and ui:

- `GET /api/analytics/history` - personal listening history (already from phase 1.4)
- `GET /api/analytics/stats` - personal listening statistics
- user profile page with listening stats
- recently played songs list

user routes with auth middleware:

```rust
let user_analytics_routes = Router::new()
    .route("/api/analytics/stats", get(get_user_stats))
    .layer(axum_middleware::from_fn(require_authentication));
```

handlers automatically get `AuthenticatedUser` from middleware:

```rust
pub async fn get_user_stats(
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<UserStats>, WebauthnError> {
    let user_id = user.user().id;
    // get stats for authenticated user only
}
```

### 5.2 song popularity indicators

enhance existing song components:

- show play counts on song cards/lists
- trending indicators for popular songs
- "others also played" recommendations
- social proof elements

### 5.3 personal insights

create personalized analytics:

- listening time summaries (daily/weekly/monthly)
- genre preference analysis
- discovery metrics (new vs repeated songs)
- listening pattern insights

**testing**: login as regular user, verify personal analytics appear correctly

## phase 6: advanced analytics features

implement sophisticated analytics capabilities.

### 6.1 real-time analytics processing

create streaming analytics pipeline:

- process events in real-time for immediate insights
- detect listening patterns and anomalies
- generate real-time recommendations
- monitor system health via analytics

### 6.2 cohort and segmentation analysis

advanced user analytics:

- user cohort analysis (new vs returning listeners)
- listening behavior segmentation
- retention analytics
- engagement scoring

### 6.3 predictive analytics

machine learning integration:

- predict song popularity trends
- recommend songs based on listening patterns
- detect and prevent analytics spam
- optimize music recommendation algorithms

**testing**: review advanced analytics reports, verify ml predictions accuracy

## implementation notes

### database optimization

- leverage existing indexes on `media_events` table
- add additional indexes as needed based on query patterns
- implement partitioning for large event volumes
- regular cleanup of old raw events

### performance considerations

- 5-10 second batch event submission for reduced server load
- simple in-memory client-side buffering (max 1000 events)
- single retry attempt on failure
- efficient aggregation queries using sql functions

### privacy and compliance

- implement opt-out mechanisms for analytics tracking
- anonymization options for sensitive data
- gdpr compliance for user data deletion
- transparent privacy controls in user settings

### monitoring and alerting

- track analytics system health metrics
- alert on event processing failures
- monitor for spam or abuse patterns
- performance monitoring for analytics queries

## technical dependencies

### existing systems to integrate with

- current music player components (identify during phase 2)
- existing websocket notification system
- `require_authentication` and `require_admin` middleware from `crate::auth`
- `AuthenticatedUser` extension type for user context
- music domain models and apis

### new dependencies

- zod schemas for event validation
- chart.js or similar for dashboard visualizations
- potentially ml libraries for advanced analytics
- job scheduling system for background aggregation

## rollout strategy

### gradual deployment

1. deploy server apis first (phases 1-3) with proper auth middleware
2. test auth flows: regular users can only access own data, admins can access all
3. implement simple client-side tracking for all users
4. verify data quality and system stability
5. roll out dashboard and user features
6. enable advanced analytics features

### feature flags

- keep it simple - no complex feature flagging initially
- analytics collection on for all users
- dashboard features for admin users only
- future: gradual rollout of advanced features

### data migration

- no migration needed - builds on existing schema
- may need to backfill some aggregated data
- implement data retention policies
- establish backup and recovery procedures

## phase 2 completion summary

### what's working perfectly ✅

- **22 real events collected** during testing session with proper session grouping
- **3 event types**: play (13), complete (7), seek (2) - showing real user behavior
- **session management**: single session UUID properly grouping all user activity
- **user tracking**: events correctly associated with authenticated user
- **api endpoints**: all working with proper authentication and data validation
- **event batching**: 10-second intervals with page unload handling via sendBeacon
- **music player integration**: minimal intrusion, comprehensive coverage of player actions

### technical foundation established ✅

- **database**: leveraging existing `media_events` table with proper indexes
- **server**: complete REST API with flexible admin query endpoint
- **client**: type-safe analytics library with proper error handling
- **authentication**: proper middleware integration with existing auth system
- **performance**: batched submissions, single retry, fire-and-forget reliability

### ready for phase 3

the analytics collection is working perfectly. phase 3 should focus on:

1. **enhanced sql aggregation** for complex reporting queries
2. **materialized views** for performance at scale
3. **background jobs** for scheduled analytics processing
4. **trend analysis** and popularity calculations

this plan leverages the established solid foundation to build comprehensive music analytics focused on song play tracking and user listening behavior.

## phase 7: collection analytics (albums, playlists, artists, genres) - NEW

extend analytics to track when users play entire collections, not just individual songs. this adds valuable insight into how users consume music at the collection level (playing full albums, shuffling artists, etc.).

### current state

- song-level analytics working perfectly
- individual song plays tracked in user history
- existing domain types support "playlist" but missing "album", "artist", "genre"
- no collection-level play events currently tracked

### 7.1 extend domain types and schemas

update client-side schemas to support new domain types:

```typescript
// tomb/client/js/src/lib/analytics/analytics-client.ts
export const DomainTypeSchema = z.enum([
  "song",
  "album", // NEW
  "artist", // NEW
  "genre", // NEW
  "playlist", // already exists
  "photo",
  "video",
  "book",
  "document",
]);
```

### 7.2 collection event builder

create new event builder for collection plays:

```typescript
// tomb/client/js/src/lib/analytics/collection-events.ts
export interface CollectionPlayEventData {
  total_songs: number;
  shuffle_enabled: boolean;
  play_source: "play_all" | "shuffle_all" | "continue_playing";
  first_song_id?: string;
}

export class CollectionEventBuilder {
  static playCollection(
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    eventData: CollectionPlayEventData,
    sessionId?: string,
  ): MediaEventRequest {
    return {
      media_blob_id: "", // not applicable for collections
      event_type: "play",
      event_data: eventData,
      session_id: sessionId,
      domain_type: domainType,
      domain_id: domainId,
    };
  }
}
```

### 7.3 integration points

**album play tracking**:

- trigger: user clicks "play album" or "shuffle album" on album cards/detail views
- data: album id, song count, shuffle mode, first song played
- location: `DesktopAlbumsView.tsx`, `MobileAlbumsView.tsx`, album detail components

**playlist play tracking**:

- trigger: user plays entire playlist (when playlist features exist)
- data: playlist id, song count, shuffle mode
- location: future playlist components

**artist play tracking**:

- trigger: user clicks "play all" or "shuffle all" on artist detail views
- data: artist id, total song count, shuffle mode
- location: `DesktopArtistsView.tsx`, `MobileArtistsView.tsx`, artist detail panels

**genre play tracking**:

- trigger: user plays "all songs in genre" or "shuffle genre"
- data: genre slug, total songs, shuffle mode
- location: `DesktopGenresView.tsx`, genre detail components

### 7.4 server-side extensions

update rust analytics models:

```rust
// tomb/grimoire/src/analytics/media_events.rs
#[derive(Debug, Clone, sqlx::Type)]
#[sqlx(type_name = "domain_type", rename_all = "lowercase")]
pub enum DomainType {
    Song,
    Album,    // NEW
    Artist,   // NEW
    Genre,    // NEW
    Playlist,
    Photo,
    Video,
    Book,
    Document,
}
```

add collection analytics sql functions:

```sql
-- get collection play analytics
CREATE OR REPLACE FUNCTION get_collection_play_analytics(
    p_domain_type domain_type,
    p_time_period interval DEFAULT '30 days'
)
RETURNS TABLE (
    domain_id text,
    total_plays bigint,
    unique_users bigint,
    last_played_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        me.domain_id::text,
        COUNT(*)::bigint as total_plays,
        COUNT(DISTINCT me.user_id)::bigint as unique_users,
        MAX(me.created_at) as last_played_at
    FROM media_events me
    WHERE me.domain_type = p_domain_type
      AND me.event_type = 'play'
      AND me.created_at >= NOW() - p_time_period
      AND me.domain_id IS NOT NULL
    GROUP BY me.domain_id
    ORDER BY total_plays DESC;
END;
$$ LANGUAGE plpgsql;
```

### 7.5 user history integration

extend user history to show collection plays alongside song plays:

```typescript
// tomb/client/js/src/lib/analytics/analytics-api.ts
const CollectionHistoryItemSchema = z.object({
  domain_type: z.enum(["album", "playlist", "artist", "genre"]),
  domain_id: z.string(),
  event_type: z.string(),
  event_data: z.record(z.any()).nullable(),
  created_at: z.string(),
  // collection details populated by join
  collection_name: z.string().nullable(),
  total_songs: z.number().nullable(),
  shuffle_enabled: z.boolean().nullable(),
});
```

update queue history ui to show collection plays:

```typescript
// examples of history display:
// "played album: dark side of the moon (10 songs, shuffled)"
// "played artist: pink floyd (142 songs)"
// "shuffled genre: rock (1,247 songs)"
// "played playlist: chill vibes (23 songs)"
```

### 7.6 materialized views extension

extend existing materialized views for collection analytics:

```sql
-- add collection play summary view
CREATE MATERIALIZED VIEW collection_play_summary AS
SELECT
    domain_type,
    domain_id,
    DATE_TRUNC('day', created_at) as play_date,
    COUNT(*) as daily_plays,
    COUNT(DISTINCT user_id) as unique_users,
    AVG((event_data->>'total_songs')::int) as avg_songs_per_play,
    COUNT(CASE WHEN event_data->>'shuffle_enabled' = 'true' THEN 1 END) as shuffled_plays
FROM media_events
WHERE domain_type IN ('album', 'artist', 'genre', 'playlist')
  AND event_type = 'play'
  AND domain_id IS NOT NULL
GROUP BY domain_type, domain_id, DATE_TRUNC('day', created_at);

CREATE INDEX idx_collection_play_summary_lookup
ON collection_play_summary (domain_type, domain_id, play_date DESC);
```

### 7.7 implementation approach

following critical rules:

1. **no emojis**: keep all ui text lowercase and simple
2. **file size limit**: split collection events into separate file (~500 lines max)
3. **dark theme**: collection history items use same dark theme as song history
4. **modular architecture**: use solidjs createResource for collection data, hooks for reactive logic
5. **data validation**: use zod for all collection event schemas
6. **code reuse**: leverage existing event buffer, analytics client, history components
7. **domain separation**: collection analytics in lib/analytics/, music-specific in lib/music/
8. **generic library focus**: build reusable collection event patterns
9. **legacy code marking**: mark any old collection tracking as @deprecated
10. **maximum code reuse**: extend existing analytics apis, history ui, materialized views

**testing approach**:

- verify collection events tracked when playing albums/artists/genres
- check history tab shows collection plays with proper formatting
- test materialized view performance with collection data
- validate admin dashboard shows collection analytics

### dependencies

- extends existing analytics infrastructure (phases 1-3)
- requires album/artist/genre detail views to emit events
- leverages current event buffer and batch submission
- uses existing user history api and ui components

### rollout strategy

1. update domain type schemas (client + server)
2. implement collection event builder
3. add collection play tracking to existing views
4. extend user history to show collection plays
5. add collection analytics to admin dashboard
6. create materialized views for performance
7. integrate with background analytics jobs

this extends the solid analytics foundation to provide comprehensive insights into both individual song consumption and collection-level listening patterns, giving a complete picture of user music behavior.

## phase 8: feed view with server-side aggregation - NEW

create a unified social feed view that combines recent content creation (albums, playlists by created_at) with aggregated user activity across all users. this becomes the new default landing page, showing "what's happening" in the music library with visual tiles and intelligent grouping.

### current state

- collection analytics (phase 7) tracks album/artist/genre/playlist plays across all users
- user history api provides chronological event data for individual users
- existing ui components for albums, artists, playlists (grid and detail views)
- context menu systems for collection interactions (add to playlist, tag, edit, favorite)
- no unified social feed view or server-side aggregation endpoint
- current default route is album grid view

### 8.1 server-side feed aggregation endpoint

create new rust endpoint for intelligent feed aggregation:

```rust
// tomb/grimoire/src/analytics/feed.rs
use sqlx::PgPool;
use serde::{Deserialize, Serialize};
use crate::analytics::media_events::DomainType;

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedItem {
    pub item_type: FeedItemType,
    pub domain_type: Option<DomainType>,
    pub domain_id: Option<String>,
    pub title: String,
    pub subtitle: Option<String>,
    pub image_url: Option<String>, // album art, playlist cover, etc.
    pub metadata: FeedItemMetadata,
    pub play_count: Option<i64>,
    pub last_played_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedItemType {
    RecentAlbum,        // new album by created_at
    RecentPlaylist,     // new playlist by created_at
    UserActivityGroup,  // aggregated user listening activity (visual tiles)
    TrendingCollection, // popular across all users
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedItemMetadata {
    pub total_songs: Option<i32>,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub playlist_name: Option<String>,
    pub genre_name: Option<String>,
    pub user_activity: Option<UserActivitySummary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserActivitySummary {
    pub recent_albums: Vec<ActivityTile>,
    pub recent_playlists: Vec<ActivityTile>,
    pub recent_songs: Vec<ActivityTile>,
    pub period_description: String, // "last week", "last 3 days"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivityTile {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub image_url: Option<String>,
    pub domain_type: DomainType,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedResponse {
    pub items: Vec<FeedItem>,
    pub has_more: bool,
    pub total_count: i64,
    pub limit: i64,
    pub offset: i64,
}

pub async fn get_user_feed(
    pool: &PgPool,
    user_id: &str,
    limit: i64,
    offset: i64,
    days_back: i32,
) -> Result<FeedResponse, sqlx::Error> {
    // complex sql aggregation query combining:
    // - recent collection plays
    // - user activity summaries
    // - trending collections
    // - intelligent deduplication and scoring
}
```

**feed aggregation sql logic**:

```sql
-- tomb/migrations/xxx_create_feed_views.sql
CREATE OR REPLACE FUNCTION get_social_feed_items(
    p_limit bigint,
    p_offset bigint,
    p_days_back interval DEFAULT '7 days'
)
RETURNS TABLE (
    item_type text,
    domain_type domain_type,
    domain_id text,
    title text,
    subtitle text,
    image_url text,
    metadata jsonb,
    play_count bigint,
    last_played_at timestamptz,
    score float,
    created_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    WITH recent_albums AS (
        -- recent albums by created_at (content creation, not plays)
        SELECT DISTINCT
            'recent_album'::text as item_type,
            'album'::domain_type,
            s.album as domain_id,
            s.album as title,
            s.album_artist || ' • ' || COUNT(s.id)::text || ' songs' as subtitle,
            NULL::text as image_url, -- TODO: album art lookup
            jsonb_build_object(
                'total_songs', COUNT(s.id),
                'artist_name', s.album_artist,
                'album_name', s.album
            ) as metadata,
            NULL::bigint as play_count,
            MAX(s.created_at) as last_played_at,
            100.0 as score, -- high priority for new content
            MAX(s.created_at) as created_at
        FROM songs s
        WHERE s.created_at >= NOW() - p_days_back
          AND s.album IS NOT NULL
          AND s.album_artist IS NOT NULL
        GROUP BY s.album, s.album_artist
    ),
    recent_playlists AS (
        -- recent playlists by created_at
        SELECT
            'recent_playlist'::text as item_type,
            'playlist'::domain_type,
            p.id::text as domain_id,
            p.name as title,
            'playlist • ' || COALESCE(song_count.count, 0)::text || ' songs' as subtitle,
            NULL::text as image_url, -- TODO: playlist cover lookup
            jsonb_build_object(
                'total_songs', COALESCE(song_count.count, 0),
                'playlist_name', p.name
            ) as metadata,
            NULL::bigint as play_count,
            p.created_at as last_played_at,
            90.0 as score,
            p.created_at as created_at
        FROM playlists p
        LEFT JOIN (
            SELECT playlist_id, COUNT(*) as count
            FROM playlist_songs
            GROUP BY playlist_id
        ) song_count ON p.id = song_count.playlist_id
        WHERE p.created_at >= NOW() - p_days_back
    ),
    user_activity_groups AS (
        -- aggregated user activity with visual tiles
        SELECT
            'user_activity_group'::text as item_type,
            NULL::domain_type,
            NULL::text as domain_id,
            'recent listening activity' as title,
            NULL::text as subtitle,
            NULL::text as image_url,
            jsonb_build_object(
                'user_activity', jsonb_build_object(
                    'recent_albums', recent_album_tiles.tiles,
                    'recent_playlists', recent_playlist_tiles.tiles,
                    'recent_songs', recent_song_tiles.tiles,
                    'period_description', 'last week'
                )
            ) as metadata,
            NULL::bigint as play_count,
            activity_summary.latest_activity as last_played_at,
            75.0 as score,
            activity_summary.latest_activity as created_at
        FROM (
            SELECT MAX(created_at) as latest_activity
            FROM media_events
            WHERE created_at >= NOW() - p_days_back
        ) activity_summary
        CROSS JOIN (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', album_stats.album,
                    'title', album_stats.album,
                    'subtitle', album_stats.artist,
                    'image_url', NULL,
                    'domain_type', 'album'
                )
            ) as tiles
            FROM (
                SELECT DISTINCT
                    me.domain_id as album,
                    s.album_artist as artist,
                    COUNT(*) as plays
                FROM media_events me
                JOIN songs s ON s.album = me.domain_id
                WHERE me.domain_type = 'album'
                  AND me.event_type = 'play'
                  AND me.created_at >= NOW() - p_days_back
                GROUP BY me.domain_id, s.album_artist
                ORDER BY plays DESC
                LIMIT 4
            ) album_stats
        ) recent_album_tiles
        CROSS JOIN (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', playlist_stats.playlist_id,
                    'title', playlist_stats.name,
                    'subtitle', 'playlist',
                    'image_url', NULL,
                    'domain_type', 'playlist'
                )
            ) as tiles
            FROM (
                SELECT DISTINCT
                    me.domain_id as playlist_id,
                    p.name,
                    COUNT(*) as plays
                FROM media_events me
                JOIN playlists p ON p.id::text = me.domain_id
                WHERE me.domain_type = 'playlist'
                  AND me.event_type = 'play'
                  AND me.created_at >= NOW() - p_days_back
                GROUP BY me.domain_id, p.name
                ORDER BY plays DESC
                LIMIT 2
            ) playlist_stats
        ) recent_playlist_tiles
        CROSS JOIN (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', song_stats.song_id,
                    'title', song_stats.title,
                    'subtitle', song_stats.artist,
                    'image_url', NULL,
                    'domain_type', 'song'
                )
            ) as tiles
            FROM (
                SELECT DISTINCT
                    me.media_blob_id as song_id,
                    s.title,
                    s.artist,
                    COUNT(*) as plays
                FROM media_events me
                JOIN songs s ON s.media_blob_id = me.media_blob_id
                WHERE me.domain_type = 'song'
                  AND me.event_type = 'play'
                  AND me.created_at >= NOW() - p_days_back
                  AND me.media_blob_id IS NOT NULL
                GROUP BY me.media_blob_id, s.title, s.artist
                ORDER BY plays DESC
                LIMIT 2
            ) song_stats
        ) recent_song_tiles
        WHERE activity_summary.latest_activity IS NOT NULL
    )
    SELECT
        ra.item_type, ra.domain_type, ra.domain_id, ra.title, ra.subtitle,
        ra.image_url, ra.metadata, ra.play_count, ra.last_played_at, ra.score, ra.created_at
    FROM recent_albums ra
    UNION ALL
    SELECT
        rp.item_type, rp.domain_type, rp.domain_id, rp.title, rp.subtitle,
        rp.image_url, rp.metadata, rp.play_count, rp.last_played_at, rp.score, rp.created_at
    FROM recent_playlists rp
    UNION ALL
    SELECT
        uag.item_type, uag.domain_type, uag.domain_id, uag.title, uag.subtitle,
        uag.image_url, uag.metadata, uag.play_count, uag.last_played_at, uag.score, uag.created_at
    FROM user_activity_groups uag
    ORDER BY score DESC, created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;
```

### 8.2 server endpoint implementation

add feed endpoint to existing analytics routes:

```rust
// tomb/server/src/routes/analytics.rs (extend existing file)
use crate::grimoire::analytics::feed::{get_user_feed, FeedResponse};

pub async fn social_feed_handler(
    Query(params): Query<HashMap<String, String>>,
    Extension(pool): Extension<PgPool>,
    _user: AuthenticatedUser, // authentication required but feed shows all user activity
) -> Result<Json<FeedResponse>, (StatusCode, Json<ErrorResponse>)> {
    let limit = params
        .get("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(20)
        .min(100); // max 100 items per request

    let offset = params
        .get("offset")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let days_back = params
        .get("days")
        .and_then(|s| s.parse().ok())
        .unwrap_or(7)
        .min(90); // max 90 days back

    match get_social_feed(&pool, limit, offset, days_back).await {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            tracing::error!("failed to get social feed: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "failed to fetch social feed".to_string(),
                }),
            ))
        }
    }
}

// add to router configuration
app.route("/api/feed", get(social_feed_handler))
```

### 8.3 client-side feed api integration

extend analytics api client:

```typescript
// tomb/client/js/src/lib/analytics/analytics-api.ts (extend existing)
export const ActivityTileSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  image_url: z.string().nullable(),
  domain_type: z.enum(["album", "playlist", "song", "artist", "genre"]),
});

export const UserActivitySummarySchema = z.object({
  recent_albums: z.array(ActivityTileSchema),
  recent_playlists: z.array(ActivityTileSchema),
  recent_songs: z.array(ActivityTileSchema),
  period_description: z.string(),
});

export const FeedItemMetadataSchema = z.object({
  total_songs: z.number().nullable(),
  artist_name: z.string().nullable(),
  album_name: z.string().nullable(),
  playlist_name: z.string().nullable(),
  genre_name: z.string().nullable(),
  user_activity: UserActivitySummarySchema.nullable(),
});

export const FeedItemSchema = z.object({
  item_type: z.enum([
    "recent_album",
    "recent_playlist",
    "user_activity_group",
    "trending_collection",
  ]),
  domain_type: z.enum(["album", "playlist", "artist", "genre"]).nullable(),
  domain_id: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  image_url: z.string().nullable(),
  metadata: FeedItemMetadataSchema,
  play_count: z.number().nullable(),
  last_played_at: z.string().nullable(),
  created_at: z.string(),
});

export const FeedResponseSchema = z.object({
  items: z.array(FeedItemSchema),
  has_more: z.boolean(),
  total_count: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type FeedItem = z.infer<typeof FeedItemSchema>;
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

// add to createAnalyticsApi function (follows existing patterns)
async getSocialFeed(
  limit: number = 20,
  offset: number = 0,
  daysBack: number = 7
): Promise<FeedResponse> {
  const client = apiClient();
  const url = `${client.getBaseUrl()}/api/feed`;
  const response = await client.makeRequest(
    "GET",
    url,
    {
      params: {
        limit,
        offset,
        days: daysBack,
      }
    }
  );

  return FeedResponseSchema.parse(response);
},
```

### 8.4 feed view component implementation

create new solidjs feed view:

```typescript
// tomb/client/js/src/views/freqhole/components/content/views/FeedView.tsx
import { createSignal, createResource, For, Show } from "solid-js";
import { createAnalyticsApi } from "../../../../../lib/analytics/analytics-api";
import { apiClient } from "../../../../../lib/api-client";
import type { FeedItem } from "../../../../../lib/analytics/analytics-api";
import { FeedItemCard } from "./feed/FeedItemCard";
import { UserActivityGroupCard } from "./feed/UserActivityGroupCard";

export function FeedView() {
  const [offset, setOffset] = createSignal(0);
  const [daysBack, setDaysBack] = createSignal(7);
  const analyticsApi = createAnalyticsApi(() => apiClient());

  const [feedData] = createResource(
    () => ({ offset: offset(), days: daysBack() }),
    async ({ offset, days }) => {
      try {
        return await analyticsApi.getSocialFeed(20, offset, days);
      } catch (error) {
        console.error("failed to load social feed:", error);
        return null;
      }
    }
  );

  const loadMore = () => {
    const current = feedData();
    if (current?.has_more) {
      setOffset(offset() + 20);
    }
  };

  return (
    <div class="p-6 text-white">
      {/* feed header */}
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold">music feed</h1>

        {/* time period filter */}
        <div class="flex gap-2">
          <button
            onClick={() => setDaysBack(7)}
            class={`px-3 py-1 text-sm ${
              daysBack() === 7
                ? "bg-magenta-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            last week
          </button>
          <button
            onClick={() => setDaysBack(30)}
            class={`px-3 py-1 text-sm ${
              daysBack() === 30
                ? "bg-magenta-600 text-white"
                : "bg-gray-800 text-gray-300 hover:bg-gray-700"
            }`}
          >
            last month
          </button>
        </div>
      </div>

      {/* feed content */}
      <Show
        when={!feedData.loading}
        fallback={
          <div class="text-center py-12">
            <div class="text-gray-500">loading your music feed...</div>
          </div>
        }
      >
        <Show
          when={feedData()?.items?.length > 0}
          fallback={
            <div class="text-center py-12">
              <div class="text-gray-500">no recent activity found</div>
              <div class="text-sm text-gray-600 mt-2">
                start playing some music to see your feed
              </div>
            </div>
          }
        >
          {/* feed grid - responsive like existing album grids */}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <For each={feedData()?.items}>
              {(item) => (
                <Show
                  when={item.item_type === "user_activity_group"}
                  fallback={<FeedItemCard item={item} />}
                >
                  <UserActivityGroupCard item={item} />
                </Show>
              )}
            </For>
          </div>

          {/* load more */}
          <Show when={feedData()?.has_more}>
            <div class="text-center mt-8">
              <button
                onClick={loadMore}
                class="px-6 py-2 bg-gray-800 text-white hover:bg-gray-700 transition-colors"
              >
                load more
              </button>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
```

### 8.5 feed item card components

visual tile-based components following existing patterns:

```typescript
// tomb/client/js/src/views/freqhole/components/content/views/feed/FeedItemCard.tsx
import { For, Show } from "solid-js";
import type { FeedItem, ActivityTile } from "../../../../../../lib/analytics/analytics-api";
import { useCollectionInteractions } from "../../../services/collectionInteractions";
import { formatDistanceToNow } from "date-fns";
import { apiClient } from "../../../../../../lib/api-client";

interface FeedItemCardProps {
  item: FeedItem;
}

export function FeedItemCard(props: FeedItemCardProps) {
  const { playCollection, showCollectionContextMenu } = useCollectionInteractions();

  const handlePlay = () => {
    if (props.item.domain_type && props.item.domain_id) {
      const metadata = props.item.metadata;
      playCollection(
        props.item.domain_type,
        props.item.domain_id,
        {
          total_songs: metadata.total_songs || 0,
          shuffle_enabled: false,
          play_source: "feed",
        }
      );
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (props.item.domain_type && props.item.domain_id) {
      // reuse existing context menu patterns (add to playlist, tag, edit, favorite, etc.)
      showCollectionContextMenu(
        e,
        props.item.domain_type,
        props.item.domain_id,
        props.item.title
      );
    }
  };

  return (
    <div
      class="bg-black aspect-square p-4 hover:bg-magenta-600/10 transition-colors cursor-pointer group flex flex-col"
      onClick={handlePlay}
      onContextMenu={handleContextMenu}
    >
      {/* image/artwork area */}
      <div class="flex-1 flex items-center justify-center mb-3 bg-gray-900">
        {props.item.image_url ? (
          <img
            src={`${apiClient().getBaseUrl()}${props.item.image_url}`}
            alt={props.item.title}
            class="w-full h-full object-cover"
          />
        ) : (
          <div class="text-4xl text-gray-600">
            {props.item.domain_type === "album" ? "♪" :
             props.item.domain_type === "playlist" ? "♭" : "♪"}
          </div>
        )}
      </div>

      {/* title and subtitle */}
      <div class="text-center">
        <h3 class="font-medium text-white text-sm truncate group-hover:text-magenta-400 transition-colors">
          {props.item.title}
        </h3>
        {props.item.subtitle && (
          <p class="text-xs text-gray-400 truncate mt-1">{props.item.subtitle}</p>
        )}
      </div>

      {/* type indicator */}
      <div class="text-center mt-2">
        <span class="text-xs text-gray-500 uppercase">
          {props.item.item_type.replace("recent_", "")}
        </span>
      </div>
    </div>
  );
}

// User activity group component showing visual tiles
export function UserActivityGroupCard(props: { item: FeedItem }) {
  const activity = props.item.metadata.user_activity;
  if (!activity) return null;

  return (
    <div class="bg-black p-4 col-span-2 md:col-span-2 lg:col-span-3">
      <h3 class="text-white font-medium mb-4">{props.item.title}</h3>

      {/* recent albums tiles */}
      {activity.recent_albums.length > 0 && (
        <div class="mb-4">
          <h4 class="text-sm text-gray-400 mb-2">recent albums</h4>
          <div class="grid grid-cols-4 gap-2">
            <For each={activity.recent_albums}>
              {(tile) => (
                <ActivityTileComponent tile={tile} />
              )}
            </For>
          </div>
        </div>
      )}

      {/* recent playlists tiles */}
      {activity.recent_playlists.length > 0 && (
        <div class="mb-4">
          <h4 class="text-sm text-gray-400 mb-2">recent playlists</h4>
          <div class="grid grid-cols-2 gap-2">
            <For each={activity.recent_playlists}>
              {(tile) => (
                <ActivityTileComponent tile={tile} />
              )}
            </For>
          </div>
        </div>
      )}
    </div>
  );
}

// Individual activity tile component
function ActivityTileComponent(props: { tile: ActivityTile }) {
  const { playCollection } = useCollectionInteractions();

  const handlePlay = () => {
    if (props.tile.domain_type === "song") {
      // handle individual song play
    } else {
      playCollection(
        props.tile.domain_type,
        props.tile.id,
        {
          total_songs: 0,
          shuffle_enabled: false,
          play_source: "feed_tile",
        }
      );
    }
  };

  return (
    <div
      class="bg-gray-900 aspect-square p-2 hover:bg-magenta-600/10 transition-colors cursor-pointer"
      onClick={handlePlay}
    >
      {props.tile.image_url ? (
        <img
          src={`${apiClient().getBaseUrl()}${props.tile.image_url}`}
          alt={props.tile.title}
          class="w-full h-full object-cover mb-1"
        />
      ) : (
        <div class="w-full h-full flex items-center justify-center bg-gray-800 mb-1">
          <span class="text-gray-500 text-sm">
            {props.tile.domain_type === "album" ? "♪" :
             props.tile.domain_type === "playlist" ? "♭" :
             props.tile.domain_type === "song" ? "♫" : "♪"}
          </span>
        </div>
      )}
      <div class="text-xs text-white truncate">{props.tile.title}</div>
      {props.tile.subtitle && (
        <div class="text-xs text-gray-400 truncate">{props.tile.subtitle}</div>
      )}
    </div>
  );
}
```

### 8.6 route integration

add feed as default route and alternative route:

```typescript
// tomb/client/js/src/views/freqhole/routes/index.tsx (extend existing)
import { FeedView } from "../components/content/views/FeedView";

// update routes - feed becomes default landing page
<Route path="/" component={ThreeColumnLayout}>
    <Route path="/" component={FeedView} />  {/* NEW DEFAULT */}
    <Route path="/feed" component={FeedView} />  {/* ALTERNATIVE PATH */}
    <Route path="/albums" component={AlbumGridView} />  {/* MOVED FROM DEFAULT */}
    <Route path="/songs" component={SongTableView} />
    {/* ... rest of routes */}
</Route>
```

### 8.7 navigation integration

add feed link prominently in existing navigation:

```typescript
// tomb/client/js/src/views/freqhole/components/layout/sidebar/SidebarNavigation.tsx
// add feed navigation item at top, alongside albums, artists, etc.
<A
  href="/feed"
  class="flex items-center px-4 py-2 text-gray-300 hover:text-white hover:bg-magenta-600/20 transition-colors"
  activeClass="text-magenta-400 bg-magenta-600/20"
>
  feed
</A>
<A
  href="/albums"
  class="flex items-center px-4 py-2 text-gray-300 hover:text-white hover:bg-magenta-600/20 transition-colors"
  activeClass="text-magenta-400 bg-magenta-600/20"
>
  albums
</A>
```

### 8.8 mobile responsiveness

follow existing patterns with isMobile() hooks:

```typescript
// tomb/client/js/src/views/freqhole/components/content/views/FeedView.tsx
import { isMobile } from "../../../../../lib/utils/responsive";

// in FeedView component
const [mobile] = isMobile();

return (
  <Show
    when={!mobile()}
    fallback={<MobileFeedView feedData={feedData} />}
  >
    <DesktopFeedView feedData={feedData} />
  </Show>
);

// separate mobile component with different grid layout
function MobileFeedView(props: { feedData: Accessor<FeedResponse | null> }) {
  return (
    <div class="p-4">
      <div class="grid grid-cols-2 gap-3"> {/* mobile: 2 columns */}
        <For each={props.feedData()?.items}>
          {(item) => <MobileFeedItemCard item={item} />}
        </For>
      </div>
    </div>
  );
}
```

### 8.9 performance optimizations

database and query optimization strategies:

```sql
-- tomb/migrations/xxx_create_feed_indexes.sql
-- indexes for feed performance
CREATE INDEX idx_songs_created_at_album ON songs (created_at DESC, album, album_artist)
WHERE album IS NOT NULL AND album_artist IS NOT NULL;

CREATE INDEX idx_playlists_created_at ON playlists (created_at DESC);

CREATE INDEX idx_media_events_feed_lookup ON media_events
(created_at DESC, domain_type, event_type, domain_id)
WHERE event_type = 'play' AND domain_type IN ('album', 'playlist', 'song');

-- consider materialized view for expensive aggregations
CREATE MATERIALIZED VIEW recent_activity_summary AS
SELECT
    date_trunc('hour', created_at) as hour_bucket,
    domain_type,
    domain_id,
    COUNT(*) as play_count,
    COUNT(DISTINCT user_id) as unique_users
FROM media_events
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND event_type = 'play'
  AND domain_type IN ('album', 'playlist', 'song')
GROUP BY date_trunc('hour', created_at), domain_type, domain_id;

CREATE INDEX idx_activity_summary_lookup
ON recent_activity_summary (hour_bucket DESC, domain_type, play_count DESC);
```

### 8.10 implementation approach

following critical rules:

1. **no emojis**: text-based icons (♪♫♬♭), lowercase text
2. **file size limit**: split feed components into separate files
3. **dark theme**: black background, white text, magenta accents, no borders
4. **modular architecture**: solidjs createResource, reuse existing context patterns
5. **data validation**: zod schemas for all feed data
6. **code reuse**: leverage existing collection interactions, analytics api patterns
7. **domain separation**: feed logic in lib/analytics/, music integration in hooks/
8. **generic library focus**: build reusable feed item patterns
9. **legacy code marking**: mark any old activity patterns as @deprecated
10. **maximum code reuse**: extend existing analytics infrastructure, ui components

**testing approach**:

- verify feed endpoint returns appropriate aggregated data
- test pagination and filtering (days back)
- check context menus work for feed items
- validate performance with large user histories
- test caching behavior and invalidation

### dependencies

- extends existing analytics infrastructure (phases 1-7)
- requires user authentication for personalized feeds
- leverages existing collection interaction patterns
- uses existing ui components (grids, context menus)
- optional redis caching for performance

### rollout strategy

1. implement server-side social feed aggregation sql functions with proper joins
2. add feed endpoint to analytics routes (removes user-specific param)
3. extend client analytics api with social feed methods
4. create feed view components with visual tiles and responsive grid layout
5. update routing to make feed the default landing page (/ and /feed)
6. add prominent navigation integration
7. implement mobile/desktop responsive patterns following existing isMobile() hooks
8. add context menu integration following existing patterns (add to playlist, tag, edit, favorite)
9. create performance indexes and consider materialized views
10. test with various content creation and user activity patterns

this creates a social, discovery-oriented landing page that combines recent content creation with aggregated user activity, transforming the app from personal music management to a more engaging, community-driven music discovery experience while leveraging all existing infrastructure.
