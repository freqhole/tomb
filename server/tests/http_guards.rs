//! http-level guard tests for the axum server.
//!
//! runs the real router assembled from `server::routes::build_router` through
//! `tower::ServiceExt::oneshot` (no bound network port) against a freshly
//! provisioned grimoire instance (temp data dir, real migrations, real
//! users). these are characterization tests: they pin the CURRENT observed
//! behavior of `require_auth`, range-request blob streaming, webauthn
//! error paths, and admin_dispatch routing, so a later refactor can't
//! silently change any of it without a test failing.
//!
//! everything in this file shares one lazily-built app (config + db +
//! migrations + users are expensive to set up), guarded by `LazyLock` so it
//! only runs once no matter how many tests in this binary use it.

use axum::{
    body::Body,
    extract::Extension,
    http::{header, Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use reliquary::blobz::{BlobStore, NewBlobMeta, SqliteBlobStore};
use tokio::sync::OnceCell;
use tower::ServiceExt;
use tower_sessions::SessionManagerLayer;

use grimoire::media_blobz::{create_media_blob, CreateMediaBlobRequest};
use grimoire::setup::{ScanDir, SetupConfig, SetupService};
use grimoire::users::{CreateUserRequest, UserRole, UserService};

use server::state::AppState;

/// api keys for the three role tiers created once for this test binary.
struct TestUsers {
    admin_api_key: String,
    member_api_key: String,
    viewer_api_key: String,
}

/// everything a guard test needs: a fully-assembled router (no bound port,
/// used via `oneshot`) plus the credentials/fixtures tests exercise it with.
struct TestApp {
    router: Router,
    users: TestUsers,
    /// id of a real media blob (backed by a real file on disk) for the
    /// range-request test.
    blob_id: String,
    blob_bytes: Vec<u8>,
    /// id of a media blob whose bytes live only in reliquary (no
    /// `local_path`, no grimoire `blob_data` row) - exercises the
    /// path-resolving reliquary fallback in `stream_blob_handler`.
    reliquary_blob_id: String,
    reliquary_blob_bytes: Vec<u8>,
    /// keeps the temp data dir alive for the lifetime of the test binary.
    _tempdir: tempfile::TempDir,
}

static APP: OnceCell<TestApp> = OnceCell::const_new();

/// get (and, on first call, build) the shared test app. every test awaits
/// this first so setup runs exactly once regardless of test order/thread.
async fn app() -> &'static TestApp {
    APP.get_or_init(build_test_app).await
}

/// build a fresh grimoire instance (config, migrations, users) and the
/// equivalent of `server::start_server`'s router assembly, minus the parts
/// that don't matter for these tests (tcp bind, cors, compression, tracing).
async fn build_test_app() -> TestApp {
    let tempdir = tempfile::tempdir().expect("create temp dir for test grimoire instance");
    let data_dir = tempdir.path().join("data");
    let config_path = tempdir.path().join("freqhole-config.toml");

    let setup_config = SetupConfig {
        config_path,
        data_dir,
        server_name: "test-server".to_string(),
        server_port: 0,
        description: None,
        image_path: None,
        admin_username: Some("test-admin".to_string()),
        generate_api_key: true,
        generate_invite_code: false,
        ytdlp_available: false,
        fetch_music_dir: None,
        initial_scan_dirs: Vec::<ScanDir>::new(),
        allowed_origins: Some(vec!["http://localhost:1420".to_string()]),
        ffmpeg_path: None,
        ffprobe_path: None,
        ytdlp_path: None,
        server_enabled: Some(true),
        federation_enabled: Some(false),
        knocking_enabled: Some(false),
        remote_admin_enabled: Some(false),
        radio_enabled: Some(false),
        fetch_music_enabled: Some(false),
    };

    let result = SetupService::new().run_setup(setup_config).await;
    assert!(
        result.success,
        "test grimoire setup failed: {:?}",
        result.errors
    );
    let admin_api_key = result
        .api_key
        .expect("admin api key generated during setup");

    // member + viewer users - `register_user` allows `invite_code: None`,
    // the same path setup's own admin-user bootstrap above takes.
    let user_service = UserService::new();
    let member = user_service
        .register_user(&CreateUserRequest {
            username: "test-member".to_string(),
            role: Some(UserRole::Member),
            invite_code: None,
        })
        .await
        .data
        .expect("create member user");
    let member_api_key = user_service
        .generate_api_key(&member.id)
        .await
        .data
        .and_then(|u| u.api_key)
        .expect("generate member api key");

    let viewer = user_service
        .register_user(&CreateUserRequest {
            username: "test-viewer".to_string(),
            role: Some(UserRole::Viewer),
            invite_code: None,
        })
        .await
        .data
        .expect("create viewer user");
    let viewer_api_key = user_service
        .generate_api_key(&viewer.id)
        .await
        .data
        .and_then(|u| u.api_key)
        .expect("generate viewer api key");

    // a real file on disk, registered as a media blob, for the range test.
    let blob_bytes: Vec<u8> = (0u8..=255).cycle().take(4096).collect();
    let blob_path = tempdir.path().join("test-blob.bin");
    std::fs::write(&blob_path, &blob_bytes).expect("write test blob file");

    // sha256 column has a CHECK constraint (64 lowercase hex chars) - compute
    // the real hash of the test bytes rather than a placeholder string.
    let sha256 = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&blob_bytes);
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>()
    };

    let blob = create_media_blob(CreateMediaBlobRequest {
        sha256,
        size: Some(blob_bytes.len() as i64),
        mime: Some("application/octet-stream".to_string()),
        source_client_id: None,
        local_path: Some(blob_path.display().to_string()),
        filename: Some("test-blob.bin".to_string()),
        parent_blob_id: None,
        blob_type: None,
        metadata: serde_json::Value::Null,
        created_by: None,
        data: None,
        width: None,
        height: None,
        blake3: None,
        delete_duplicate_local_path: false,
    })
    .await
    .expect("create test media blob");

    let config = grimoire::config::get_config();

    // a second media_blobz row whose bytes exist ONLY in reliquary - no
    // local_path, no grimoire blob_data row - to exercise the path-based
    // reliquary fallback in `stream_blob_handler`.
    let reliquary_blob_bytes: Vec<u8> = (0u8..=255).rev().cycle().take(64).collect();
    let reliquary_sha256 = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&reliquary_blob_bytes);
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>()
    };
    let reliquary_blob = create_media_blob(CreateMediaBlobRequest {
        sha256: reliquary_sha256,
        size: Some(reliquary_blob_bytes.len() as i64),
        mime: Some("application/octet-stream".to_string()),
        source_client_id: None,
        local_path: None,
        filename: Some("reliquary-only-blob.bin".to_string()),
        parent_blob_id: None,
        blob_type: None,
        metadata: serde_json::Value::Null,
        created_by: None,
        data: None,
        width: None,
        height: None,
        blake3: None,
        delete_duplicate_local_path: false,
    })
    .await
    .expect("create reliquary-only media blob row");

    let reliquary_pool = reliquary::db::open_at(&config.reliquary_db_path())
        .await
        .expect("open reliquary database");
    let reliquary_store = SqliteBlobStore::new(reliquary_pool.clone(), &config.data_dir);
    let reliquary_record = reliquary_store
        .insert(&reliquary_blob_bytes, NewBlobMeta::default())
        .await
        .expect("insert bytes into reliquary");
    sqlx::query("UPDATE blobz SET old_grimoire_id = ? WHERE blake3 = ?")
        .bind(&reliquary_blob.id)
        .bind(&reliquary_record.blake3)
        .execute(&reliquary_pool)
        .await
        .expect("set old_grimoire_id on reliquary row");
    let session_store = grimoire::sessions::init_session_store()
        .await
        .expect("init session store");
    let state = AppState::new(config, session_store.clone());

    let max_upload_bytes = state.config.media.max_fs_file_size;
    let router = server::routes::build_router(max_upload_bytes)
        .layer(Extension(state.clone()))
        .layer(SessionManagerLayer::new(session_store))
        .with_state(state);

    TestApp {
        router,
        users: TestUsers {
            admin_api_key,
            member_api_key,
            viewer_api_key,
        },
        blob_id: blob.id,
        blob_bytes,
        reliquary_blob_id: reliquary_blob.id,
        reliquary_blob_bytes,
        _tempdir: tempdir,
    }
}

