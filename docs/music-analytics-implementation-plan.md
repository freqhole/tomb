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

analytics events are being collected successfully with proper session tracking and user association. phases 3.1 and 3.2 completed with enhanced sql functions and materialized views for performance. ready for phase 3.3 background jobs.

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

**testing**: 4 scheduled jobs created automatically, job queue operational with proper status tracking and worker management

### implementation approach ✅ COMPLETE

built on existing foundation successfully:

- ✅ extended `grimoire/src/analytics/repository.rs` with materialized view refresh methods
- ✅ added job scheduling system using proven patterns from existing job queues
- ✅ enhanced admin dashboard queries in `server/src/analytics/media_handlers.rs` with new analytics endpoints
- ✅ leveraged existing `POST /api/admin/analytics/query` endpoint with 5 new query types
- ✅ integrated into server startup alongside thumbnail and music job queues

## phase 4: analytics dashboard ui (FUTURE)

build admin interface for viewing analytics data.

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

### 4.2 analytics dashboard components

create `client/js/src/views/admin/analytics/`:

- `AnalyticsDashboard.tsx` - main dashboard layout
- `PlayMetricsCard.tsx` - song play statistics
- `TrendChart.tsx` - time series visualization
- `TopSongsTable.tsx` - most played songs list
- `UserActivityChart.tsx` - user engagement metrics

### 4.3 real-time updates

extend websocket system:

- emit analytics events via websocket for real-time dashboard updates
- update play counts in real-time as events occur
- live user activity indicators

**testing**: navigate to admin analytics dashboard, verify data loads and updates

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
