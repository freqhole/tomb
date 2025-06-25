//! Authentication services for the client package
//!
//! This module provides high-level authentication services that wrap repository
//! operations with business logic, validation, and error handling.

use server::auth::models::{AuthError, InviteCode, User};
use server::auth::repository::AuthRepository;
use server::database::DatabaseConnection;
use std::fmt;
use thiserror::Error;
use time::OffsetDateTime;

/// Errors that can occur in auth services
#[derive(Debug, Error)]
pub enum AuthServiceError {
    #[error("User not found: {username}")]
    UserNotFound { username: String },

    #[error("Invalid code length: {0}")]
    InvalidCodeLength(String),

    #[error("Repository error: {0}")]
    Repository(#[from] AuthError),
}

/// Configuration for account link codes
#[derive(Debug, Clone)]
pub struct AccountLinkConfig {
    pub min_length: usize,
    pub max_length: usize,
    pub default_length: usize,
    pub default_expires_hours: u32,
}

impl Default for AccountLinkConfig {
    fn default() -> Self {
        Self {
            min_length: 8,
            max_length: 32,
            default_length: 12,
            default_expires_hours: 24,
        }
    }
}

/// Result of generating an account link code
#[derive(Debug, Clone)]
pub struct AccountLinkResult {
    pub user: User,
    pub invite_code: InviteCode,
    pub expires_hours: u32,
}

impl fmt::Display for AccountLinkResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "✓ Generated account link code for user '{}':",
            self.user.username
        )?;
        writeln!(f, "  Code: {}", self.invite_code.code)?;
        writeln!(f, "  Expires: {} hours from now", self.expires_hours)?;
        writeln!(f)?;
        writeln!(f, "💡 User can now register a new passkey using:")?;
        writeln!(f, "  1. Their existing username: {}", self.user.username)?;
        writeln!(f, "  2. This account link code: {}", self.invite_code.code)?;
        writeln!(
            f,
            "  3. The new passkey will be linked to their existing account"
        )?;
        writeln!(f)?;
        writeln!(f, "⚠️  Security notes:")?;
        writeln!(f, "  • This code expires in {} hours", self.expires_hours)?;
        writeln!(f, "  • It can only be used once")?;
        write!(f, "  • Share this code securely with the user")
    }
}

/// Authentication service for high-level auth operations
pub struct AuthService<'a> {
    repository: AuthRepository<'a>,
    config: AccountLinkConfig,
}

impl<'a> AuthService<'a> {
    /// Create a new AuthService
    pub fn new(db: &'a DatabaseConnection) -> Self {
        Self::with_config(db, AccountLinkConfig::default())
    }

    /// Create a new AuthService with custom configuration
    pub fn with_config(db: &'a DatabaseConnection, config: AccountLinkConfig) -> Self {
        Self {
            repository: AuthRepository::new(db),
            config,
        }
    }

    /// Generate an account link code for an existing user
    pub async fn generate_account_link_code(
        &self,
        username: &str,
        length: Option<usize>,
        expires_hours: Option<u32>,
    ) -> Result<AccountLinkResult, AuthServiceError> {
        // Use configured defaults if not specified
        let code_length = length.unwrap_or(self.config.default_length);
        let expires_hours = expires_hours.unwrap_or(self.config.default_expires_hours);

        // Validate code length
        self.validate_code_length(code_length)?;

        // Check if user exists
        let user = match self.repository.get_user_by_username(username).await? {
            Some(user) => user,
            None => {
                return Err(AuthServiceError::UserNotFound {
                    username: username.to_string(),
                });
            }
        };

        // Generate code and expiration time
        let code = self.generate_code(code_length);
        let expires_at = OffsetDateTime::now_utc() + time::Duration::hours(expires_hours as i64);

        // Create the account link code
        let invite_code = self
            .repository
            .create_account_link_code(user.id, &code, expires_at)
            .await?;

        Ok(AccountLinkResult {
            user,
            invite_code,
            expires_hours,
        })
    }

    /// Validate code length against configuration
    fn validate_code_length(&self, length: usize) -> Result<(), AuthServiceError> {
        if length < self.config.min_length {
            return Err(AuthServiceError::InvalidCodeLength(format!(
                "Code length must be at least {} characters (got {})",
                self.config.min_length, length
            )));
        }

        if length > self.config.max_length {
            return Err(AuthServiceError::InvalidCodeLength(format!(
                "Code length must be at most {} characters (got {})",
                self.config.max_length, length
            )));
        }

        Ok(())
    }

    /// Generate a random alphanumeric code of the specified length
    fn generate_code(&self, length: usize) -> String {
        use rand::Rng;
        const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ\
                                 abcdefghijklmnopqrstuvwxyz\
                                 0123456789";

        let mut rng = rand::thread_rng();
        (0..length)
            .map(|_| {
                let idx = rng.gen_range(0..CHARSET.len());
                CHARSET[idx] as char
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_code_length() {
        let config = AccountLinkConfig::default();
        let db = unsafe { std::mem::zeroed::<DatabaseConnection>() }; // Just for testing validation
        let service = AuthService::with_config(&db, config);

        // Valid length
        assert!(service.validate_code_length(12).is_ok());

        // Too short
        assert!(service.validate_code_length(5).is_err());

        // Too long
        assert!(service.validate_code_length(50).is_err());
    }

    #[test]
    fn test_generate_code() {
        let config = AccountLinkConfig::default();
        let db = unsafe { std::mem::zeroed::<DatabaseConnection>() }; // Just for testing
        let service = AuthService::with_config(&db, config);

        let code = service.generate_code(12);
        assert_eq!(code.len(), 12);
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
