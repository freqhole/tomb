//! Authentication services for the grimoire package
//!
//! This module provides high-level authentication services that wrap repository
//! operations with business logic, validation, and error handling.

use crate::auth::models::{AuthError, InviteCode, User, UserRole};
use crate::auth::repository::AuthRepository;
use crate::database::DatabaseConnection;
use crate::wordlist::management;
use std::fmt;
use thiserror::Error;
use time::OffsetDateTime;

/// Errors that can occur in auth services
#[derive(Debug, Error)]
pub enum AuthServiceError {
    #[error("User not found: {username}")]
    UserNotFound { username: String },

    #[error("User already exists: {username}")]
    UserAlreadyExists { username: String },

    #[error("Invalid code length: {0}")]
    InvalidCodeLength(String),

    #[error("Invalid word count: {0}")]
    InvalidWordCount(String),

    #[error("Wordlist not available: {0}")]
    WordlistNotAvailable(String),

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

/// Result of generating invite codes
#[derive(Debug, Clone)]
pub struct InviteGenerationResult {
    pub codes: Vec<InviteCode>,
    pub succeeded: usize,
    pub failed: usize,
}

/// Configuration for invite code generation
#[derive(Debug, Clone)]
pub struct InviteGenerationConfig {
    pub count: u32,
    pub length: usize,
    pub custom_codes: Option<Vec<String>>,
    pub use_random: bool,
    pub word_count: usize,
}

/// Statistics about the auth system
#[derive(Debug, Clone)]
pub struct AuthStats {
    pub total_invite_codes: usize,
    pub active_invite_codes: usize,
    pub used_invite_codes: usize,
    pub total_users: usize,
    pub admin_users: usize,
    pub member_users: usize,
}

impl fmt::Display for InviteGenerationResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "✓ Invite code generation completed:")?;
        writeln!(f, "  Successfully created: {}", self.succeeded)?;
        if self.failed > 0 {
            writeln!(f, "  Failed: {}", self.failed)?;
        }
        writeln!(f, "  Total codes: {}", self.codes.len())?;

        if !self.codes.is_empty() {
            writeln!(f)?;
            writeln!(f, "Generated codes:")?;
            for (i, code) in self.codes.iter().enumerate() {
                writeln!(f, "  {}: {}", i + 1, code.code)?;
            }
        }

        Ok(())
    }
}

