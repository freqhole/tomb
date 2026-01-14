# grimoire to server routes mapping

comprehensive checklist of all grimoire public apis exposed via cli that need corresponding server http routes.

## purpose

this document maps:

1. grimoire public api functions
2. existing cli commands (from `cli/src/plumbing/`)
3. needed server http routes

use this to track which routes are implemented and ensure complete api coverage.

## priority order

1. **auth routes** (server-specific, not in grimoire)
2. **essential music routes** (songs, albums, artists, playlists)
3. **user preference routes** (favorites, ratings)
4. **supporting routes** (blobs, upload, health)
5. **admin routes** (defer to later, cli only for now)

---

## 1. authentication routes (server-specific)

these are server implementation details, not grimoire apis.

- [ ] `POST /auth/invite` - redeem invite code → issue session cookie
- [ ] `POST /auth/register/start` - start webauthn registration (if feature enabled)
- [ ] `POST /auth/register/finish` - finish webauthn registration (if feature enabled)
- [ ] `POST /auth/login/start` - start webauthn login (if feature enabled)
- [ ] `POST /auth/login/finish` - finish webauthn login (if feature enabled)
- [ ] `POST /auth/logout` - logout
- [ ] `GET /auth/whoami` - get current user info

**notes**:

- webauthn routes feature-gated
- api key auth via `Authorization: Bearer` header (no route needed)
- nearly all other routes require authenticated user

---

## 2. music query routes

### songs

**grimoire**: `music::crud::query_songs(params: QueryParams)`  
**cli**: `freqhole music query-songs [params]`  
**server**:

- [x] `POST /api/songs/query` - query/filter/search songs with pagination

**grimoire**: `music::crud::list_recent_songs(limit: i64)`  
**cli**: `freqhole music recent-songs --limit N`  
**server**:

- [x] `POST /api/songs/recent` - get recent songs (or use query route with sort)

**grimoire**: `music::crud::list_songs_by_artist(artist_id: String)`  
**cli**: (not wrapped separately, use query)  
**server**:

- [x] use query route with artist filter

**grimoire**: `music::crud::list_songs_by_album(album_id: String)`  
**cli**: (not wrapped separately, use query)  
**server**:

- [x] use query route with album filter

**grimoire**: `music::crud::search_songs(query: String)`  
**cli**: (part of query-songs)  
**server**:

- [x] use query route with search param

**note**: `query_songs()` is confirmed to fully replace `list_songs()` and related list functions. server should only expose query route.

### artists

**grimoire**: `music::crud::query_artists(params: QueryParams)`  
**cli**: `freqhole music query-artists [params]`  
**server**:

- [x] `POST /api/artists/query` - query/list artists with stats

**grimoire**: `music::crud::get_artist(artist_id: String)`  
**cli**: `freqhole music get-artist --artist-id ID`  
**server**:

- [x] `GET /api/artists/{id}` - get single artist by id

**grimoire**: `music::crud::list_artists(limit, offset)`  
**cli**: `freqhole music list-artists --limit N --offset N`  
**server**:

- [x] **verify query_artists can replace list_artists before removing**
- [x] use query route instead of separate list

### albums

**grimoire**: `music::crud::query_albums(params: QueryParams)`  
**cli**: `freqhole music query-albums [params]`  
**server**:

- [x] `POST /api/albums/query` - query/list albums with metadata

**grimoire**: `music::crud::get_album(album_id: String)`  
**cli**: `freqhole music get-album --album-id ID`  
**server**:

- [x] `GET /api/albums/{id}` - get single album by id

**grimoire**: `music::crud::list_albums(limit, offset)`  
**cli**: `freqhole music list-albums --limit N --offset N`  
**server**:

- [x] **verify query_albums can replace list_albums before removing**
- [x] use query route instead of separate list

**grimoire**: `music::crud::get_album_tags(album_id: String)`  
**cli**: `freqhole music get-album-tags --album-id ID`  
**server**:

- [ ] `POST /api/albums/tags` - get album tags (maybe defer)

### genres

**grimoire**: `music::crud::query_genres(params: QueryParams)`  
**cli**: `freqhole music query-genres [params]`  
**server**:

- [x] `POST /api/genres/query` - query genres with stats

**grimoire**: `music::crud::get_genre(genre_id: String)`  
**cli**: `freqhole music get-genre --genre-id ID`  
**server**:

