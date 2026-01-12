//! User service for business logic and coordination
//!
//! This module provides high-level user services that handle business logic,
//! validation, and coordination between different components of the user system.

use crate::response::GrimoireResponse;
use crate::users::models::*;
use crate::users::repository::UserRepository;
use crate::wordlist::generate_word_code;

/// Service for user-related business operations
pub struct UserService {
    repository: UserRepository,
}

impl UserService {
    /// Create a new user service instance
    pub fn new() -> Self {
        Self {
            repository: UserRepository::new(),
        }
    }

    /// Register a new user with optional invite code validation
    pub async fn register_user(&self, request: &CreateUserRequest) -> GrimoireResponse<User> {
        // Validate username
        if let Err(err) = self.validate_username(&request.username) {
            return GrimoireResponse::failure("Failed to register user", vec![err.into()]);
        }

        // Check if username already exists
        match self
            .repository
            .find_user_by_username(&request.username)
            .await
        {
            Ok(Some(_existing)) => {
                return GrimoireResponse::failure(
                    "Username already exists",
                    vec![AuthError::UserAlreadyExists {
                        username: request.username.clone(),
                    }
                    .into()],
                );
            }
            Err(err) => {
                return GrimoireResponse::failure(
                    "Failed to check username availability",
                    vec![err.into()],
                );
            }
            Ok(None) => {}
        }

        // Validate invite code if provided
        if let Some(invite_code) = &request.invite_code {
            match self.validate_invite_code(invite_code).await {
                Ok(_) => {}
                Err(err) => {
                    return GrimoireResponse::failure("Invalid invite code", vec![err.into()]);
                }
            }
        }

        // Create the user
        let user = match self.repository.create_user(request).await {
            Ok(user) => user,
            Err(err) => {
                return GrimoireResponse::failure("Failed to create user", vec![err.into()]);
            }
        };

        // Mark invite code as used if provided
        if let Some(invite_code) = &request.invite_code {
            if let Err(err) = self.repository.use_invite_code(invite_code, &user.id).await {
                return GrimoireResponse::failure(
                    "User created but failed to mark invite code as used",
                    vec![err.into()],
                );
            }
        }

        GrimoireResponse::success("User registered successfully", user)
    }

    /// Get user by ID
    pub async fn get_user(&self, user_id: &str) -> GrimoireResponse<User> {
        match self.repository.find_user_by_id(user_id).await {
            Ok(Some(user)) => GrimoireResponse::success("User found", user),
            Ok(None) => {
                GrimoireResponse::failure("User not found", vec![AuthError::UserNotFound.into()])
            }
            Err(err) => GrimoireResponse::failure("Failed to get user", vec![err.into()]),
        }
    }

    /// Get user by username
    pub async fn get_user_by_username(&self, username: &str) -> GrimoireResponse<User> {
        match self.repository.find_user_by_username(username).await {
            Ok(Some(user)) => GrimoireResponse::success("User found", user),
            Ok(None) => GrimoireResponse::failure(
                "User not found",
                vec![AuthError::UserNotFoundByUsername {
                    username: username.to_string(),
                }
                .into()],
            ),
            Err(err) => GrimoireResponse::failure("Failed to get user", vec![err.into()]),
        }
    }

    /// Get user by API key (for authentication)
    pub async fn get_user_by_api_key(&self, api_key: &str) -> GrimoireResponse<User> {
        match self.repository.find_user_by_api_key(api_key).await {
            Ok(Some(user)) => GrimoireResponse::success("User found", user),
            Ok(None) => {
                GrimoireResponse::failure("User not found", vec![AuthError::InvalidApiKey.into()])
            }
            Err(err) => GrimoireResponse::failure("Failed to get user", vec![err.into()]),
        }
    }

