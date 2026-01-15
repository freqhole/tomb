//! search service orchestration - main entry points for autocomplete and full search

use crate::database;
use crate::response::GrimoireResponse;
use crate::search::helpers::should_include_suggestion;
use crate::search::models::*;
use crate::search::queries::*;
use crate::search::suggestions::*;

/// get autocomplete suggestions with confidence filtering
pub async fn get_suggestions(
    req: SuggestionsRequest,
    user_id: Option<&str>,
) -> GrimoireResponse<SuggestionsResponse> {
    let start = std::time::Instant::now();
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("failed to connect to database", vec![err.into()])
        }
    };

    // build FTS query based on field
    let mut suggestions = match req.field {
        SearchField::All => {
            // query all entity types, merge and sort by confidence
            let mut all_suggestions = Vec::new();
            all_suggestions.extend(
                match get_song_suggestions(&pool, &req.partial, user_id).await {
                    Ok(s) => s,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to get song suggestions",
                            vec![e.into()],
                        )
                    }
                },
            );
            all_suggestions.extend(
                match get_artist_suggestions(&pool, &req.partial, user_id).await {
                    Ok(s) => s,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to get artist suggestions",
                            vec![e.into()],
                        )
                    }
                },
            );
            all_suggestions.extend(
                match get_album_suggestions(&pool, &req.partial, user_id).await {
                    Ok(s) => s,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to get album suggestions",
                            vec![e.into()],
                        )
                    }
                },
            );
            all_suggestions.extend(match get_genre_suggestions(&pool, &req.partial).await {
                Ok(s) => s,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to get genre suggestions",
                        vec![e.into()],
                    )
                }
            });
            all_suggestions.extend(match get_sub_genre_suggestions(&pool, &req.partial).await {
                Ok(s) => s,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to get sub-genre suggestions",
                        vec![e.into()],
                    )
                }
            });
            all_suggestions.extend(
                match get_playlist_suggestions(&pool, &req.partial, user_id).await {
                    Ok(s) => s,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to get playlist suggestions",
                            vec![e.into()],
                        )
                    }
                },
            );
            all_suggestions
        }
        SearchField::Songs => match get_song_suggestions(&pool, &req.partial, user_id).await {
            Ok(s) => s,
            Err(e) => {
                return GrimoireResponse::failure("failed to get song suggestions", vec![e.into()])
            }
        },
        SearchField::Artists => match get_artist_suggestions(&pool, &req.partial, user_id).await {
            Ok(s) => s,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to get artist suggestions",
                    vec![e.into()],
                )
            }
        },
        SearchField::Albums => match get_album_suggestions(&pool, &req.partial, user_id).await {
            Ok(s) => s,
            Err(e) => {
                return GrimoireResponse::failure("failed to get album suggestions", vec![e.into()])
            }
        },
        SearchField::Genres => {
            let mut genre_suggestions = Vec::new();
            genre_suggestions.extend(match get_genre_suggestions(&pool, &req.partial).await {
                Ok(s) => s,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to get genre suggestions",
                        vec![e.into()],
                    )
                }
            });
            genre_suggestions.extend(match get_sub_genre_suggestions(&pool, &req.partial).await {
                Ok(s) => s,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to get sub-genre suggestions",
                        vec![e.into()],
                    )
                }
            });
            genre_suggestions
        }
        SearchField::Playlists => {
            match get_playlist_suggestions(&pool, &req.partial, user_id).await {
                Ok(s) => s,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to get playlist suggestions",
                        vec![e.into()],
                    )
                }
            }
        }
    };

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

    GrimoireResponse::success(
        format!("found {} suggestion(s)", total),
        SuggestionsResponse {
            suggestions: paginated_suggestions,
            query_time_ms,
            total_count: total as u64,
            page: 1,
            page_size,
            total_pages: ((total as u32 + page_size - 1) / page_size).max(1),
            has_next: total > page_size as usize,
            has_prev: false,
        },
    )
}