- [x] `GET /api/genres/{id}` - get single genre

**grimoire**: `music::crud::get_genre_stats(genre_id: String)`  
**cli**: `freqhole music get-genre-stats --genre-id ID`  
**server**:

- [ ] `POST /api/genres/stats` - get genre statistics

**grimoire**: `music::crud::list_genres()`  
**cli**: `freqhole music list-genres`  
**server**:

- [x] **verify query_genres can replace list_genres before removing**
- [x] use query route instead

### sub-genres

**grimoire**: `music::entities::genres::list_sub_genres()`  
**cli**: `freqhole music list-sub-genres`  
**server**:

- [x] `GET /api/sub-genres/list` - list all sub-genres ✅

**grimoire**: `music::entities::genres::query_sub_genres(search: &str)`  
**cli**: `freqhole music query-sub-genres --search NAME`  
**server**:

- [x] `POST /api/sub-genres/query` - search sub-genres by name ✅

**grimoire**: `music::entities::genres::get_sub_genre(id: &str)`  
**cli**: `freqhole music get-sub-genre --id ID`  
**server**:

- [x] `GET /api/sub-genres/{id}` - get sub-genre by ID ✅

**grimoire**: `music::entities::genres::create_sub_genre(req)`  
**cli**: `freqhole music create-sub-genre --name NAME [--parent-genre-id ID]`  
**server**:

- [x] `POST /api/sub-genres/create` - create new sub-genre ✅

**grimoire**: `music::entities::genres::delete_sub_genre(id: &str, deleted_by: Option<String>)`  
**cli**: `freqhole music delete-sub-genre --id ID`  
**server**:

- [x] `POST /api/sub-genres/delete` - soft delete sub-genre ✅

**grimoire**: `music::entities::genres::list_sub_genres_for_genre(parent_genre_id: &str)`  
**cli**: `freqhole music list-sub-genres-for-genre --genre-id ID`  
**server**:

- [x] `POST /api/sub-genres/for-genre` - list sub-genres for a parent genre ✅

**grimoire**: `music::entities::genres::find_or_create_sub_genre(name, parent_id)`  
**cli**: n/a (internal)  
**server**:

- [x] `POST /api/sub-genres/find-or-create` - find or create sub-genre (upsert) ✅

### tags

**grimoire**: `music::crud::list_tags()`  
**cli**: `freqhole music list-tags`  
**server**:

- [ ] `POST /api/tags/query` - list/query tags (maybe defer)

**grimoire**: `music::crud::search_tags(search: String)`  
**cli**: `freqhole music query-tags-search --search NAME`  
**server**:

- [ ] use query route (maybe defer)

---

## 3. music mutation routes

### songs

**grimoire**: `music::crud::update_songs(request: UpdateSongsRequest)`  
**cli**: `freqhole music update-songs --json-input '{...}'`  
**server**:

- [x] `POST /api/songs/update` - bulk update song metadata

**grimoire**: `music::crud::delete_song(song_id: String, deleted_by: Option<String>)`  
**cli**: `freqhole music delete-song --song-id ID`  
**server**:

- [x] `DELETE /api/songs/{id}` - soft delete songs

### albums

**grimoire**: `music::crud::delete_album(album_id: String, deleted_by: Option<String>)`  
**cli**: `freqhole music delete-album --album-id ID`  
**server**:

- [x] `DELETE /api/albums/{id}` - soft delete album

### artists

**grimoire**: `music::crud::delete_artist(artist_id: String, deleted_by: Option<String>)`  
**cli**: `freqhole music delete-artist --artist-id ID`  
**server**:

- [x] `DELETE /api/artists/{id}` - soft delete artist

---

## 4. playlist routes

### query

**grimoire**: `music::crud::query_playlists(params: QueryParams)`  
**cli**: `freqhole music query-playlists [params]`  
**server**:

- [ ] `POST /api/playlists/query` - query/list playlists

**grimoire**: `music::crud::list_playlists()`  
**cli**: `freqhole music list-playlists`  
**server**:

- [ ] **verify query_playlists can replace list_playlists before removing**
- [ ] use query route instead

**grimoire**: `music::crud::list_user_playlists(user_id: String, limit, offset)`  
**cli**: `freqhole music list-user-playlists --user-id ID`  
**server**:

- [ ] **verify query_playlists with user filter works equivalently**
- [ ] use query route with user filter

