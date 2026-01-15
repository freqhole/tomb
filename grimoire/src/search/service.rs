//! search service implementation for full-text search and autocomplete

use crate::database;
use crate::error::GrimoireResult;
use crate::search::models::*;
use sqlx::SqlitePool;

/// get autocomplete suggestions with confidence filtering
pub async fn get_suggestions(
    req: SuggestionsRequest,
    user_id: Option<&str>,
) -> GrimoireResult<SuggestionsResponse> {
    let start = std::time::Instant::now();
    let pool = database::connect().await?;

    // build FTS query based on field
    let mut suggestions = Vec::new();

    match req.field {
        SearchField::All => {
            // query all entity types, merge and sort by confidence
            suggestions.extend(get_song_suggestions(&pool, &req.partial, user_id).await?);
            suggestions.extend(get_artist_suggestions(&pool, &req.partial, user_id).await?);
            suggestions.extend(get_album_suggestions(&pool, &req.partial, user_id).await?);
            suggestions.extend(get_genre_suggestions(&pool, &req.partial).await?);
            suggestions.extend(get_sub_genre_suggestions(&pool, &req.partial).await?);
            suggestions.extend(get_playlist_suggestions(&pool, &req.partial, user_id).await?);
        }
        SearchField::Songs => {
            suggestions = get_song_suggestions(&pool, &req.partial, user_id).await?;
        }
        SearchField::Artists => {
            suggestions = get_artist_suggestions(&pool, &req.partial, user_id).await?;
        }
        SearchField::Albums => {
            suggestions = get_album_suggestions(&pool, &req.partial, user_id).await?;
        }
        SearchField::Genres => {
            suggestions.extend(get_genre_suggestions(&pool, &req.partial).await?);
            suggestions.extend(get_sub_genre_suggestions(&pool, &req.partial).await?);
        }
        SearchField::Playlists => {
            suggestions = get_playlist_suggestions(&pool, &req.partial, user_id).await?;
        }
    }

    // apply confidence filtering per field type
    suggestions.retain(should_include_suggestion);

    // sort by confidence and count
    suggestions.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.count.cmp(&a.count))
    });

    // paginate
    let page_size = req.page_size.unwrap_or(10);
    let total = suggestions.len();
    let paginated_suggestions = suggestions.into_iter().take(page_size as usize).collect();

    let query_time_ms = start.elapsed().as_millis() as u64;

    Ok(SuggestionsResponse {
        suggestions: paginated_suggestions,
        query_time_ms,
        total_count: total as u64,
        page: 1,
        page_size,
        total_pages: ((total as u32 + page_size - 1) / page_size).max(1),
        has_next: total > page_size as usize,
        has_prev: false,
    })
}

/// full search with user preferences and global context
pub async fn search(req: SearchRequest, user_id: Option<&str>) -> GrimoireResult<SearchResponse> {
    let start = std::time::Instant::now();
    let pool = database::connect().await?;

    let field = req.field.unwrap_or_default();
    let page = req.page.unwrap_or(1);
    let page_size = req.page_size.unwrap_or(50);
    let offset = (page - 1) * page_size;

    // extract filters from context
    let tag_filter = req.context.as_ref().and_then(|ctx| ctx.tags.as_ref());
    let genre_filter = req.context.as_ref().and_then(|ctx| ctx.genres.as_ref());
    let sub_genre_filter = req.context.as_ref().and_then(|ctx| ctx.sub_genres.as_ref());

    let mut response = SearchResponse {
        songs: Vec::new(),
        artists: None,
        albums: None,
        genres: None,
        playlists: None,
        total_count: 0,
        page,
        page_size,
        total_pages: 0,
        has_next: false,
        has_prev: page > 1,
        query_time_ms: 0,
        applied_filters: req.context.as_ref().map(|ctx| {
            serde_json::json!({
                "tags": ctx.tags,
                "genres": ctx.genres,
                "sub_genres": ctx.sub_genres,
            })
        }),
        sort_applied: None,
    };

    // execute search based on field
    match field {
        SearchField::All => {
            // get best results from each category
            response.songs = search_songs(
                &pool,
                &req.query,
                user_id,
                tag_filter,
                genre_filter,
                sub_genre_filter,
                20,
                0,
            )
            .await?;
            response.artists = Some(search_artists(&pool, &req.query, user_id, 10, 0).await?);
            response.albums = Some(
                search_albums(
                    &pool,
                    &req.query,
                    user_id,
                    tag_filter,
                    genre_filter,
                    sub_genre_filter,
                    10,
                    0,
                )
                .await?,
            );
            response.genres = Some(search_genres(&pool, &req.query, genre_filter, 10, 0).await?);
            response.playlists = Some(search_playlists(&pool, &req.query, user_id, 10, 0).await?);
            response.total_count = response.songs.len() as i64;
        }
        SearchField::Songs => {
            response.songs = search_songs(
                &pool,
                &req.query,
                user_id,
                tag_filter,
                genre_filter,
                sub_genre_filter,
                page_size,
                offset,
            )
            .await?;
            response.total_count = count_song_results(
                &pool,
                &req.query,
                tag_filter,
                genre_filter,
                sub_genre_filter,
            )
            .await?;
        }
        SearchField::Artists => {
            let artists = search_artists(&pool, &req.query, user_id, page_size, offset).await?;
            response.total_count = artists.len() as i64;
            response.artists = Some(artists);
        }
        SearchField::Albums => {
            let albums = search_albums(
                &pool,
                &req.query,
                user_id,
                tag_filter,
                genre_filter,
                sub_genre_filter,
                page_size,
                offset,
            )
            .await?;
            response.total_count = albums.len() as i64;
            response.albums = Some(albums);
        }
        SearchField::Genres => {
            let genres = search_genres(&pool, &req.query, genre_filter, page_size, offset).await?;
            response.total_count = genres.len() as i64;
            response.genres = Some(genres);
        }
        SearchField::Playlists => {
            let playlists = search_playlists(&pool, &req.query, user_id, page_size, offset).await?;
            response.total_count = playlists.len() as i64;
            response.playlists = Some(playlists);
        }
    }

    response.total_pages = ((response.total_count as u32 + page_size - 1) / page_size).max(1);
    response.has_next = page < response.total_pages;
    response.query_time_ms = start.elapsed().as_millis() as u64;

    Ok(response)
}

