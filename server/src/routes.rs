//! route composition

use axum::{
    extract::DefaultBodyLimit, middleware as axum_middleware, routing::delete, routing::get,
    routing::head, routing::post, routing::put, Router,
};
use grimoire::api_registry;

use crate::{auth, blobs, health, jobs, knock, music, state::AppState, static_files, upload};

/// build the application router
///
/// composes all route modules into a single router
/// max_upload_bytes: max body size for upload routes (from config.media.max_fs_file_size)
pub fn build_router(max_upload_bytes: u64) -> Router<AppState> {
    let routes = api_registry::all_routes_map();

    // protected routes (require authentication)
    let protected_routes = Router::new()
        .route(routes["auth"]["whoami"].path, get(auth::handlers::whoami))
        .route(routes["auth"]["logout"].path, post(auth::handlers::logout))
        .route(
            routes["auth"]["api_key_status"].path,
            get(auth::handlers::api_key_status),
        )
        .route(
            routes["auth"]["regenerate_api_key"].path,
            post(auth::handlers::regenerate_api_key),
        )
        // music routes
        .route(
            routes["music"]["suggestions"].path,
            post(music::search::suggestions_handler),
        )
        .route(
            routes["music"]["search"].path,
            post(music::search::search_handler),
        )
        .route(
            routes["music"]["list_playlists"].path,
            post(music::playlists::list_playlists),
        )
        .route(
            routes["music"]["create_playlist"].path,
            post(music::playlists::create_playlist_handler),
        )
        .route(
            routes["music"]["get_playlist_by_id"].path,
            get(music::playlists::get_playlist_by_id),
        )
        .route(
            routes["music"]["get_playlist_etag"].path,
            head(music::playlists::get_playlist_etag_handler),
        )
        .route(
            routes["music"]["update_playlist"].path,
            post(music::playlists::update_playlist_handler),
        )
        .route(
            routes["music"]["delete_playlist"].path,
            post(music::playlists::delete_playlist_handler),
        )
        .route(
            routes["music"]["add_songs_to_playlist"].path,
            post(music::playlists::add_songs_handler),
        )
        .route(
            routes["music"]["remove_songs_from_playlist"].path,
            post(music::playlists::remove_songs_handler),
        )
        .route(
            routes["music"]["reorder_playlist_songs"].path,
            post(music::playlists::reorder_songs_handler),
        )
        .route(
            routes["music"]["get_playlist_images"].path,
            get(music::playlists::get_playlist_images_handler),
        )
        .route(
            routes["music"]["query_playlist_songs"].path,
            post(music::playlists::query_playlist_songs_handler),
        )
        .route(
            routes["music"]["create_artist"].path,
            post(music::artists::create_artist_handler),
        )
        // fetch routes
        .route(
            routes["music"]["create_fetch_job"].path,
            post(music::fetch::create_fetch_job),
        )
        .route(
            routes["music"]["get_fetch_job"].path,
            get(music::fetch::get_fetch_job),
        )
        // albums routes
        .route(
            routes["music"]["query_albums"].path,
            post(music::albums::query_albums_handler),
        )
        .route(
            routes["music"]["get_album"].path,
            get(music::albums::get_album_handler),
        )
        .route(
            routes["music"]["delete_album"].path,
            axum::routing::delete(music::albums::delete_album_handler),
        )
        // artists routes
        .route(
            routes["music"]["query_artists"].path,
            post(music::artists::query_artists_handler),
        )
        .route(
            routes["music"]["get_artist"].path,
            get(music::artists::get_artist_handler),
        )
        .route(
            routes["music"]["delete_artist"].path,
            axum::routing::delete(music::artists::delete_artist_handler),
        )
        .route(
            routes["music"]["update_artist"].path,
            post(music::artists::update_artist_handler),
        )
        .route(
            routes["music"]["get_artist_images"].path,
            get(music::artists::get_artist_images_handler),
        )
        .route(
            routes["music"]["update_album"].path,
            post(music::albums::update_album_handler),
        )
        .route(
            routes["music"]["get_album_images"].path,
            get(music::albums::get_album_images_handler),
        )
        // songs routes
        .route(
            routes["music"]["query_songs"].path,
            post(music::songs::query_songs_handler),
        )
        .route(
            routes["music"]["recent_songs"].path,
            post(music::songs::recent_songs_handler),
        )
        .route(
            routes["music"]["update_songs"].path,
            post(music::songs::update_songs_handler),
        )
        .route(
            routes["music"]["delete_song"].path,
            axum::routing::delete(music::songs::delete_song_handler),
        )
        // favorites routes
        .route(
            routes["music"]["set_favorite"].path,
            post(music::favorites::set_favorite_handler),
        )
        .route(
            routes["music"]["list_favorites"].path,
            post(music::favorites::list_favorites_handler),
        )
        // ratings routes
        .route(
            routes["music"]["set_rating"].path,
            post(music::ratings::set_rating_handler),
        )
        .route(
            routes["music"]["remove_rating"].path,
            post(music::ratings::remove_rating_handler),
        )
        .route(
            routes["music"]["get_rating_stats"].path,
            post(music::ratings::get_rating_stats_handler),
        )
        // genres routes
        .route(
            routes["music"]["query_genres"].path,
            post(music::genres::query_genres_handler),
        )
        .route(
            routes["music"]["get_genre"].path,
            get(music::genres::get_genre_handler),
        )
        // jobs routes
        .route(
            routes["music"]["get_job_status"].path,
            post(jobs::get_job_status),
        )
        .route(
            routes["music"]["list_jobs"].path,
            post(jobs::list_jobs_handler),
        )
        // analytics routes
        .route(
            routes["music"]["record_play"].path,
            post(music::analytics::record_play_handler),
        )
        .route(
            routes["music"]["listening_history"].path,
            post(music::analytics::listening_history_handler),
        )
        .route(
            routes["music"]["song_analytics"].path,
            post(music::analytics::song_analytics_handler),
        )
        .route(
            routes["music"]["top_songs"].path,
            post(music::analytics::top_songs_handler),
        )
        .route(
            routes["music"]["top_albums"].path,
            post(music::analytics::top_albums_handler),
        )
        .route(
            routes["music"]["top_artists"].path,
            post(music::analytics::top_artists_handler),
        )
        .route(
            routes["music"]["activity_feed"].path,
            post(music::analytics::feed_handler),
        )
        // listen session routes
        .route(
            routes["music"]["create_listen_session"].path,
            post(music::analytics::create_listen_session_handler),
        )
        .route(
            routes["music"]["list_listen_sessions"].path,
            post(music::analytics::list_listen_sessions_handler),
        )
        .route(
            routes["music"]["get_listen_session"].path,
            get(music::analytics::get_listen_session_handler),
        )
        .route(
            routes["music"]["update_listen_session_progress"].path,
            put(music::analytics::update_listen_session_progress_handler),
        )
        .route(
            routes["music"]["update_listen_session_songs"].path,
            put(music::analytics::update_listen_session_songs_handler),
        )
        .route(
            routes["music"]["update_listen_session_status"].path,
            put(music::analytics::update_listen_session_status_handler),
        )
        .route(
            routes["music"]["delete_listen_session"].path,
            delete(music::analytics::delete_listen_session_handler),
        )
        // tags routes
        .route(
            routes["music"]["list_tags"].path,
            get(music::tags::list_tags_handler),
        )
        .route(
            routes["music"]["query_tags"].path,
            post(music::tags::query_tags_handler),
        )
        .route(
            routes["music"]["get_tag"].path,
            post(music::tags::get_tag_handler),
        )
        .route(
            routes["music"]["delete_tag"].path,
            post(music::tags::delete_tag_handler),
        )
        .route(
            routes["music"]["get_albums_tags"].path,
            post(music::tags::get_albums_tags_handler),
        )
        .route(
            routes["music"]["add_albums_tags"].path,
            post(music::tags::add_albums_tags_handler),
        )
        .route(
            routes["music"]["remove_albums_tags"].path,
            post(music::tags::remove_albums_tags_handler),
        )
        .route(
            routes["music"]["replace_albums_tags"].path,
            post(music::tags::replace_albums_tags_handler),
        )
        // musicbrainz routes
        .route(
            routes["music"]["search_musicbrainz_releases"].path,
            post(music::musicbrainz::search_releases_handler),
        )
        .route(
            routes["music"]["get_musicbrainz_release"].path,
            post(music::musicbrainz::get_release_handler),
        )
        // knock management routes (admin only)
        .route(routes["admin"]["list_knocks"].path, get(knock::list_knocks))
        .route(
            routes["admin"]["list_all_knocks"].path,
            get(knock::list_all_knocks),
        )
        .route(routes["admin"]["get_knock"].path, get(knock::get_knock))
        .route(
            routes["admin"]["accept_knock"].path,
            post(knock::accept_knock),
        )
        .route(
            routes["admin"]["reject_knock"].path,
            post(knock::reject_knock),
        )
        .route(
            routes["admin"]["delete_knock"].path,
            delete(knock::delete_knock),
        )
        // upload routes
        .route(
            routes["music"]["upload_image"].path,
            post(upload::upload_image_handler),
        )
        .route(
            routes["music"]["delete_image"].path,
            post(upload::delete_image_handler),
        )
        .route(
            routes["music"]["set_primary_image"].path,
            post(upload::set_primary_image_handler),
        )
        .route(
            routes["music"]["upload_music"].path,
            post(upload::upload_music_handler),
        )
        // use configured max file size for uploads (default axum limit is 2MB)
        .layer(DefaultBodyLimit::max(max_upload_bytes as usize))
        .layer(axum_middleware::from_fn(auth::middleware::require_auth));

    // blob streaming routes (auth required only - no origin validation for img/video/audio tags)
    let blob_routes = Router::new()
        .route(
            routes["music"]["stream_blob"].path,
            get(blobs::stream_blob_handler),
        )
        .route(
            routes["music"]["blob_metadata"].path,
            get(blobs::blob_metadata_handler),
        )
        .layer(axum_middleware::from_fn(auth::middleware::require_auth));

    // webauthn routes (feature-gated, require origin validation)
    #[cfg(feature = "webauthn")]
    let webauthn_routes = Router::new()
        .route(
            routes["auth"]["register_start"].path,
            post(auth::handlers::register_start),
        )
        .route(
            routes["auth"]["register_finish"].path,
            post(auth::handlers::register_finish),
        )
        .route(
            routes["auth"]["login_start"].path,
            post(auth::handlers::login_start),
        )
        .route(
            routes["auth"]["login_finish"].path,
            post(auth::handlers::login_finish),
        )
        .layer(axum_middleware::from_fn(auth::middleware::validate_origin));

    #[cfg(feature = "webauthn")]
    let router = Router::new()
        // truly public routes (no auth, no origin validation required)
        .route(
            routes["app"]["health_check"].path,
            get(health::health_check),
        )
        .route(routes["app"]["server_info"].path, get(health::server_info))
        .route("/api/hello/image", get(static_files::serve_server_image))
        // public knock routes (P2P only - use X-Peer-Node-Id header)
        .route(
            routes["admin"]["create_knock_public"].path,
            post(knock::create_knock_public),
        )
        .route(
            routes["admin"]["get_knock_status_public"].path,
            get(knock::get_knock_status_public),
        )
        // public routes that require origin validation
        .merge(
            Router::new()
                .route(
                    routes["auth"]["redeem_invite"].path,
                    post(auth::handlers::redeem_invite),
                )
                .layer(axum_middleware::from_fn(auth::middleware::validate_origin)),
        )
        // webauthn routes (require origin validation)
        .merge(webauthn_routes)
        // blob routes (auth only, no origin validation)
        .merge(blob_routes)
        // protected routes
        .merge(protected_routes);

    #[cfg(not(feature = "webauthn"))]
    let router = Router::new()
        // truly public routes (no auth, no origin validation required)
        .route(
            routes["app"]["health_check"].path,
            get(health::health_check),
        )
        .route(routes["app"]["server_info"].path, get(health::server_info))
        .route("/api/hello/image", get(static_files::serve_server_image))
        // public knock routes (P2P only - use X-Peer-Node-Id header)
        .route(
            routes["admin"]["create_knock_public"].path,
            post(knock::create_knock_public),
        )
        .route(
            routes["admin"]["get_knock_status_public"].path,
            get(knock::get_knock_status_public),
        )
        // public routes that require origin validation
        .merge(
            Router::new()
                .route(
                    routes["auth"]["redeem_invite"].path,
                    post(auth::handlers::redeem_invite),
                )
                .layer(axum_middleware::from_fn(auth::middleware::validate_origin)),
        )
        // blob routes (auth only, no origin validation)
        .merge(blob_routes)
        // protected routes
        .merge(protected_routes);

    router
        // TODO: add music routes
        // TODO: add blob routes
        // TODO: add health routes
        // static files (fallback - serves anything not matched above)
        .fallback(static_files::serve_static)
}