**grimoire**: `music::crud::search_playlists(query: String, limit, offset)`  
**cli**: `freqhole music search-playlists --query NAME`  
**server**:

- [ ] use query route with search param

**grimoire**: `music::crud::get_playlist(playlist_id: String)`  
**cli**: (use query with id)  
**server**:

- [ ] `POST /api/playlists/get` - get single playlist

**grimoire**: `music::crud::query_playlist_songs(playlist_id: String, params: QueryParams)`  
**cli**: `freqhole music query-playlist-songs --playlist-id ID`  
**server**:

- [ ] `POST /api/playlists/songs` - get playlist songs with pagination

**grimoire**: `music::crud::get_playlist_songs(playlist_id: String)`  
**cli**: (use query instead)  
**server**:

- [ ] use query route

### mutations

**grimoire**: `music::crud::create_playlist(request: CreatePlaylistRequest)`  
**cli**: `freqhole music create-playlist --json-input '{...}'`  
**server**:

- [x] `POST /api/playlists/create` - create new playlist

**grimoire**: `music::crud::update_playlist(playlist_id: String, request: UpdatePlaylistRequest)`  
**cli**: `freqhole music update-playlist --playlist-id ID --json-input '{...}'`  
**server**:

- [x] `POST /api/playlists/update` - update playlist metadata

**grimoire**: `music::crud::delete_playlist(playlist_id: String)`  
**cli**: `freqhole music delete-playlist --playlist-id ID`  
**server**:

- [x] `POST /api/playlists/delete` - delete playlist

**grimoire**: `music::crud::add_songs_to_playlist(request: AddSongsToPlaylistRequest)`  
**cli**: `freqhole music add-songs-to-playlist --json-input '{...}'`  
**server**:

- [x] `POST /api/playlists/add-songs` - add songs to playlist

**grimoire**: `music::crud::remove_songs_from_playlist(playlist_id: String, song_ids: Vec<String>)`  
**cli**: (wrapped in add-songs handler)  
**server**:

- [x] `POST /api/playlists/remove-songs` - remove songs from playlist

**grimoire**: `music::crud::update_song_position(playlist_id: String, song_id: String, new_position: i32)`  
**cli**: `freqhole music update-song-position --playlist-id ID --song-id ID --new-position N`  
**server**:

- [x] `POST /api/playlists/reorder` - reorder songs in playlist

**grimoire**: `music::crud::update_songs_position(playlist_id: String, song_ids: Vec<String>)`  
**cli**: `freqhole music update-song-position --song-ids ID,ID,ID`  
**server**:

- [ ] use reorder route

**grimoire**: `music::crud::remove_playlist_thumbnail(playlist_id: String, cleanup_blob: bool)`  
**cli**: `freqhole music remove-playlist-thumbnail --playlist-id ID --cleanup-blob`  
**server**:

- [x] `POST /api/playlists/remove-thumbnail` - remove playlist thumbnail

---

## 5. user favorites routes

**grimoire**: `music::users::FavoritesService::set_favorite(user_id, request: SetFavoriteRequest)`  
**cli**: `freqhole music favorites set --target-type song --target-id ID --is-favorite true`  
**server**:

- [x] `POST /api/favorites/set` - set favorite status

**grimoire**: `music::users::FavoritesService::get_favorite(user_id, target_type, target_id)`  
**cli**: `freqhole music favorites get --target-type song --target-id ID`  
**server**:

- [ ] `POST /api/favorites/get` - get favorite status (or just include in query results)

**grimoire**: `music::users::FavoritesService::list_favorites(user_id, target_type, limit, offset)`  
**cli**: `freqhole music favorites list --target-type song`  
**server**:

- [x] `POST /api/favorites/list` - list user favorites by type

**grimoire**: `music::users::FavoritesService::remove_favorite(user_id, target_type, target_id)`  
**cli**: `freqhole music favorites remove --target-type song --target-id ID`  
**server**:

- [ ] use set with is_favorite=false

**grimoire**: `music::users::FavoritesService::get_favorites_count(user_id, target_type)`  
**cli**: `freqhole music favorites count --target-type song`  
**server**:

- [ ] `POST /api/favorites/count` - count favorites by type (maybe defer)

---

## 6. user ratings routes