// =============================================================================
// Helper Functions
// =============================================================================

/// determine if suggestion should be included based on confidence threshold
fn should_include_suggestion(suggestion: &Suggestion) -> bool {
    // determine match type from suggestion metadata
    let match_type = suggestion
        .metadata
        .as_ref()
        .and_then(|m| m.get("match_type"))
        .and_then(|mt| mt.as_str())
        .map(MatchType::from_str)
        .unwrap_or(MatchType::Name);

    suggestion.confidence >= match_type.threshold()
}

/// calculate confidence score based on query match quality
pub fn calculate_confidence(query: &str, match_text: &str, fts_rank: f32) -> f32 {
    let query_lower = query.to_lowercase();
    let match_lower = match_text.to_lowercase();

    if match_lower == query_lower {
        1.0 // exact match
    } else if match_lower.starts_with(&query_lower) {
        0.9 // prefix match
    } else if match_lower.contains(&query_lower) {
        0.7 // contains match
    } else {
        // fuzzy/FTS match - use normalized rank
        (0.5 + (fts_rank.abs() * 0.05)).min(0.6)
    }
}

/// apply user preference multiplier to ranking score
pub fn apply_user_preference_multiplier(
    base_score: f32,
    rating: Option<i32>,
    is_favorite: bool,
) -> f32 {
    let mut score = base_score;

    // apply rating multiplier
    if let Some(r) = rating {
        score *= match r {
            5 => 1.5,
            4 => 1.2,
            3 => 1.0,
            2 => 0.8,
            1 => 0.5,
            0 => 0.0, // filter out entirely (zero-star means "don't show me this")
            _ => 1.0,
        };
    }

    // apply favorite boost
    if is_favorite {
        score *= 1.3;
    }

    score
}

/// generate highlight with markdown bold for matched text
pub fn generate_highlight(text: &str, query: &str) -> String {
    let query_lower = query.to_lowercase();
    let text_lower = text.to_lowercase();

    if let Some(pos) = text_lower.find(&query_lower) {
        let mut result = String::new();
        result.push_str(&text[..pos]);
        result.push_str("**");
        result.push_str(&text[pos..pos + query.len()]);
        result.push_str("**");
        result.push_str(&text[pos + query.len()..]);
        result
    } else {
        text.to_string()
    }
}

// =============================================================================
// Entity Search Functions (Autocomplete)
// =============================================================================

