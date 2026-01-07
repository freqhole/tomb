//! grimoire package
//!
//! sqlite-focused music library with minimal dependencies.
//! provides centralized domain logic for music metadata and blob storage.

pub mod blob_data;
pub mod cli;
pub mod config;
mod database;
pub mod error;
pub mod jobs;
pub mod maintenance;
pub mod media_blobz;
pub mod music;
pub mod thumbnails;
pub mod users;
pub mod wordlist;

// re-export only domain types, no database internals
pub use config::AppConfig;
pub use error::{GrimoireError, GrimoireResult};
pub use media_blobz::{CreateMediaBlobRequest, MediaBlob};
pub use music::{Album, Artist, Song};
pub use users::models::AuthResult;
pub use users::{
    AuthError, CreateInviteCodeRequest, CreateUserRequest, FavoriteTarget, FavoritesService,
    InviteCode, RatingTarget, RatingsService, SetFavoriteRequest, SetRatingRequest,
    UpdateUserRequest, User, UserFavorite, UserQueryParams, UserRating, UserRepository, UserRole,
    UserService, UserSession, WebAuthnCredential,
};
pub use wordlist::{
    generate_word_code, initialize_wordlist, is_initialized, WordlistConfig,
    WordlistGenerationResult, WordlistService, WordlistStats, WordlistValidationResult,
};

/// initialize grimoire - ensures databases exist and migrations are run
pub async fn init(config: &AppConfig) -> GrimoireResult<()> {
    tracing::info!("initializing grimoire");

    // ensure directories exist for database files
    config.ensure_directories()?;

    // just ensure database exists and migrations run
    // actual connections happen per-operation
    let _ = database::connect().await?;

    tracing::info!("grimoire initialized successfully");
    Ok(())
}
