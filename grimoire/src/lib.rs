//! grimoire package
//!
//! sqlite-focused music library with minimal dependencies.
//! provides centralized domain logic for music metadata and blob storage.
//! grimoire library
//! core business logic and database operations

pub mod analytics;
pub mod api_registry;
pub mod blob_data;
pub mod config;
pub mod database;
pub mod dbinfo;
pub mod error;
pub mod federation;
pub mod health;
pub mod jobs;
pub mod maintenance;
pub mod media_blobz;
pub mod metadata;
pub mod music;
pub mod offal;
pub mod response;
pub mod search;
pub mod sessions;
pub mod setup;
pub mod upload;
pub mod users;
pub mod wordlist;

// re-export only domain types, no database internals
pub use analytics::{record_event, record_events_batch, MediaEvent, MediaEventType};
pub use config::{
    find_config, init_config, is_config_initialized, read_config_from_file, set_config_values,
    ConfigError, GrimoireConfig,
};
pub use dbinfo::{get_database_info, test_database};
pub use error::{ErrorDetail, GrimoireError, GrimoireResult, SetupStep};
pub use health::{EmptyResponse, HealthResponse};
pub use media_blobz::{CreateMediaBlobRequest, MediaBlob};
pub use metadata::{merge_metadata, update_media_blob_metadata, update_song_metadata};
pub use music::entities::{albums::Album, artists::Artist, songs::Song};
pub use response::GrimoireResponse;
pub use search::{
    get_suggestions, search, AlbumSearchResult, ArtistSearchResult, FilterSet, GenreSearchResult,
    MatchType, PlaylistSearchResult, QueryContext, SearchField, SearchRequest, SearchResponse,
    SongSearchResult, SortDirection, Suggestion, SuggestionType, SuggestionsRequest,
    SuggestionsResponse,
};
pub use users::models::AuthResult;
pub use users::{
    AuthError, CreateInviteCodeRequest, CreateUserRequest, FavoriteTarget, FavoritesService,
    InviteCode, RatingTarget, RatingsService, SetFavoriteRequest, SetRatingRequest,
    UpdateUserRequest, User, UserFavorite, UserQueryParams, UserRating, UserRole, UserService,
    UserSession, WebAuthnCredential,
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

// custom zod schema implementations for types that need special handling
use std::ops::{Deref, DerefMut};
use zod_gen::ZodSchema;

/// newtype wrapper for binary data - allows implementing ZodSchema
/// use this instead of Vec<u8> in API types
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Bytes(pub Vec<u8>);

impl ZodSchema for Bytes {
    fn zod_schema() -> String {
        "z.never()".to_string()
    }
}

impl From<Vec<u8>> for Bytes {
    fn from(v: Vec<u8>) -> Self {
        Bytes(v)
    }
}

impl From<Bytes> for Vec<u8> {
    fn from(b: Bytes) -> Self {
        b.0
    }
}

impl AsRef<[u8]> for Bytes {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl Deref for Bytes {
    type Target = Vec<u8>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for Bytes {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

/// wrapper for Vec<T> that can be decoded from JSON columns and implements ZodSchema
/// use this instead of sqlx::types::Json<Vec<T>> in API types
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonVec<T>(pub Vec<T>);

impl<T: ZodSchema> ZodSchema for JsonVec<T> {
    fn zod_schema() -> String {
        format!("z.array({})", T::zod_schema())
    }
}

impl<T: serde::Serialize> serde::Serialize for JsonVec<T> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.0.serialize(serializer)
    }
}

impl<'de, T: serde::Deserialize<'de>> serde::Deserialize<'de> for JsonVec<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Vec::<T>::deserialize(deserializer).map(JsonVec)
    }
}

impl<T> sqlx::Type<sqlx::Sqlite> for JsonVec<T> {
    fn type_info() -> sqlx::sqlite::SqliteTypeInfo {
        <sqlx::types::Json<Vec<T>> as sqlx::Type<sqlx::Sqlite>>::type_info()
    }
}

impl<'r, T> sqlx::Decode<'r, sqlx::Sqlite> for JsonVec<T>
where
    T: serde::Deserialize<'r> + 'r,
{
    fn decode(
        value: sqlx::sqlite::SqliteValueRef<'r>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let json = <sqlx::types::Json<Vec<T>> as sqlx::Decode<sqlx::Sqlite>>::decode(value)?;
        Ok(JsonVec(json.0))
    }
}

impl<T> Deref for JsonVec<T> {
    type Target = Vec<T>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<T> DerefMut for JsonVec<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl<T> From<Vec<T>> for JsonVec<T> {
    fn from(vec: Vec<T>) -> Self {
        JsonVec(vec)
    }
}

impl<T> From<JsonVec<T>> for Vec<T> {
    fn from(json_vec: JsonVec<T>) -> Self {
        json_vec.0
    }
}