fn bearer(api_key: &str) -> String {
    format!("Bearer {}", api_key)
}

// ============================================================================
// require_auth: unauthenticated / insufficient role / sufficient role
//
// route: POST /api/taxonomy/kinds/create (RouteAuth::Role(Admin)). the
// admin-vs-viewer split is enforced by the central role check in
// grimoire's offal dispatch (not by require_auth itself, which only
// authenticates); require_auth is what turns "no credentials at all" into
// 401 before dispatch ever runs.
// ============================================================================

fn create_taxon_kind_body(slug: &str) -> String {
    serde_json::json!({ "slug": slug, "label": "test guard kind" }).to_string()
}

#[tokio::test]
async fn require_auth_rejects_unauthenticated_request() {
    let app = app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/taxonomy/kinds/create")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(create_taxon_kind_body("guard-unauth")))
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn require_auth_rejects_authenticated_insufficient_role() {
    let app = app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/taxonomy/kinds/create")
        .header(header::AUTHORIZATION, bearer(&app.users.viewer_api_key))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(create_taxon_kind_body("guard-viewer")))
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn require_auth_allows_authenticated_sufficient_role() {
    let app = app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/taxonomy/kinds/create")
        .header(header::AUTHORIZATION, bearer(&app.users.admin_api_key))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(create_taxon_kind_body("guard-admin")))
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// ============================================================================
// range requests: GET /api/blobs/{id} with a Range header
// ============================================================================

#[tokio::test]
async fn range_request_returns_partial_content_with_content_range() {
    let app = app().await;
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/blobs/{}", app.blob_id))
        .header(header::AUTHORIZATION, bearer(&app.users.member_api_key))
        .header(header::RANGE, "bytes=10-19")
        .body(Body::empty())
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);

    let content_range = resp
        .headers()
        .get(header::CONTENT_RANGE)
        .expect("Content-Range header present")
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        content_range,
        format!("bytes 10-19/{}", app.blob_bytes.len())
    );

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), &app.blob_bytes[10..20]);
}