/// full search with user preferences and global context
pub async fn search(req: SearchRequest, user_id: Option<&str>) -> GrimoireResponse<SearchResponse> {
    let start = std::time::Instant::now();
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(err) => {
            return GrimoireResponse::failure("failed to connect to database", vec![err.into()])
        }
    };

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
            response.songs = match search_songs(
                &pool,
                &req.query,
                user_id,
                tag_filter,
                genre_filter,
                sub_genre_filter,
                20,
                0,
            )
            .await
            {
                Ok(s) => s,
                Err(e) => {
                    return GrimoireResponse::failure("failed to search songs", vec![e.into()])
                }
            };
            response.artists = Some(
                match search_artists(&pool, &req.query, user_id, tag_filter, 10, 0).await {
                    Ok(a) => a,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to search artists",
                            vec![e.into()],
                        )
                    }
                },
            );
            response.albums = Some(
                match search_albums(
                    &pool,
                    &req.query,
                    user_id,
                    tag_filter,
                    genre_filter,
                    sub_genre_filter,
                    10,
                    0,
                )
                .await
                {
                    Ok(a) => a,
                    Err(e) => {
                        return GrimoireResponse::failure("failed to search albums", vec![e.into()])
                    }
                },
            );
            response.genres = Some(
                match search_genres(&pool, &req.query, tag_filter, 10, 0).await {
                    Ok(g) => g,
                    Err(e) => {
                        return GrimoireResponse::failure("failed to search genres", vec![e.into()])
                    }
                },
            );
            response.playlists = Some(
                match search_playlists(&pool, &req.query, user_id, tag_filter, 10, 0).await {
                    Ok(p) => p,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to search playlists",
                            vec![e.into()],
                        )
                    }
                },
            );
            response.total_count = response.songs.len() as i64;
        }
        SearchField::Songs => {
            response.songs = match search_songs(
                &pool,
                &req.query,
                user_id,
                tag_filter,
                genre_filter,
                sub_genre_filter,
                page_size,
                offset,
            )
            .await
            {
                Ok(s) => s,
                Err(e) => {
                    return GrimoireResponse::failure("failed to search songs", vec![e.into()])
                }
            };
            response.total_count = match count_song_results(
                &pool,
                &req.query,
                tag_filter,
                genre_filter,
                sub_genre_filter,
            )
            .await
            {
                Ok(c) => c,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to count song results",
                        vec![e.into()],
                    )
                }
            };
        }
        SearchField::Artists => {
            let artists =
                match search_artists(&pool, &req.query, user_id, tag_filter, page_size, offset)
                    .await
                {
                    Ok(a) => a,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to search artists",
                            vec![e.into()],
                        )
                    }
                };
            response.total_count = artists.len() as i64;
            response.artists = Some(artists);
        }
        SearchField::Albums => {
            let albums = match search_albums(
                &pool,
                &req.query,
                user_id,
                tag_filter,
                genre_filter,
                sub_genre_filter,
                page_size,
                offset,
            )
            .await
            {
                Ok(a) => a,
                Err(e) => {
                    return GrimoireResponse::failure("failed to search albums", vec![e.into()])
                }
            };
            response.total_count = albums.len() as i64;
            response.albums = Some(albums);
        }
        SearchField::Genres => {
            let genres = match search_genres(&pool, &req.query, tag_filter, page_size, offset).await
            {
                Ok(g) => g,
                Err(e) => {
                    return GrimoireResponse::failure("failed to search genres", vec![e.into()])
                }
            };
            response.total_count = genres.len() as i64;
            response.genres = Some(genres);
        }
        SearchField::Playlists => {
            let playlists =
                match search_playlists(&pool, &req.query, user_id, tag_filter, page_size, offset)
                    .await
                {
                    Ok(p) => p,
                    Err(e) => {
                        return GrimoireResponse::failure(
                            "failed to search playlists",
                            vec![e.into()],
                        )
                    }
                };
            response.total_count = playlists.len() as i64;
            response.playlists = Some(playlists);
        }
    }

    response.total_pages = ((response.total_count as u32 + page_size - 1) / page_size).max(1);
    response.has_next = page < response.total_pages;
    response.query_time_ms = start.elapsed().as_millis() as u64;

    GrimoireResponse::success(
        format!("found {} result(s)", response.total_count),
        response,
    )
}