/// get song suggestions from FTS with user preferences
async fn get_song_suggestions(
    _pool: &SqlitePool,
    _partial: &str,
    _user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // TODO: implement SQL query
    // 1. query songz_fts with prefix match: `title:partial* OR artist_name:partial*`
    // 2. join to songz for full details
    // 3. join to user_ratingz and user_favoritez if user_id provided
    // 4. calculate confidence for each field match (title, artist, album, filename, lyrics)
    // 5. apply user preference multipliers (rating boost + favorite boost)
    // 6. filter out zero-rated songs (rating = 0 means user marked "don't show")
    // 7. return top 10 results ordered by (confidence * user_multiplier) DESC
    //
    // SQL pattern with sqlx macros:
    // SELECT song.id, song.title, fts.rank,
    //        COALESCE(rating.rating, -1) as user_rating,
    //        CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
    // FROM songz_fts fts
    // JOIN songz song ON fts.song_id = song.id
    // LEFT JOIN user_ratingz rating
    //   ON rating.target_id = song.id
    //   AND rating.target_type = 'song'
    //   AND rating.user_id = ?
    // LEFT JOIN user_favoritez favorite
    //   ON favorite.target_id = song.id
    //   AND favorite.target_type = 'song'
    //   AND favorite.user_id = ?
    // WHERE songz_fts MATCH ?
    //   AND song.deleted_at IS NULL
    //   AND (rating.rating IS NULL OR rating.rating != 0)  -- exclude zero-rated
    // ORDER BY rank DESC
    // LIMIT 10

    Ok(Vec::new())
}

/// get artist suggestions from FTS with user preferences
async fn get_artist_suggestions(
    _pool: &SqlitePool,
    _partial: &str,
    _user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // TODO: implement SQL query
    // 1. query artistz_fts with prefix match: `name:partial*`
    // 2. join to artistz for full details
    // 3. join to user_ratingz and user_favoritez if user_id provided
    // 4. count associated songs for each artist
    // 5. calculate confidence and apply user prefs
    // 6. return top 10 results

    Ok(Vec::new())
}

/// get album suggestions from FTS with user preferences
async fn get_album_suggestions(
    _pool: &SqlitePool,
    _partial: &str,
    _user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // TODO: implement SQL query
    // 1. query albumz_fts with prefix match: `title:partial* OR artist_name:partial*`
    // 2. join to albumz for full details
    // 3. join to user_ratingz and user_favoritez if user_id provided
    // 4. count associated songs
    // 5. calculate confidence and apply user prefs
    // 6. return top 10 results

    Ok(Vec::new())
}

/// get genre suggestions from FTS
async fn get_genre_suggestions(
    _pool: &SqlitePool,
    _partial: &str,
) -> GrimoireResult<Vec<Suggestion>> {
    // TODO: implement SQL query
    // 1. query genrez_fts with prefix match: `name:partial*`
    // 2. join to genrez for full details
    // 3. count associated albums/songs
    // 4. calculate confidence (no user prefs for genres)
    // 5. return top 10 results

    Ok(Vec::new())
}

/// get sub-genre suggestions from FTS
async fn get_sub_genre_suggestions(
    _pool: &SqlitePool,
    _partial: &str,
) -> GrimoireResult<Vec<Suggestion>> {
    // TODO: implement SQL query
    // 1. query sub_genrez_fts with prefix match: `name:partial*`
    // 2. join to sub_genrez and parent genrez
    // 3. count associated albums/songs
    // 4. calculate confidence
    // 5. return top 10 results

    Ok(Vec::new())
}

/// get playlist suggestions from FTS with privacy filtering
async fn get_playlist_suggestions(
    _pool: &SqlitePool,
    _partial: &str,
    _user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    // TODO: implement SQL query
    // 1. query playlistz_fts with prefix match: `title:partial*`
    // 2. join to playlistz for full details
    // 3. filter by privacy: (is_public = 1 OR created_by = user_id)
    // 4. count songs in playlist
    // 5. calculate confidence
    // 6. return top 10 results

    Ok(Vec::new())
}

// =============================================================================
// Entity Search Functions (Full Search)
// =============================================================================

