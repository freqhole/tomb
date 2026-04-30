//! embedded media http server
//!
//! a tiny axum server, intended to be spawned inside the charnel tauri app,
//! that serves blob streaming routes (audio + cover art) over `127.0.0.1`
//! with full http range request support.
//!
//! exists because tauri's `asset://` protocol doesn't work for `<audio>`
//! elements on linux webkitgtk — so the frontend talks to this loopback http
//! server instead, which the OS knows how to stream + range natively.
//!
//! security: loopback bind only. authenticates via api key (header or
//! `?api_key=` query param — query param is necessary since `<audio src>`
//! cannot set headers).

use axum::{
    extract::{Extension, Request},
    http::{HeaderName, Method},
    middleware as axum_middleware,
    middleware::Next,
    response::Response,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::{auth::middleware::AuthenticatedUser, blobs, error::ApiError};

/// info about a running media server.
///
/// dropping the handle does NOT stop the server — call [`shutdown`](Self::shutdown)
/// (or [`abort`](Self::abort) for a hard stop) explicitly.
#[derive(Debug, Clone)]
pub struct MediaServerHandle {
    /// the loopback address the server is listening on (e.g. `127.0.0.1:54321`).
    pub addr: SocketAddr,
    /// signal used to trigger graceful shutdown.
    shutdown: Arc<Notify>,
    /// handle to the background tokio task running `axum::serve`.
    task: Arc<tokio::sync::Mutex<Option<JoinHandle<()>>>>,
}

impl MediaServerHandle {
    /// base url including scheme, e.g. `http://127.0.0.1:54321`.
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// signal the server to shut down gracefully and await the background
    /// task. safe to call multiple times (subsequent calls are no-ops).
    pub async fn shutdown(&self) {
        self.shutdown.notify_waiters();
        let mut guard = self.task.lock().await;
        if let Some(task) = guard.take() {
            // ignore join errors — task may have already exited.
            let _ = task.await;
        }
    }

    /// hard-abort the background task without waiting for in-flight requests.
    pub fn abort(&self) {
        if let Ok(mut guard) = self.task.try_lock() {
            if let Some(task) = guard.as_ref() {
                task.abort();
            }
            *guard = None;
        }
    }
}

/// auth middleware for the media server.
///
/// stripped-down version of `require_auth` that skips session lookup (no
/// session layer attached) and accepts api keys from either:
/// - `Authorization: Bearer <key>` header
/// - `?api_key=<key>` query param  (needed for `<audio src>` urls)
async fn require_api_key(mut request: Request, next: Next) -> Result<Response, ApiError> {
    // try header first
    let header_key = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    // fall back to query param
    let key = header_key.or_else(|| extract_api_key_from_query(request.uri().query()));

    let Some(key) = key else {
        return Err(ApiError::Unauthorized);
    };

    let response = grimoire::users::find_user_by_api_key(&key).await;
    let Some(user) = response.data else {
        return Err(ApiError::Unauthorized);
    };

    let auth_user = AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        role: user.role,
    };
    request.extensions_mut().insert(auth_user);
    Ok(next.run(request).await)
}

fn extract_api_key_from_query(query: Option<&str>) -> Option<String> {
    let q = query?;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        let v = it.next().unwrap_or("");
        if k == "api_key" || k == "apiKey" {
            return Some(v.to_string());
        }
    }
    None
}

/// build the media server's router (blob streaming + thumbnails).
fn build_media_router() -> Router {
    // permissive CORS: this server is bound to loopback and protected by an
    // api key that's only known to processes inside this machine, so any
    // origin (tauri://localhost on macos/windows, http://tauri.localhost on
    // linux webkitgtk, etc.) that has the key is allowed. without this, the
    // webview blocks `<audio>` requests with cross-origin errors.
    //
    // we mirror the request origin (rather than using `*`) because webkit
    // treats `<audio>` requests as credentialed, and the spec forbids
    // `Access-Control-Allow-Origin: *` on credentialed responses.
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::HEAD, Method::OPTIONS])
        .allow_headers([
            HeaderName::from_static("authorization"),
            HeaderName::from_static("range"),
            HeaderName::from_static("content-type"),
        ])
        .expose_headers([
            HeaderName::from_static("content-length"),
            HeaderName::from_static("content-range"),
            HeaderName::from_static("accept-ranges"),
        ])
        .allow_credentials(true)
        .allow_origin(AllowOrigin::mirror_request());

    // blob handlers depend on `Extension(AuthenticatedUser)` which is
    // injected by the require_api_key middleware below.
    Router::new()
        .route("/api/blobs/{id}", get(blobs::stream_blob_handler))
        .route(
            "/api/blobs/{id}/thumb/{size}",
            get(blobs::blob_thumbnail_handler),
        )
        .layer(axum_middleware::from_fn(require_api_key))
        .layer(cors)
}

/// spawn an embedded media http server on `127.0.0.1:0` (random port).
///
/// returns a handle with the bound address and a graceful-shutdown trigger.
/// call [`MediaServerHandle::shutdown`] to stop it; otherwise the task runs
/// until the process exits.
pub async fn spawn_local_media_server() -> Result<MediaServerHandle, std::io::Error> {
    spawn_media_server_on("127.0.0.1:0").await
}

/// spawn the media server on a specific bind address (e.g. `127.0.0.1:0`
/// for random port, `127.0.0.1:9876` for fixed). loopback addresses only —
/// caller is responsible for not passing a public-network bind address.
pub async fn spawn_media_server_on(bind: &str) -> Result<MediaServerHandle, std::io::Error> {
    let listener = TcpListener::bind(bind).await?;
    let addr = listener.local_addr()?;
    let app = build_media_router();

    tracing::info!(%addr, "embedded media server listening");

    let shutdown = Arc::new(Notify::new());
    let shutdown_signal = shutdown.clone();
    let task = tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            shutdown_signal.notified().await;
        });
        if let Err(e) = server.await {
            tracing::error!(error = %e, "embedded media server exited with error");
        }
    });

    Ok(MediaServerHandle {
        addr,
        shutdown,
        task: Arc::new(tokio::sync::Mutex::new(Some(task))),
    })
}

// -- silence unused-import warnings on builds that don't use Extension here --
#[allow(dead_code)]
fn _force_extension_use(_: Extension<AuthenticatedUser>) {}