**grimoire**: `music::users::RatingsService::set_rating(user_id, request: SetRatingRequest)`  
**cli**: `freqhole music ratings set --target-type song --target-id ID --rating 5`  
**server**:

- [x] `POST /api/ratings/set` - set rating (1-5)

**grimoire**: `music::users::RatingsService::get_rating(user_id, target_type, target_id)`  
**cli**: `freqhole music ratings get --target-type song --target-id ID`  
**server**:

- [ ] `POST /api/ratings/get` - get rating (or include in query results)

**grimoire**: `music::users::RatingsService::list_ratings(user_id, target_type, limit, offset)`  
**cli**: `freqhole music ratings list --target-type song`  
**server**:

- [ ] `POST /api/ratings/list` - list user ratings

**grimoire**: `music::users::RatingsService::remove_rating(user_id, target_type, target_id)`  
**cli**: `freqhole music ratings remove --target-type song --target-id ID`  
**server**:

- [x] `POST /api/ratings/remove` - remove rating

**grimoire**: `music::users::RatingsService::get_rating_stats(target_type, target_id)`  
**cli**: `freqhole music ratings stats --target-type song --target-id ID`  
**server**:

- [x] `POST /api/ratings/stats` - get rating statistics

**grimoire**: `music::users::RatingsService::get_user_rating_stats(user_id, target_type)`  
**cli**: `freqhole music ratings user-stats --target-type song`  
**server**:

- [ ] `POST /api/ratings/user-stats` - get user's rating distribution

---

## 7. analytics routes

**grimoire**: `music::analytics::record_play_event(media_event, music_event)`  
**cli**: (not exposed via cli)  
**server**:

- [x] `POST /api/analytics/play` - record play event (or handle client-side)

**grimoire**: `music::analytics::get_user_listening_history(user_id, limit, offset)`  
**cli**: (check if wrapped)  
**server**:

- [x] `POST /api/analytics/listening-history` - get listening history

**grimoire**: `music::analytics::get_combined_feed(user_id, limit)`  
**cli**: (check if wrapped)  
**server**:

- [x] `POST /api/analytics/feed` - get activity feed

**grimoire**: `music::analytics::get_song_play_analytics(song_id, user_id)`  
**cli**: (check if wrapped)  
**server**:

- [x] `POST /api/analytics/song-stats` - get song play analytics

**grimoire**: `music::analytics::get_top_songs(user_id, limit, days)`  
**cli**: (check if wrapped)  
**server**:

- [x] `POST /api/analytics/top-songs` - get top played songs

**grimoire**: `music::analytics::get_top_artists(user_id, limit, days)`  
**cli**: (check if wrapped)  
**server**:

- [x] `POST /api/analytics/top-artists` - get top artists

**grimoire**: `music::analytics::get_top_albums(user_id, limit, days)`  
**cli**: (check if wrapped)  
**server**:

- [x] `POST /api/analytics/top-albums` - get top albums

---

## 8. musicbrainz routes

**grimoire**: `music::musicbrainz::search_releases(query: String, limit)`  
**cli**: `freqhole music musicbrainz search --query NAME`  
**server**:

- [x] `POST /api/musicbrainz/search/releases` - search releases

**grimoire**: `music::musicbrainz::get_release(mbid: String)`  
**cli**: `freqhole music musicbrainz get --mbid ID`  
**server**:

- [x] `POST /api/musicbrainz/release` - get release by mbid

---

## 9. blob/media routes

**grimoire**: `media_blobz::get_blob(blob_id: String)`  
**cli**: (not wrapped - storage operation)  
**server**:

- [ ] `GET /api/blobs/{id}` - stream blob data with range support
- [ ] `HEAD /api/blobs/{id}` - get blob metadata

**grimoire**: `media_blobz::create_blob(request: CreateMediaBlobRequest)`  
**cli**: (not wrapped - part of upload flow)  
**server**:

- [ ] `POST /api/upload` - multipart file upload → create blob + extract metadata

---

## 10. health/status routes

these are server-specific, not grimoire apis.

- [x] `GET /health` - health check (verifies db connection)

---

## 11. static file routes

server-specific, not grimoire apis.

- [ ] `GET /*path` - serve static files with mime types, range support, spa fallback

---

## 12. jobs routes (fetch_music)

**grimoire**: `music::fetch_music::fetch_from_url(url: String)` (to be added)  
**cli**: `freqhole fetch url <URL>` (to be added)  
**server**:

