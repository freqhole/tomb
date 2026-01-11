//! grimoire package
//!
//! sqlite-focused music library with minimal dependencies.
//! provides centralized domain logic for music metadata and blob storage.

pub mod analytics;
pub mod blob_data;
pub mod cli;
pub mod config;
mod database;
pub mod error;
pub mod jobs;
pub mod maintenance;
pub mod media_blobz;
pub mod music;
pub mod response;
pub mod users;
pub mod wordlist;

// re-export only domain types, no database internals
pub use analytics::{record_event, record_events_batch, MediaEvent, MediaEventType};
pub use config::{find_config, init_config, ConfigError, GrimoireConfig};
pub use error::{ErrorDetail, GrimoireError, GrimoireResult};
pub use media_blobz::{CreateMediaBlobRequest, MediaBlob};
pub use music::{Album, Artist, Song};
pub use response::GrimoireResponse;
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

/// initialize grimoire - ensures database connection works
/// config must be initialized first via init_config()
pub async fn init() -> GrimoireResult<()> {
    // ensure database exists and migrations run
    // actual connections happen per-operation
    let _ = database::connect().await?;

    Ok(())
}