    /// Update user account
    pub async fn update_user(
        &self,
        user_id: &str,
        request: &UpdateUserRequest,
        requesting_user: &User,
    ) -> GrimoireResponse<User> {
        // Check permissions - only admins can change roles, users can update themselves
        if request.role.is_some() && !requesting_user.is_admin() {
            return GrimoireResponse::failure(
                "Insufficient permissions",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        // Ensure user exists
        let get_response = self.get_user(user_id).await;
        if !get_response.is_success() {
            return GrimoireResponse::failure("User not found", get_response.errors);
        }

        match self.repository.update_user(user_id, request).await {
            Ok(user) => GrimoireResponse::success("User updated successfully", user),
            Err(err) => GrimoireResponse::failure("Failed to update user", vec![err.into()]),
        }
    }

    /// Delete user account (soft delete)
    pub async fn delete_user(&self, user_id: &str, requesting_user: &User) -> GrimoireResponse<()> {
        // Only admins can delete users, or users can delete themselves
        if user_id != requesting_user.id && !requesting_user.is_admin() {
            return GrimoireResponse::failure(
                "Insufficient permissions",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        match self.repository.delete_user(user_id).await {
            Ok(_) => GrimoireResponse::success("User deleted successfully", ()),
            Err(err) => GrimoireResponse::failure("Failed to delete user", vec![err.into()]),
        }
    }

    /// List users with pagination and filtering
    pub async fn list_users(
        &self,
        params: &UserQueryParams,
        requesting_user: &User,
    ) -> GrimoireResponse<Vec<User>> {
        // Only admins can list all users
        if !requesting_user.is_admin() {
            return GrimoireResponse::failure(
                "Insufficient permissions",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        match self.repository.list_users(params).await {
            Ok(users) => GrimoireResponse::success(format!("Found {} user(s)", users.len()), users),
            Err(err) => GrimoireResponse::failure("Failed to list users", vec![err.into()]),
        }
    }

    /// Generate and create invite codes
    pub async fn generate_invite_codes(
        &self,
        request: &CreateInviteCodeRequest,
        count: u32,
        word_count: usize,
        requesting_user: &User,
    ) -> GrimoireResponse<Vec<InviteCode>> {
        // Only admins can create invite codes
        if !requesting_user.is_admin() {
            return GrimoireResponse::failure(
                "Insufficient permissions",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        let mut invite_codes = Vec::new();

        for _ in 0..count {
            // Generate word-based code
            let code_response = generate_word_code(word_count);
            let code = match code_response.data {
                Some(c) => c,
                None => {
                    return GrimoireResponse::failure(
                        "Failed to generate invite code",
                        code_response.errors,
                    );
                }
            };

            // Create invite code record in database
            let created_invite = match self.repository.create_invite_code(&code, request).await {
                Ok(invite) => invite,
                Err(err) => {
                    return GrimoireResponse::failure(
                        "Failed to create invite code",
                        vec![err.into()],
                    );
                }
            };
            invite_codes.push(created_invite);
        }

        GrimoireResponse::success(
            format!("Generated {} invite code(s)", invite_codes.len()),
            invite_codes,
        )
    }

    /// Validate an invite code (private helper)
    async fn validate_invite_code(&self, code: &str) -> AuthResult<InviteCode> {
        let invite_code = self
            .repository
            .find_invite_code(code)
            .await?
            .ok_or_else(|| AuthError::InviteCodeNotFound {
                code: code.to_string(),
            })?;

        if !invite_code.is_valid_for_use() {
            if invite_code.used_at.is_some() {
                return Err(AuthError::InviteCodeAlreadyUsed);
            }
            if invite_code.is_expired() {
                return Err(AuthError::InviteCodeExpired);
            }
            return Err(AuthError::InvalidInviteCode);
        }

        Ok(invite_code)
    }

    /// List invite codes
    pub async fn list_invite_codes(
        &self,
        active_only: bool,
        requesting_user: &User,
    ) -> GrimoireResponse<Vec<InviteCode>> {
        // Only admins can list invite codes
        if !requesting_user.is_admin() {
            return GrimoireResponse::failure(
                "Insufficient permissions",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        match self.repository.list_invite_codes(active_only).await {
            Ok(codes) => {
                GrimoireResponse::success(format!("Found {} invite code(s)", codes.len()), codes)
            }
            Err(err) => GrimoireResponse::failure("Failed to list invite codes", vec![err.into()]),
        }
    }

    /// Deactivate an invite code
    pub async fn deactivate_invite_code(
        &self,
        code: &str,
        requesting_user: &User,
    ) -> GrimoireResponse<()> {
        // Only admins can deactivate invite codes
        if !requesting_user.is_admin() {
            return GrimoireResponse::failure(
                "Insufficient permissions",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        match self.repository.deactivate_invite_code(code).await {
            Ok(_) => GrimoireResponse::success("Invite code deactivated successfully", ()),
            Err(err) => {
                GrimoireResponse::failure("Failed to deactivate invite code", vec![err.into()])
            }
        }
    }

    /// Validate username format and constraints
    fn validate_username(&self, username: &str) -> AuthResult<()> {
        if username.is_empty() {
            return Err(AuthError::InvalidUsername {
                reason: "Username cannot be empty".to_string(),
            });
        }

        if username.len() < 2 {
            return Err(AuthError::InvalidUsername {
                reason: "Username must be at least 2 characters".to_string(),
            });
        }

        if username.len() > 50 {
            return Err(AuthError::InvalidUsername {
                reason: "Username must be less than 50 characters".to_string(),
            });
        }

        // Check for valid characters (alphanumeric, underscore, hyphen)
        if !username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(AuthError::InvalidUsername {
                reason: "Username can only contain letters, numbers, underscore, and hyphen"
                    .to_string(),
            });
        }

        // Don't allow usernames that start or end with special characters
        if username.starts_with('_') || username.starts_with('-') {
            return Err(AuthError::InvalidUsername {
                reason: "Username cannot start with underscore or hyphen".to_string(),
            });
        }

        if username.ends_with('_') || username.ends_with('-') {
            return Err(AuthError::InvalidUsername {
                reason: "Username cannot end with underscore or hyphen".to_string(),
            });
        }

        Ok(())
    }
}

impl Default for UserService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_creation() {
        let _ = UserService::new();
        // Basic smoke test that service can be created
    }

    #[test]
    fn test_username_validation() {
        let service = UserService::new();

        // Valid usernames
        assert!(service.validate_username("user123").is_ok());
        assert!(service.validate_username("test_user").is_ok());
        assert!(service.validate_username("user-name").is_ok());

        // Invalid usernames
        assert!(service.validate_username("").is_err());
        assert!(service.validate_username("a").is_err());
        assert!(service.validate_username("_user").is_err());
        assert!(service.validate_username("user_").is_err());
        assert!(service.validate_username("-user").is_err());
        assert!(service.validate_username("user-").is_err());
        assert!(service.validate_username("user@name").is_err());
        assert!(service.validate_username(&"a".repeat(51)).is_err());
    }
}
