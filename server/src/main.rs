use axum::{extract::Extension, middleware as axum_middleware};
use clap::Parser;

use std::net::ToSocketAddrs;
use tower_sessions::{
    cookie::{time::Duration, SameSite},
    Expiry, SessionManagerLayer,
};

use grimoire::AppConfig;
use server::analytics::{analytics_middleware, security_logging};
use server::logging::{
    access_log_middleware_with_logger, AccessLogConfig, AccessLogFormat, AccessLogger,
};
use server::routes::build_routes;
use server::startup::AppState;
use server::static_filez::build_assets_fallback_service;
use server::storage::SessionStore;
use server::thumbnails::build_routes as build_thumbnail_routes;

#[macro_use]
extern crate tracing;

#[derive(Parser)]
#[command(name = "server")]
#[command(about = "WebAuthn server application")]
struct ServerArgs {
    /// Path to configuration file
    #[arg(long, short = 'c', default_value = "assets/config/config.jsonc")]
    config: String,

    /// Path to secrets configuration file
    #[arg(long, short, default_value = "assets/config/config.secrets.jsonc")]
    secrets: String,

    /// Server hostname (conflicts with --config)
    #[arg(long)]
    host: Option<String>,

    /// Server port (conflicts with --config)
    #[arg(long)]
    port: Option<u16>,
}

impl ServerArgs {
    fn validate(&self) -> Result<(), String> {
        // Only prevent mixing --host/--port with CUSTOM config files
        // Using --host/--port with default config is fine (just overrides those values)
        let using_custom_config = self.config != "assets/config/config.jsonc";
        let using_host_port = self.host.is_some() || self.port.is_some();

        if using_custom_config && using_host_port {
            return Err(
                "Cannot use --host/--port arguments together with custom --config files. \
                When using a custom config file, host and port must be specified in the config file."
                    .to_string(),
            );
        }

        Ok(())
    }
}