- [ ] `POST /api/fetch` - fetch music from url

**grimoire**: `jobs::get_job_status(job_id: String)` (exists)  
**cli**: `freqhole fetch status <JOB_ID>` (to be added)  
**server**:

- [x] `POST /api/jobs/status` - get job status

**grimoire**: `jobs::list_jobs(user_id: Option<String>)` (exists)  
**cli**: `freqhole fetch list` (to be added)  
**server**:

- [x] `POST /api/jobs/list` - list user's jobs

---

## 13. user management routes (admin only - cli preferred)

**grimoire**: `users::UserService::create_user(request: CreateUserRequest)`  
**cli**: `freqhole users create --json-input '{...}'`  
**server**:

- [ ] defer to cli only for now

**grimoire**: `users::UserService::list_users(params: UserQueryParams)`  
**cli**: `freqhole users list`  
**server**:

- [ ] defer to cli only for now

**grimoire**: `users::UserService::get_user(user_id: String)`  
**cli**: `freqhole users get --user-id ID`  
**server**:

- [ ] defer to cli only for now

**grimoire**: `users::UserService::update_user(user_id: String, request: UpdateUserRequest)`  
**cli**: `freqhole users update --user-id ID --json-input '{...}'`  
**server**:

- [ ] defer to cli only for now

**grimoire**: `users::UserService::delete_user(user_id: String)`  
**cli**: `freqhole users delete --user-id ID`  
**server**:

- [ ] defer to cli only for now

---

## 14. invite code routes (admin only - cli preferred)

**grimoire**: `users::UserService::create_invite_codes(request: CreateInviteCodeRequest)`  
**cli**: `freqhole users create-invite-codes --count N`  
**server**:

- [ ] defer to cli only for now

**grimoire**: `users::UserService::list_invite_codes()`  
**cli**: `freqhole users list-invite-codes`  
**server**:

- [ ] defer to cli only for now

---

## route count summary

### essential (implement first):

- auth: 7 routes
- songs: 3-4 routes
- artists: 2-3 routes
- albums: 2-3 routes
- playlists: 8-10 routes
- favorites: 2-3 routes
- ratings: 2-3 routes
- blobs: 2 routes
- upload: 1 route
- health: 3 routes
- static: 1 route

**total essential: ~35-40 routes**

### defer to later:

- analytics: 5-7 routes (listening history, feed priority)
- musicbrainz: 2 routes
- jobs/fetch: 2-3 routes
- genres: 2 routes (implemented)
- user admin: cli only
- invite codes: cli only

### notes on duplication and verification

grimoire has both `list_*()` and `query_*()` functions for many entities.
**prefer `query_*()` functions** - they support filtering, search, pagination.
`list_*()` functions are redundant and should be removed eventually.

example:

- ❌ `list_songs()` - basic list with limit/offset
- ✅ `query_songs()` - supports filters, search, sort, pagination

**verification needed**:

- ✅ `query_songs()` confirmed to fully replace `list_songs()`
- ❓ `query_artists()` - verify returns same data as `list_artists()` before removing
- ❓ `query_albums()` - verify returns same data as `list_albums()` before removing
- ❓ `query_playlists()` - verify returns same data as `list_playlists()` before removing
- ❓ `query_genres()` - verify returns same data as `list_genres()` before removing

**important**: investigate each case during implementation. only remove list functions after confirming query functions are equivalent.

server routes should **only use `query_*()` functions** and never expose simple `list_*()` variants (after verification).

---

## implementation workflow

1. **phase 1**: auth routes (server-specific, feature-flagged webauthn)
2. **phase 2**: establish pattern with 2-3 essential routes
   - `POST /api/songs/query`
   - `POST /api/playlists/create`
   - verify patterns work well
3. **phase 3**: rapid implementation of remaining essential routes
   - should be shallow wrappers of grimoire apis
   - reuse grimoire request/response types
   - consistent error handling
   - **verify query functions can replace list functions as you go**
4. **phase 4**: har analysis to identify gaps
5. **phase 5**: fill gaps from har analysis

---

## notes

- all routes except auth require authenticated user
- prefer POST over GET for queries (avoid query param issues)
- reuse grimoire types directly (no server-specific request/response duplication)
- session auth via cookie, api key auth via bearer token
- webauthn routes feature-gated
- admin operations stay in cli (user mgmt, invite codes)