impl fmt::Display for AuthStats {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "📊 Authentication System Statistics")?;
        writeln!(f)?;
        writeln!(f, "Invite Codes:")?;
        writeln!(f, "  Total: {}", self.total_invite_codes)?;
        writeln!(f, "  Active: {}", self.active_invite_codes)?;
        writeln!(f, "  Used: {}", self.used_invite_codes)?;
        writeln!(f)?;
        writeln!(f, "Users:")?;
        writeln!(f, "  Total: {}", self.total_users)?;
        writeln!(f, "  Admins: {}", self.admin_users)?;
        write!(f, "  Members: {}", self.member_users)
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

    /// Generate invite codes based on configuration
    pub async fn generate_invite_codes(
        &self,
        config: InviteGenerationConfig,
    ) -> Result<InviteGenerationResult, AuthServiceError> {
        let mut codes = Vec::new();
        let mut succeeded = 0;
        let mut failed = 0;

        // Handle custom codes if provided
        if let Some(custom_codes) = config.custom_codes {
            for code in custom_codes {
                if code.trim().is_empty() {
                    failed += 1;
                    continue;
                }

                // Validate code length
                if let Err(_) = self.validate_code_length(code.len()) {
                    failed += 1;
                    continue;
                }

                match self.repository.create_invite_code(&code).await {
                    Ok(invite_code) => {
                        codes.push(invite_code);
                        succeeded += 1;
                    }
                    Err(_) => {
                        failed += 1;
                    }
                }
            }
        } else {
            // Generate codes based on type
            for _ in 0..config.count {
                let code = if config.use_random {
                    // Validate length before generating
                    self.validate_code_length(config.length)?;
                    self.generate_code(config.length)
                } else {
                    // Generate word-based code
                    if config.word_count < 2 || config.word_count > 6 {
                        return Err(AuthServiceError::InvalidWordCount(
                            "Word count must be between 2 and 6".to_string(),
                        ));
                    }

                    if !management::is_initialized() {
                        return Err(AuthServiceError::WordlistNotAvailable(
                            "Wordlist not initialized. Run: cargo run --bin cli wordlist generate"
                                .to_string(),
                        ));
                    }

                    management::generate_word_code(config.word_count)
                        .map_err(|e| AuthServiceError::WordlistNotAvailable(e.to_string()))?
                };

                match self.repository.create_invite_code(&code).await {
                    Ok(invite_code) => {
                        codes.push(invite_code);
                        succeeded += 1;
                    }
                    Err(_) => {
                        failed += 1;
                    }
                }
            }
        }

        Ok(InviteGenerationResult {
            codes,
            succeeded,
            failed,
        })
    }

    /// Create a new admin user
    pub async fn create_admin_user(
        &self,
        username: &str,
        invite_code: Option<&str>,
    ) -> Result<User, AuthServiceError> {
        // Check if user already exists
        if let Some(_) = self.repository.get_user_by_username(username).await? {
            return Err(AuthServiceError::UserAlreadyExists {
                username: username.to_string(),
            });
        }

        let user = self
            .repository
            .create_user_with_role(username, invite_code, UserRole::Admin)
            .await?;

        Ok(user)
    }

    /// Update a user's role
    pub async fn update_user_role(
        &self,
        username: &str,
        new_role: UserRole,
    ) -> Result<(User, UserRole), AuthServiceError> {
        // Check if user exists and get current role
        let user = match self.repository.get_user_by_username(username).await? {
            Some(user) => user,
            None => {
                return Err(AuthServiceError::UserNotFound {
                    username: username.to_string(),
                });
            }
        };

        let old_role = user.role;

        if old_role == new_role {
            return Ok((user, old_role));
        }

        self.repository.update_user_role(user.id, new_role).await?;

        // Return updated user info
        let updated_user = User {
            role: new_role,
            ..user
        };

        Ok((updated_user, old_role))
    }

    /// Get authentication system statistics
    pub async fn get_auth_stats(&self) -> Result<AuthStats, AuthServiceError> {
        let invite_codes = self.repository.list_invite_codes().await?;
        let users = self.repository.list_users().await?;

        let active_invite_codes = invite_codes.iter().filter(|c| c.used_at.is_none()).count();
        let used_invite_codes = invite_codes.len() - active_invite_codes;

        let admin_users = users.iter().filter(|u| u.role == UserRole::Admin).count();
        let member_users = users.len() - admin_users;

        Ok(AuthStats {
            total_invite_codes: invite_codes.len(),
            active_invite_codes,
            used_invite_codes,
            total_users: users.len(),
            admin_users,
            member_users,
        })
    }

    /// List all invite codes, optionally filtering for active only
    pub async fn list_invite_codes(
        &self,
        active_only: bool,
    ) -> Result<Vec<InviteCode>, AuthServiceError> {
        let invite_codes = self.repository.list_invite_codes().await?;

        if active_only {
            Ok(invite_codes
                .into_iter()
                .filter(|code| code.used_at.is_none())
                .collect())
        } else {
            Ok(invite_codes)
        }
    }

    /// List all users
    pub async fn list_users(&self) -> Result<Vec<User>, AuthServiceError> {
        let users = self.repository.list_users().await?;
        Ok(users)
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
    fn test_account_link_config_default() {
        let config = AccountLinkConfig::default();
        assert_eq!(config.min_length, 8);
        assert_eq!(config.max_length, 32);
        assert_eq!(config.default_length, 12);
        assert_eq!(config.default_expires_hours, 24);
    }

    #[test]
    fn test_auth_service_error_display() {
        let error = AuthServiceError::InvalidCodeLength("too short".to_string());
        assert!(error.to_string().contains("Invalid code length"));

        let error = AuthServiceError::UserNotFound {
            username: "test_user".to_string(),
        };
        assert!(error.to_string().contains("User not found: test_user"));
    }

    #[test]
    fn test_invite_generation_config_defaults() {
        let config = InviteGenerationConfig {
            count: 5,
            length: 10,
            custom_codes: None,
            use_random: true,
            word_count: 3,
        };
        assert_eq!(config.count, 5);
        assert_eq!(config.length, 10);
        assert!(config.custom_codes.is_none());
        assert!(config.use_random);
    }
}