/// search songs with full details and filtering
async fn search_songs(
    _pool: &SqlitePool,
    _query: &str,
    _user_id: Option<&str>,
    _tag_filter: Option<&FilterSet>,
    _genre_filter: Option<&FilterSet>,
    _sub_genre_filter: Option<&FilterSet>,
    _limit: u32,
    _offset: u32,
) -> GrimoireResult<Vec<SongSearchResult>> {
    // TODO: implement SQL query with complex filtering
    // note: ordering is by relevance (fts rank * user prefs), NOT by disc/track number
    // disc/track ordering only matters for non-search contexts (album pages, etc.)
    //
    // 1. FTS search on songz_fts MATCH query
    // 2. join to songz, artistz (via artist_songz), albumz (via album_songz) for full details
    // 3. join to user_ratingz and user_favoritez if user_id provided
    // 4. apply tag filtering (via album_tagz junction):
    //    - include: song must be on album with at least one of included tags (OR)
    //    - exclude: song must NOT be on album with any excluded tags (AND NOT)
    // 5. apply genre filtering (via albumz.genre_id):
    //    - include: song must be on album with one of included genres (OR)
    //    - exclude: song must NOT be on album with any excluded genres (AND NOT)
    // 6. apply sub-genre filtering (via album_sub_genrez junction):
    //    - include: song must be on album with at least one included sub-genre (OR)
    //    - exclude: song must NOT be on album with any excluded sub-genres (AND NOT)
    // 7. filter out zero-rated songs for this user (rating = 0 means "don't show")
    // 8. calculate final rank = fts.rank * user_preference_multiplier
    //    - use apply_user_preference_multiplier() helper
    //    - rating multipliers: 5→1.5x, 4→1.2x, 3→1.0x, 2→0.8x, 1→0.5x, 0→filter out
    //    - favorite boost: 1.3x
    // 9. order by calculated rank DESC (most relevant first)
    // 10. limit and offset for pagination
    //
    // approach: use sqlx with conditional WHERE clauses
    // - if filters are None, skip those joins/conditions
    // - if filters have include lists, use IN (?)
    // - if filters have exclude lists, use NOT IN (?) or NOT EXISTS subquery
    //
    // example structure:
    // SELECT song.id, song.title, album.title as album_title,
    //        GROUP_CONCAT(artist.name) as artist_names,
    //        fts.rank, rating.rating, favorite.id as is_favorite
    // FROM songz_fts fts
    // JOIN songz song ON fts.song_id = song.id
    // JOIN album_songz asong ON song.id = asong.song_id
    // JOIN albumz album ON asong.album_id = album.id
    // JOIN artist_songz arsong ON song.id = arsong.song_id
    // JOIN artistz artist ON arsong.artist_id = artist.id
    // LEFT JOIN user_ratingz rating ON ... AND (rating.rating IS NULL OR rating.rating != 0)
    // LEFT JOIN user_favoritez favorite ON ...
    // WHERE songz_fts MATCH ?
    //   AND song.deleted_at IS NULL
    //   AND (? OR album.id IN (SELECT album_id FROM album_tagz WHERE tag_id IN (?)))
    //   AND (? OR album.id NOT IN (SELECT album_id FROM album_tagz WHERE tag_id IN (?)))
    //   -- similar for genres and sub-genres
    // GROUP BY song.id
    // ORDER BY (rank * user_multiplier) DESC
    // LIMIT ? OFFSET ?

    Ok(Vec::new())
}

/// search artists with aggregates
async fn search_artists(
    _pool: &SqlitePool,
    _query: &str,
    _user_id: Option<&str>,
    _limit: u32,
    _offset: u32,
) -> GrimoireResult<Vec<ArtistSearchResult>> {
    // TODO: implement SQL query
    // 1. FTS search on artistz_fts MATCH query
    // 2. join to artistz for full details
    // 3. join to user_ratingz and user_favoritez if user_id provided
    // 4. count songs and albums for each artist
    // 5. collect genre names via artist_songz -> albumz -> genrez
    // 6. calculate confidence and apply user prefs
    // 7. order by rank DESC
    // 8. limit and offset

    Ok(Vec::new())
}

/// search albums with filtering
async fn search_albums(
    _pool: &SqlitePool,
    _query: &str,
    _user_id: Option<&str>,
    _tag_filter: Option<&FilterSet>,
    _genre_filter: Option<&FilterSet>,
    _sub_genre_filter: Option<&FilterSet>,
    _limit: u32,
    _offset: u32,
) -> GrimoireResult<Vec<AlbumSearchResult>> {
    // TODO: implement SQL query with filtering
    // 1. FTS search on albumz_fts MATCH query
    // 2. join to albumz, genrez, sub_genrez for full details
    // 3. join to user_ratingz and user_favoritez if user_id provided
    // 4. apply tag/genre/sub-genre filters (same logic as songs but simpler - direct album filters)
    // 5. count songs in album
    // 6. calculate confidence and apply user prefs
    // 7. order by rank DESC
    // 8. limit and offset

    Ok(Vec::new())
}