/// a blob whose bytes live only in reliquary (no `local_path`, no grimoire
/// `blob_data` row) must still serve a real range request: `stream_blob_handler`
/// resolves reliquary's path via `get_media_blob_stream_source` and streams
/// straight from that file, rather than loading the whole blob into memory.
#[tokio::test]
async fn range_request_against_reliquary_only_blob_returns_partial_content() {
    let app = app().await;
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/blobs/{}", app.reliquary_blob_id))
        .header(header::AUTHORIZATION, bearer(&app.users.member_api_key))
        .header(header::RANGE, "bytes=2-5")
        .body(Body::empty())
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PARTIAL_CONTENT);

    let content_range = resp
        .headers()
        .get(header::CONTENT_RANGE)
        .expect("Content-Range header present")
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(
        content_range,
        format!("bytes 2-5/{}", app.reliquary_blob_bytes.len())
    );

    let body = resp.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body.as_ref(), &app.reliquary_blob_bytes[2..6]);
}

// ============================================================================
// webauthn error-path pins
// ============================================================================

const ALLOWED_ORIGIN: &str = "http://localhost:1420";

#[tokio::test]
async fn register_start_with_malformed_body_is_not_a_500() {
    let app = app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/webauthn/register/start")
        .header(header::ORIGIN, ALLOWED_ORIGIN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    // pin: an empty body fails axum's `Json<RegisterStartRequest>` extraction
    // before the handler ever runs, so this is axum's own rejection (400),
    // not grimoire's structured ApiError JSON shape - not a 500 either way.
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn login_start_for_unknown_username_is_a_structured_not_found_shaped_error() {
    let app = app().await;
    let body = serde_json::json!({ "username": "definitely-not-a-real-user" }).to_string();
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/webauthn/login/start")
        .header(header::ORIGIN, ALLOWED_ORIGIN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    // pin: the handler deliberately returns the SAME generic message for an
    // unknown username as it would for a known username with no passkeys -
    // it never reveals whether the username exists.
    assert_eq!(json["code"], "bad_request");
    assert_eq!(json["error"], "passkey authentication failed");
}

#[tokio::test]
async fn login_start_with_disallowed_origin_is_a_structured_error() {
    let app = app().await;
    let body = serde_json::json!({ "username": "whoever" }).to_string();
    let req = Request::builder()
        .method("POST")
        .uri("/api/auth/webauthn/login/start")
        .header(header::ORIGIN, "http://evil.example.com")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap();

    let resp = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["code"], "bad_request");
    assert!(
        json["error"]
            .as_str()
            .unwrap()
            .contains("not allowed for webauthn"),
        "unexpected error message: {}",
        json["error"]
    );
}

// ============================================================================
// admin_dispatch routing pin
//
// admin_dispatch (grimoire::admin_dispatch::handle) is not exposed over
// HTTP by this server's router at all - it is reached from other
// transports (tauri local commands, the iroh admin ALPN), never from
// server/src/routes.rs. this test pins its direct routing/authorization
// behavior instead of going through the http router.
// ============================================================================

#[tokio::test]
async fn admin_dispatch_routes_known_command_for_admin_caller() {
    let _app = app().await;
    let caller = grimoire::offal::Caller::new(
        "admin-dispatch-test",
        "admin-dispatch-test",
        UserRole::Admin,
    );
    let resp =
        grimoire::admin_dispatch::handle("server_info", serde_json::Value::Null, &caller).await;

    assert!(
        resp.success,
        "server_info should succeed for an admin caller"
    );
    assert!(resp.data.is_some(), "server_info should return data");
}

#[tokio::test]
async fn admin_dispatch_rejects_non_admin_caller() {
    let _app = app().await;
    let caller = grimoire::offal::Caller::new(
        "admin-dispatch-test-2",
        "admin-dispatch-test-2",
        UserRole::Viewer,
    );
    let resp =
        grimoire::admin_dispatch::handle("server_info", serde_json::Value::Null, &caller).await;

    assert!(!resp.success);
    assert_eq!(resp.errors.len(), 1);
    assert_eq!(resp.errors[0].error_type, "forbidden");
}

#[tokio::test]
async fn admin_dispatch_unknown_command_is_not_found_not_a_panic() {
    let _app = app().await;
    let caller = grimoire::offal::Caller::new(
        "admin-dispatch-test-3",
        "admin-dispatch-test-3",
        UserRole::Admin,
    );
    let resp =
        grimoire::admin_dispatch::handle("not_a_real_command", serde_json::Value::Null, &caller)
            .await;

    assert!(!resp.success);
    assert_eq!(resp.errors.len(), 1);
}