#[tokio::main]
async fn main() {
    // Parse command line arguments
    let args = ServerArgs::parse();

    // Validate argument combinations
    if let Err(e) = args.validate() {
        eprintln!("❌ Argument validation failed: {}", e);
        std::process::exit(1);
    }

    // Load environment variables from .env file
    if let Err(e) = dotenvy::dotenv() {
        // It's okay if .env file doesn't exist, just log it
        eprintln!("⚠️  Could not load .env file: {}", e);
    }

    // Use command line arguments for configuration paths
    let config_path = args.config;
    let secrets_path = args.secrets;

    let mut config = if std::path::Path::new(&config_path).exists() {
        let secrets_path_opt = if std::path::Path::new(&secrets_path).exists() {
            Some(&secrets_path)
        } else {
            None
        };

        match AppConfig::from_files(&config_path, secrets_path_opt) {
            Ok((config, secrets)) => {
                println!("✅ Loaded configuration from {}", config_path);
                if secrets.is_some() {
                    println!("🔐 Loaded secrets from {}", secrets_path);
                }
                config
            }
            Err(e) => {
                eprintln!(
                    "❌ Failed to load configuration from {}: {}",
                    config_path, e
                );
                eprintln!();

                // Provide specific guidance based on the error type
                let error_str = e.to_string();
                if error_str.contains("missing field") {
                    eprintln!("🔧 CONFIG ISSUE: Your config file is missing required fields.");
                    if error_str.contains("notifications") {
                        eprintln!(
                            "   The 'notifications' section is missing from your config file."
                        );
                        eprintln!("   This is a new required field for the notification system.");
                        eprintln!();
                        eprintln!("📝 To fix this, you can:");
                        eprintln!("   1. Add the missing section manually, or");
                        eprintln!("   2. Regenerate your config file:");
                        eprintln!("      cargo run --bin cli config init --force");
                        eprintln!("      (Warning: This will overwrite your existing config)");
                        eprintln!();
                        eprintln!("   3. Or copy the missing section from the default config:");
                        eprintln!(
                            "      cargo run --bin cli config init --output new-config.jsonc"
                        );
                        eprintln!(
                            "      Then copy the 'notifications' section to your existing config."
                        );
                    } else {
                        eprintln!("   Check the error message above for which field is missing.");
                        eprintln!();
                        eprintln!("📝 To fix this:");
                        eprintln!("   1. Compare with a fresh config: cargo run --bin cli config init --output example.jsonc");
                        eprintln!("   2. Or regenerate: cargo run --bin cli config init --force");
                    }
                } else if error_str.contains("unknown field") {
                    eprintln!("🔧 CONFIG ISSUE: Your config file contains unknown fields.");
                    eprintln!("   This usually happens when field names have changed.");
                    eprintln!();
                    eprintln!("📝 To fix this:");
                    eprintln!("   1. Check the field name in the error message above");
                    eprintln!(
                        "   2. Compare with current schema: cargo run --bin cli config schema"
                    );
                    eprintln!(
                        "   3. Or regenerate config: cargo run --bin cli config init --force"
                    );
                } else if error_str.contains("invalid type") {
                    eprintln!("🔧 CONFIG ISSUE: A field in your config has the wrong data type.");
                    eprintln!("   Check the error message above for the specific field and expected type.");
                    eprintln!();
                    eprintln!("📝 To fix this:");
                    eprintln!("   1. Fix the data type for the problematic field");
                    eprintln!("   2. Validate your config: cargo run --bin cli config validate");
                } else {
                    eprintln!(
                        "🔧 CONFIG ISSUE: There's a problem with your configuration file format."
                    );
                    eprintln!();
                    eprintln!("📝 To troubleshoot:");
                    eprintln!("   1. Check JSON syntax (trailing commas, quotes, brackets)");
                    eprintln!("   2. Validate your config: cargo run --bin cli config validate");
                    eprintln!(
                        "   3. Generate a fresh one: cargo run --bin cli config init --force"
                    );
                }

                eprintln!();
                eprintln!("🔄 Continuing with default configuration for now...");
                eprintln!("   Database: postgresql://postgres:postgres@localhost:5432/webauthn_db");
                eprintln!("   Server: http://localhost:8080");
                eprintln!();

                AppConfig::default()
            }
        }
    } else {
        eprintln!("⚠️  Configuration file '{}' not found", config_path);
        eprintln!();
        eprintln!("📝 To create a configuration file:");
        eprintln!("   cargo run --bin cli config init");
        eprintln!();
        eprintln!("🔄 Using default configuration for now...");
        eprintln!("   Database: postgresql://postgres:postgres@localhost:5432/webauthn_db");
        eprintln!("   Server: http://localhost:8080");
        eprintln!();
        AppConfig::default()
    };

    // Override config with command line arguments if provided
    if let Some(host) = args.host {
        config.server.host = host;
    }
    if let Some(port) = args.port {
        config.server.port = port;
    }

    // Set up logging based on config
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", &config.logging.level);
    }
    tracing_subscriber::fmt::init();

    // Validate configuration
    if let Err(e) = config.validate() {
        eprintln!("❌ Configuration validation failed: {}", e);
        eprintln!("💡 Run 'cargo run --bin cli config validate' for details");
        std::process::exit(1);
    }

    info!("🚀 Starting {} v{}", config.app.name, config.app.version);
    info!("🌍 Environment: {}", config.app.environment);

    // Create the app state with configuration
    let app_state = AppState::new(config.clone())
        .await
        .expect("Failed to initialize app state");

    // Get analytics configuration for middleware
    let analytics_config = app_state.analytics_config.clone();
    let database = app_state.database.clone();

    // Set up access logging if enabled
    let access_logger = if let Some(access_config) = &config.logging.access_log {
        if access_config.enabled {
            let format = match access_config.format.as_str() {
                "common" => AccessLogFormat::CommonLog,
                "combined" => AccessLogFormat::CombinedLog,
                "custom" => {
                    if let Some(template) = &access_config.custom_template {
                        AccessLogFormat::Custom(template.clone())
                    } else {
                        AccessLogFormat::CombinedLog
                    }
                }
                _ => AccessLogFormat::CombinedLog,
            };

            let access_log_config = AccessLogConfig {
                file_path: access_config.file_path.clone(),
                format,
                also_log_to_tracing: access_config.also_log_to_tracing,
            };

            match AccessLogger::new(access_log_config) {
                Ok(logger) => {
                    info!("📝 Access logging enabled: {}", access_config.file_path);
                    Some(logger)
                }
                Err(e) => {
                    error!("❌ Failed to initialize access logger: {}", e);
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    // Build session manager with config
    let same_site = match config.sessions.same_site.as_str() {
        "strict" => SameSite::Strict,
        "lax" => SameSite::Lax,
        "none" => SameSite::None,
        _ => SameSite::Strict,
    };

    // Handle session expiry: <= 0 means never expire, otherwise use configured value
    let session_duration = if config.sessions.max_age_seconds <= 0 {
        i64::MAX // Never expire
    } else {
        config.sessions.max_age_seconds
    };

    // Build main router with all routes
    let mut app = build_routes(&config)
        .merge(
            axum::Router::new()
                .nest("/api/thumbnails", build_thumbnail_routes())
                .with_state(app_state.clone()),
        )
        .layer(Extension(config.clone()))
        .layer(Extension(app_state.database.clone()))
        .layer(Extension(app_state.clone()))
        .layer(axum_middleware::from_fn(security_logging));

    // Add access logging middleware if enabled
    if let Some(logger) = access_logger {
        app = app.layer(axum_middleware::from_fn(access_log_middleware_with_logger(
            logger,
        )));
    }

    // Add analytics middleware if enabled
    if config.features.analytics_enabled {
        app = app
            .layer(axum_middleware::from_fn(analytics_middleware))
            .layer(Extension(analytics_config))
            .layer(Extension(database));
    }

    app = match &app_state.session_store {
        SessionStore::Memory(store) => {
            let layer = SessionManagerLayer::new(store.clone())
                .with_name("webauthnrs")
                .with_same_site(same_site)
                .with_secure(config.sessions.secure)
                .with_http_only(config.sessions.http_only)
                .with_expiry(Expiry::OnInactivity(Duration::seconds(session_duration)));
            app.merge(build_assets_fallback_service(&config))
                .layer(layer)
        }
        SessionStore::Postgres(store) => {
            let layer = SessionManagerLayer::new(store.clone())
                .with_name("webauthnrs")
                .with_same_site(same_site)
                .with_secure(config.sessions.secure)
                .with_http_only(config.sessions.http_only)
                .with_expiry(Expiry::OnInactivity(Duration::seconds(session_duration)));
            app.merge(build_assets_fallback_service(&config))
                .layer(layer)
        }
    };

    // Parse server address from config (supports both hostnames and IP addresses)
    let addr_str = format!("{}:{}", config.server.host, config.server.port);
    let addr = addr_str
        .to_socket_addrs()
        .and_then(|mut addrs| {
            addrs.next().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "No valid address")
            })
        })
        .unwrap_or_else(|_| {
            eprintln!(
                "❌ Invalid server host:port combination: {}:{}",
                config.server.host, config.server.port
            );
            std::process::exit(1);
        });

    info!("🌐 Server listening on {}", addr);
    info!("🔗 WebAuthn RP ID: {}", config.webauthn.rp_id);
    info!("🔗 WebAuthn Origin: {}", config.webauthn.rp_origin);
    info!(
        "📁 Assets directory: {}",
        config.static_files.assets_directory
    );
    info!(
        "💾 Analytics enabled: {}",
        config.features.analytics_enabled
    );
    info!("🗄️  Session storage: {:?}", config.storage.sessions);

    if config.development.auto_generate_invites && config.app.environment == "development" {
        info!("🎫 Auto-generating invite codes for development...");
        // This would be handled by the startup logic
    }

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Unable to spawn tcp listener");

    axum::serve(listener, app).await.unwrap();
}