/// search genres with aggregates
async fn search_genres(
    _pool: &SqlitePool,
    _query: &str,
    _genre_filter: Option<&FilterSet>,
    _limit: u32,
    _offset: u32,
) -> GrimoireResult<Vec<GenreSearchResult>> {
    // TODO: implement SQL query
    // 1. FTS search on genrez_fts MATCH query
    // 2. join to genrez for full details
    // 3. collect sub-genres via sub_genrez where parent_genre_id matches
    // 4. count songs and artists in this genre (via albumz.genre_id)
    // 5. apply genre_filter if provided (for consistency with context)
    // 6. get representative song (highest rated or most played)
    // 7. calculate average rating across songs in genre
    // 8. order by rank DESC
    // 9. limit and offset

    Ok(Vec::new())
}

/// search playlists with privacy filtering
async fn search_playlists(
    _pool: &SqlitePool,
    _query: &str,
    _user_id: Option<&str>,
    _limit: u32,
    _offset: u32,
) -> GrimoireResult<Vec<PlaylistSearchResult>> {
    // TODO: implement SQL query
    // 1. FTS search on playlistz_fts MATCH query
    // 2. join to playlistz for full details
    // 3. filter by privacy: (is_public = 1 OR created_by = user_id)
    // 4. count songs in playlist via playlist_songz
    // 5. calculate confidence
    // 6. order by rank DESC
    // 7. limit and offset

    Ok(Vec::new())
}

/// count total song search results (for pagination)
async fn count_song_results(
    _pool: &SqlitePool,
    _query: &str,
    _tag_filter: Option<&FilterSet>,
    _genre_filter: Option<&FilterSet>,
    _sub_genre_filter: Option<&FilterSet>,
) -> GrimoireResult<i64> {
    // TODO: implement SQL count query
    // same filtering logic as search_songs but just COUNT(*)
    // needed for accurate pagination

    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_confidence() {
        // exact match
        assert_eq!(calculate_confidence("test", "test", -1.0), 1.0);

        // prefix match
        assert_eq!(calculate_confidence("test", "testing", -1.0), 0.9);

        // contains match
        assert_eq!(calculate_confidence("test", "atestb", -1.0), 0.7);

        // fuzzy match
        let conf = calculate_confidence("test", "something else", -0.5);
        assert!(conf >= 0.5 && conf <= 0.6);
    }

    #[test]
    fn test_user_preference_multiplier() {
        let base = 1.0;

        // ratings
        assert_eq!(apply_user_preference_multiplier(base, Some(5), false), 1.5);
        assert_eq!(apply_user_preference_multiplier(base, Some(4), false), 1.2);
        assert_eq!(apply_user_preference_multiplier(base, Some(3), false), 1.0);
        assert_eq!(apply_user_preference_multiplier(base, Some(2), false), 0.8);
        assert_eq!(apply_user_preference_multiplier(base, Some(1), false), 0.5);
        assert_eq!(apply_user_preference_multiplier(base, Some(0), false), 0.0);

        // favorite boost
        assert_eq!(apply_user_preference_multiplier(base, None, true), 1.3);

        // combined
        assert_eq!(
            apply_user_preference_multiplier(base, Some(5), true),
            1.5 * 1.3
        );
    }

    #[test]
    fn test_generate_highlight() {
        assert_eq!(
            generate_highlight("hello world", "world"),
            "hello **world**"
        );
        assert_eq!(generate_highlight("testing", "test"), "**test**ing");
        assert_eq!(generate_highlight("no match", "xyz"), "no match");
    }

    #[test]
    fn test_match_type_thresholds() {
        assert_eq!(MatchType::Title.threshold(), 0.0);
        assert_eq!(MatchType::Name.threshold(), 0.0);
        assert_eq!(MatchType::Filename.threshold(), 0.8);
        assert_eq!(MatchType::Lyrics.threshold(), 0.7);
        assert_eq!(MatchType::Metadata.threshold(), 0.8);
    }

    #[test]
    fn test_should_include_suggestion() {
        let mut suggestion = Suggestion {
            value: "test".to_string(),
            display: "test".to_string(),
            highlight: "test".to_string(),
            count: 1,
            suggestion_type: SuggestionType::Song,
            confidence: 0.9,
            metadata: Some(serde_json::json!({"match_type": "title"})),
            entity_id: "1".to_string(),
        };

        // title match with high confidence - should include
        assert!(should_include_suggestion(&suggestion));

        // filename match with low confidence - should exclude
        suggestion.confidence = 0.5;
        suggestion.metadata = Some(serde_json::json!({"match_type": "filename"}));
        assert!(!should_include_suggestion(&suggestion));

        // filename match with high confidence - should include
        suggestion.confidence = 0.85;
        assert!(should_include_suggestion(&suggestion));
    }
}
