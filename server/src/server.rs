//! server startup and shutdown

use std::net::SocketAddr;
use std::path::Path;

use axum::extract::Extension;
use grimoire::config::SessionCookieMode;
use http::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use http::{HeaderName, Method};
use tokio::net::TcpListener;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tower_sessions::{cookie::SameSite, Expiry, SessionManagerLayer};
use tracing::Level;

use crate::auth::dual_cookie::{main_cookie_name, DualCookieLayer};
use crate::{routes, state::AppState, ApiError};

/// start the http server
///
/// binds to the configured host:port and serves the application
pub async fn start_server(
    state: AppState,
    host: &str,
    port: u16,
    shutdown_signal: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<(), ApiError> {
    // validate app state configuration
    state
        .validate()
        .map_err(|e| ApiError::Internal(format!("invalid configuration: {}", e)))?;

    // validate static files directory if enabled
    if let Some(server_config) = &state.config.server {
        if server_config.static_files.enabled {
            let static_dir = server_config
                .static_files
                .directory
                .as_ref()
                .expect("static_files.directory must be set when static_files.enabled is true");

            let path = Path::new(static_dir);

            // require absolute path
            if !path.is_absolute() {
                panic!(
                    "static_files.directory must be an absolute path, got: {}",
                    path.display()
                );
            }

            // verify directory exists
            if !path.exists() {
                panic!("static_files.directory does not exist: {}", path.display());
            }

            // verify it's actually a directory
            if !path.is_dir() {
                panic!(
                    "static_files.directory is not a directory: {}",
                    path.display()
                );
            }

            tracing::info!("static files enabled, serving from: {}", path.display());
        }
    }

    // extract session store before building router (needs to be moved)
    let session_store = state.session_store.clone();

    // configure CORS with origin reflection
    // uses predicate to check allowed origins, reflects matching origin back (not *)
    let cors = if let Some(server_config) = &state.config.server {
        if server_config.cors.enabled {
            let allowed_origins = server_config.auth.allowed_origins.clone();
            let allow_any = server_config.auth.allows_any_origin();

            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(move |origin, _req| {
                    let origin_str = origin.to_str().unwrap_or("");
                    allow_any || allowed_origins.iter().any(|o| o == origin_str)
                }))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::PATCH,
                    Method::OPTIONS,
                ])
                .allow_headers([
                    AUTHORIZATION,
                    CONTENT_TYPE,
                    ACCEPT,
                    HeaderName::from_static("origin"),
                    HeaderName::from_static("x-requested-with"),
                ])
                .expose_headers([
                    HeaderName::from_static("content-length"),
                    HeaderName::from_static("content-range"),
                    HeaderName::from_static("accept-ranges"),
                    CONTENT_TYPE,
                    HeaderName::from_static("cache-control"),
                    HeaderName::from_static("content-disposition"),
                    HeaderName::from_static("etag"),
                ])
                .allow_credentials(true)
        } else {
            // CORS disabled - no cross-origin requests allowed
            CorsLayer::new()
        }
    } else {
        // fallback to permissive if no config (shouldn't happen)
        CorsLayer::permissive()
    };

    // configure session layer with explicit cookie settings
    let session_expiry = if let Some(server_config) = &state.config.server {
        let max_age = server_config.auth.session_max_age_seconds;
        if max_age <= 0 {
            // never expire
            Expiry::OnInactivity(tower_sessions::cookie::time::Duration::weeks(520))
        // ~10 years
        } else {
            Expiry::OnInactivity(tower_sessions::cookie::time::Duration::seconds(max_age))
        }
    } else {
        // default: 24 hours
        Expiry::OnInactivity(tower_sessions::cookie::time::Duration::hours(24))
    };

    // get server_id for cookie name scoping (prevents conflicts between instances)
    let server_id = state
        .config
        .server
        .as_ref()
        .map(|s| s.id.clone())
        .unwrap_or_else(|| "default".to_string());

    let cookie_name = main_cookie_name(&server_id);

    // determine cookie mode from config
    let cookie_mode = if let Some(server_config) = &state.config.server {
        SessionCookieMode::from_str(&server_config.auth.session_cookie_mode)
            .unwrap_or(SessionCookieMode::Auto)
    } else {
        SessionCookieMode::Auto
    };

    // configure session layer based on cookie mode
    // for "auto" mode, we use SameSite=Lax as the base and the dual cookie layer adds the secure variant
    let (use_secure, same_site) = match cookie_mode {
        SessionCookieMode::Auto => {
            // base cookie uses Lax; dual cookie layer adds the Secure variant
            (false, SameSite::Lax)
        }
        SessionCookieMode::Lax => {
            // single cookie with SameSite=Lax
            (false, SameSite::Lax)
        }
        SessionCookieMode::None => {
            // single cookie with SameSite=None + Secure (for HTTPS only)
            (true, SameSite::None)
        }
    };

    let session_layer = SessionManagerLayer::new(session_store)
        .with_name(cookie_name.clone())
        .with_secure(use_secure)
        .with_same_site(same_site)
        .with_expiry(session_expiry);
    // #TODO: nice-to-have for hardening: add .with_signed(key) to sign session cookies
    // would use tower_sessions::cookie::Key from a config secret
    // not critical since session IDs are cryptographically random and server-side stored

    tracing::info!(
        "[session] configured session layer: mode={:?}, cookie={}, secure={}, same_site={:?}, expiry={:?}",
        cookie_mode,
        cookie_name,
        use_secure,
        same_site,
        session_expiry
    );

    // build router with state
    // dual cookie layer wraps session layer so it sees Set-Cookie headers on response
    // layer order: request flows session -> dual_cookie -> handler
    //              response flows handler -> dual_cookie -> session
    // we need dual_cookie to see the cookie AFTER session_layer sets it
    let dual_cookie_enabled = cookie_mode == SessionCookieMode::Auto;
    let max_upload_bytes = state.config.media.max_fs_file_size;
    let app = routes::build_router(max_upload_bytes)
        .layer(Extension(state.clone()))
        .layer(session_layer)
        .layer(DualCookieLayer::new(&server_id, dual_cookie_enabled))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(CompressionLayer::new())
        .layer(cors)
        .with_state(state);

    // bind to address
    let addr = format!("{}:{}", host, port)
        .parse::<SocketAddr>()
        .map_err(|e| ApiError::Internal(format!("invalid address: {}", e)))?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to bind: {}", e)))?;

    tracing::info!("server listening on {}", addr);

    // serve application with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await
        .map_err(|e| ApiError::Internal(format!("server error: {}", e)))?;

    Ok(())
}
