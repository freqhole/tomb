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

## phase 1: server-side media events api

implement rest endpoints for receiving and storing media events.

### 1.1 grimoire media events models

create `grimoire/src/analytics/media_events.rs`:

- `MediaEvent` struct matching database schema
- `MediaEventType` enum with all event types from migration
- `MediaEventData` typed structs for common event payloads
- validation and serialization logic

### 1.2 grimoire media events repository

extend `grimoire/src/analytics/repository.rs`:

- `record_media_event()` method
- `get_media_events_for_session()` method
- `get_song_play_analytics()` method for aggregated song plays
- `get_user_listening_history()` method

### 1.3 grimoire media events service

extend `grimoire/src/analytics/service.rs`:

- business logic for event validation
- session management for grouping related events
- play completion detection logic
- rate limiting and spam protection

### 1.4 server endpoints

create `server/src/analytics/media_handlers.rs`:

- `POST /api/analytics/events` - receive events (single or batch array)
- `GET /api/analytics/songs/{song_id}/plays` - get play count for song
- `GET /api/analytics/history` - get current user's listening history
- `POST /api/admin/analytics/query` - flexible admin endpoint for all analytics queries

### 1.5 route configuration

extend `server/src/analytics/routes.rs`:

```rust
// protected routes (require authentication)
let protected_routes = Router::new()
    .route("/api/analytics/events", post(record_events))
    .route("/api/analytics/songs/:song_id/plays", get(get_song_plays))
    .route("/api/analytics/history", get(get_user_history))
    .layer(axum_middleware::from_fn(require_authentication));

// admin routes (require admin role)
let admin_routes = Router::new()
    .route("/api/admin/analytics/query", post(admin_analytics_query))
    .layer(axum_middleware::from_fn(require_admin))
    .layer(axum_middleware::from_fn(require_authentication));

analytics_routes.merge(protected_routes).merge(admin_routes)
```

**testing**: use curl commands with auth headers to post events and verify database storage

## phase 2: client-side event tracking system

build generic event tracking infrastructure for music player integration.

### 2.1 analytics client library

create `client/js/src/lib/analytics/`:

- `analytics-client.ts` - http client for sending events to server
- `event-buffer.ts` - in-memory buffer with 5-10 second batch sending, max 1000 events
- `session-manager.ts` - use existing cookie session system
- `event-types.ts` - typescript types matching server schemas

key buffering strategy:

- batch events every 5-10 seconds
- single retry attempt on failure
- attempt to drain buffer on page unload (with short timeout)
- simple fire-and-forget approach - analytics failures never block music playback

### 2.2 music analytics hook

create `client/js/src/hooks/music/useMusicAnalytics.ts`:

- reactive session management using existing session system
- methods to emit simple events: `play_start`, `play_complete`, `play_partial`
- automatic batching via event buffer
- integration with existing music hooks

### 2.3 music player instrumentation

integrate analytics with existing player component (`Player.tsx`):

**step 1: add analytics hook import**

```typescript
import { useMusicAnalytics } from "../../hooks/music/useMusicAnalytics";
```

**step 2: initialize analytics in player component**

```typescript
const analytics = useMusicAnalytics();
```

**step 3: hook into existing audio event listeners**

extend existing `timeupdate` listener to track progress:

```typescript
audio.addEventListener("timeupdate", () => {
  storeActions.setCurrentTime(audio.currentTime);
  // add analytics progress tracking
  analytics.trackProgress(audio.currentTime, audio.duration);
});
```

extend existing `ended` listener for completion:

```typescript
audio.addEventListener("ended", () => {
  storeActions.setPlayerState({ isPlaying: false });
  analytics.trackPlayComplete(); // add this
  playNext();
});
```

**step 4: hook into existing player state changes**

extend existing song loading effect to emit play start:

```typescript
// in the createEffect that loads new songs
if (shouldPlay) {
  audio.addEventListener(
    "canplay",
    () => {
      analytics.trackPlayStart(song); // add this
      audio.play().catch((err) => {
        console.error("failed to play audio:", err);
        storeActions.setPlayerState({ isPlaying: false });
      });
    },
    { once: true },
  );
}
```

hook into existing play/pause state changes for partial plays:

```typescript
// extend existing play/pause effect
if (playing && audio.paused) {
  audio.play().catch(...);
} else if (!playing && !audio.paused) {
  analytics.trackPlayPartial(); // add this before pause
  audio.pause();
}
```

**step 5: hook into existing queue navigation**

extend existing `playNext()` and `playPrevious()` to track partial plays:

```typescript
const playNext = () => {
  analytics.trackPlayPartial(); // track as partial if switching
  events.emit("queue:next", {});
};
```

this approach reuses all existing player infrastructure and events

**testing**: run music ui and verify events appear in database via raw sql queries

## phase 3: song play aggregation system

implement logic to convert raw events into meaningful play metrics.

### 3.1 play detection algorithms

extend grimoire analytics service:

- "complete play" = `play_complete` event (song reached 90%+ or natural end)
- "partial play" = `play_partial` event (song paused/skipped before 90%)
- simple 1:1 mapping between events and play counts
- session-based deduplication (one event per song per session)

### 3.2 aggregation functions

create sql functions in new migration:

- `calculate_song_plays(song_id, time_period)`
- `get_top_songs_by_plays(limit, time_period)`
- `get_user_listening_stats(user_id, time_period)`
- `refresh_analytics_materialized_views()`

### 3.3 background aggregation jobs

create scheduled tasks to update analytics:

- hourly play count updates
- daily trend calculations
- weekly/monthly reporting prep
- cleanup old raw events (keep aggregated data)

**testing**: generate test events via curl, run aggregation, verify correct play counts

## phase 4: analytics dashboard ui

build admin interface for viewing analytics data.

### 4.1 analytics api endpoints

extend `server/src/analytics/media_handlers.rs` with admin query handler:

the single admin endpoint handles all analytics queries with request body:

```rust
#[derive(Deserialize)]
struct AdminAnalyticsQuery {
    query_type: String,  // "overview", "top_songs", "user_history", "trends", etc.
    params: serde_json::Value,  // flexible params for each query type
}

pub async fn admin_analytics_query(
    Extension(user): Extension<AuthenticatedUser>,
    Json(query): Json<AdminAnalyticsQuery>,
) -> Result<Json<serde_json::Value>, WebauthnError> {
    match query.query_type.as_str() {
        "overview" => handle_overview_query(query.params).await,
        "top_songs" => handle_top_songs_query(query.params).await,
        "user_history" => handle_user_history_query(query.params).await,
        "trends" => handle_trends_query(query.params).await,
        _ => Err(WebauthnError::BadRequest("Unknown query type".into())),
    }
}
```

this single endpoint pattern makes adding new analytics queries simple - just add new match arms

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

this plan leverages the existing solid foundation while building a comprehensive analytics system focused on music listening behavior and song play tracking.
