//! User service for business logic and coordination
//!
//! This module provides high-level user services that handle business logic,
//! validation, and coordination between different components of the user system.

use crate::response::GrimoireResponse;
use crate::users::models::*;
use crate::users::repository::UserRepository;
use crate::wordlist::generate_word_code;
use rand::Rng;

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

    /// Bootstrap the initial root user during setup
    ///
    /// This bypasses the normal permission check that prevents creating root users
    /// through registration. Only use this during initial setup when no root user exists.
    pub async fn bootstrap_root_user(&self, username: &str) -> GrimoireResponse<User> {
        // Check if a root user already exists
        match self.repository.find_first_root_user().await {
            Ok(Some(existing)) => {
                return GrimoireResponse::failure(
                    "Root user already exists",
                    vec![AuthError::UserAlreadyExists {
                        username: existing.username,
                    }
                    .into()],
                );
            }
            Err(err) => {
                return GrimoireResponse::failure(
                    "Failed to check for existing root user",
                    vec![err.into()],
                );
            }
            Ok(None) => {}
        }

        // Validate username
        if let Err(err) = self.validate_username(username) {
            return GrimoireResponse::failure("Invalid username", vec![err.into()]);
        }

        // Check if username already exists
        match self.repository.find_user_by_username(username).await {
            Ok(Some(_)) => {
                return GrimoireResponse::failure(
                    "Username already exists",
                    vec![AuthError::UserAlreadyExists {
                        username: username.to_string(),
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

        // Create root user directly
        let request = CreateUserRequest {
            username: username.to_string(),
            role: Some(UserRole::Root),
            invite_code: None,
        };

        match self.repository.create_user(&request).await {
            Ok(user) => GrimoireResponse::success("Root user created successfully", user),
            Err(err) => GrimoireResponse::failure("Failed to create root user", vec![err.into()]),
        }
    }

    /// Register a new user with optional invite code validation
    ///
    /// If invite code is an account-link code, returns the existing user
    /// instead of creating a new one. This allows adding new auth methods
    /// (like passkeys) to existing accounts.
    pub async fn register_user(&self, request: &CreateUserRequest) -> GrimoireResponse<User> {
        // Validate invite code first if provided
        let invite_code_data = if let Some(invite_code) = &request.invite_code {
            match self.validate_invite_code(invite_code).await {
                Ok(code) => Some(code),
                Err(err) => {
                    return GrimoireResponse::failure("Invalid invite code", vec![err.into()]);
                }
            }
        } else {
            None
        };

        // Check if this is an account-link code
        if let Some(ref code) = invite_code_data {
            if code.is_account_link_code() {
                // Account-link code: return existing user instead of creating new one
                let target_user_id = match code.get_target_user_id() {
                    Some(id) => id,
                    None => {
                        return GrimoireResponse::failure(
                            "Account-link code has no target user",
                            vec![AuthError::InvalidInviteCode.into()],
                        );
                    }
                };

                // Get the existing user
                let user = match self.repository.find_user_by_id(target_user_id).await {
                    Ok(Some(user)) => user,
                    Ok(None) => {
                        return GrimoireResponse::failure(
                            "Target user not found",
                            vec![AuthError::UserNotFound.into()],
                        );
                    }
                    Err(err) => {
                        return GrimoireResponse::failure(
                            "Failed to find target user",
                            vec![err.into()],
                        );
                    }
                };

                // Mark code as used
                if let Some(invite_code) = &request.invite_code {
                    if let Err(err) = self.repository.use_invite_code(invite_code, &user.id).await {
                        return GrimoireResponse::failure(
                            "Failed to mark invite code as used",
                            vec![err.into()],
                        );
                    }
                }

                return GrimoireResponse::success("Account linked successfully", user);
            }
        }

        // Regular invite code or no invite code: create new user

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

        // Determine role from invite code
        let role_from_invite = invite_code_data.map(|c| c.grants_role);

        // Create the user - use explicit role if provided, otherwise use invite code's role
        let effective_role = request.role.or(role_from_invite);

        // Prevent creating root users through registration
        if effective_role == Some(UserRole::Root) {
            return GrimoireResponse::failure(
                "cannot register users with root role",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        let create_request = CreateUserRequest {
            username: request.username.clone(),
            role: effective_role,
            invite_code: request.invite_code.clone(),
        };
        let user = match self.repository.create_user(&create_request).await {
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

    /// Get first root user (oldest created)
    ///
    /// Used by CLI/Tauri for service operations that require a real user.
    pub async fn get_first_root_user(&self) -> GrimoireResponse<User> {
        match self.repository.find_first_root_user().await {
            Ok(Some(user)) => GrimoireResponse::success("Root user found", user),
            Ok(None) => GrimoireResponse::failure(
                "No root user exists",
                vec![AuthError::UserNotFound.into()],
            ),
            Err(err) => GrimoireResponse::failure("Failed to get root user", vec![err.into()]),
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

        // Prevent assigning root role
        if request.role == Some(UserRole::Root) {
            return GrimoireResponse::failure(
                "cannot assign root role",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        // Ensure user exists and check if they're root
        let get_response = self.get_user(user_id).await;
        match &get_response.data {
            Some(user) if user.role == UserRole::Root => {
                return GrimoireResponse::failure(
                    "cannot modify root user",
                    vec![AuthError::InsufficientPermissions.into()],
                );
            }
            None => {
                return GrimoireResponse::failure("User not found", get_response.errors);
            }
            _ => {}
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

    /// Generate and set a secure API key for a user
    ///
    /// Returns the user with the newly generated API key
    pub async fn generate_api_key(&self, user_id: &str) -> GrimoireResponse<User> {
        // Generate a secure random API key (32 bytes = 64 hex characters)
        let api_key = Self::generate_secure_api_key();

        match self.repository.set_api_key(user_id, &api_key).await {
            Ok(user) => GrimoireResponse::success("API key generated successfully", user),
            Err(err) => GrimoireResponse::failure("Failed to generate API key", vec![err.into()]),
        }
    }

    /// Revoke (clear) a user's API key
    ///
    /// Sets the API key to an empty string, effectively revoking it
    pub async fn revoke_api_key(&self, user_id: &str) -> GrimoireResponse<User> {
        match self.repository.set_api_key(user_id, "").await {
            Ok(user) => GrimoireResponse::success("API key revoked successfully", user),
            Err(err) => GrimoireResponse::failure("Failed to revoke API key", vec![err.into()]),
        }
    }

    /// Generate a cryptographically secure random API key
    ///
    /// Returns a 64-character hexadecimal string (32 bytes of entropy)
    fn generate_secure_api_key() -> String {
        let mut rng = rand::thread_rng();
        let bytes: [u8; 32] = rng.gen();
        hex::encode(bytes)
    }

    /// Ensure a user has an API key, generating one if missing
    ///
    /// Returns the user with a valid API key. If the user already has an API key,
    /// returns them unchanged. If they don't have one, generates a new key and
    /// returns the updated user.
    ///
    /// Used during federation sync to ensure federated users can authenticate
    /// for P2P proxy requests.
    pub async fn ensure_api_key(&self, user: User) -> GrimoireResponse<User> {
        // check if user already has an API key
        if user.api_key.as_ref().is_some_and(|k| !k.is_empty()) {
            return GrimoireResponse::success("user already has api key", user);
        }

        // generate and set a new API key
        let api_key = Self::generate_secure_api_key();
        match self.repository.set_api_key(&user.id, &api_key).await {
            Ok(updated_user) => {
                GrimoireResponse::success("api key generated for federated user", updated_user)
            }
            Err(err) => GrimoireResponse::failure(
                "failed to generate api key for federated user",
                vec![err.into()],
            ),
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

        // Prevent creating invite codes that grant root role
        if request.grants_role == Some(UserRole::Root) {
            return GrimoireResponse::failure(
                "cannot create invite codes that grant root role",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        // For account-link codes, verify target user exists and is not root
        if let Some(ref target_user_id) = request.link_for_user_id {
            let user_response = self.get_user(target_user_id).await;
            match &user_response.data {
                Some(user) if user.role == UserRole::Root => {
                    return GrimoireResponse::failure(
                        "cannot create account-link codes for root user",
                        vec![AuthError::InsufficientPermissions.into()],
                    );
                }
                None => {
                    return GrimoireResponse::failure(
                        "target user not found",
                        user_response.errors,
                    );
                }
                _ => {}
            }
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

    /// Check an invite code and return its data if valid (public version)
    ///
    /// This allows callers to inspect the invite code type before registration.
    /// Useful for determining if this is an account-link code.
    pub async fn check_invite_code(&self, code: &str) -> GrimoireResponse<InviteCode> {
        match self.validate_invite_code(code).await {
            Ok(invite_code) => GrimoireResponse::success("Invite code is valid", invite_code),
            Err(err) => GrimoireResponse::failure("Invalid invite code", vec![err.into()]),
        }
    }

    /// Mark an invite code as used by a specific user
    ///
    /// This is a public wrapper for the repository method, used when redeeming
    /// account-link codes outside the normal user registration flow.
    pub async fn mark_invite_used(&self, code: &str, used_by_id: &str) -> GrimoireResponse<()> {
        match self.repository.use_invite_code(code, used_by_id).await {
            Ok(()) => GrimoireResponse::success("invite code marked as used", ()),
            Err(err) => {
                GrimoireResponse::failure("failed to mark invite code as used", vec![err.into()])
            }
        }
    }

    /// Create an account-link invite code for a user (internal use only)
    ///
    /// This bypasses the normal admin authorization check and is meant for
    /// tauri setup flow where we need to create an invite code for the first
    /// admin user to authenticate the main window.
    ///
    /// WARNING: Only use this for trusted internal flows like tauri setup.
    pub async fn create_account_link_code_internal(
        &self,
        user_id: &str,
    ) -> GrimoireResponse<InviteCode> {
        // verify user exists
        let user_response = self.get_user(user_id).await;
        if user_response.data.is_none() {
            return GrimoireResponse::failure("user not found", user_response.errors);
        }

        // generate word-based code
        let code_response = generate_word_code(3);
        let code = match code_response.data {
            Some(c) => c,
            None => {
                return GrimoireResponse::failure(
                    "failed to generate invite code",
                    code_response.errors,
                );
            }
        };

        // create account-link invite code
        let request = CreateInviteCodeRequest {
            code_type: Some(InviteCodeType::AccountLink),
            link_for_user_id: Some(user_id.to_string()),
            expires_hours: Some(1), // 1 hour expiry (should be used immediately)
            grants_role: None,
        };

        match self.repository.create_invite_code(&code, &request).await {
            Ok(invite) => GrimoireResponse::success("account-link invite code created", invite),
            Err(err) => GrimoireResponse::failure("failed to create invite code", vec![err.into()]),
        }
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

    /// Update the role granted by an active invite code
    pub async fn update_invite_role(
        &self,
        code: &str,
        role: UserRole,
        requesting_user: &User,
    ) -> GrimoireResponse<()> {
        // Only admins can update invite codes
        if !requesting_user.is_admin() {
            return GrimoireResponse::failure(
                "Insufficient permissions",
                vec![AuthError::InsufficientPermissions.into()],
            );
        }

        // Cannot grant root role via invites
        if role == UserRole::Root {
            return GrimoireResponse::failure(
                "Cannot create invite codes that grant root role",
                vec![],
            );
        }

        match self.repository.update_invite_role(code, &role).await {
            Ok(_) => GrimoireResponse::success("Invite code role updated successfully", ()),
            Err(err) => {
                GrimoireResponse::failure("Failed to update invite code role", vec![err.into()])
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

    // ========================================================================
    // Federation / P2P methods
    // ========================================================================

    /// Find a user by their haruspex (Supabase) user ID
    pub async fn get_user_by_haruspex_id(&self, haruspex_user_id: &str) -> GrimoireResponse<User> {
        match self
            .repository
            .find_user_by_haruspex_id(haruspex_user_id)
            .await
        {
            Ok(Some(user)) => GrimoireResponse::success("User found", user),
            Ok(None) => {
                GrimoireResponse::failure("User not found", vec![AuthError::UserNotFound.into()])
            }
            Err(err) => GrimoireResponse::failure("Failed to find user", vec![err.into()]),
        }
    }

    /// Find a user by their iroh peer node_id
    pub async fn get_user_by_node_id(&self, node_id: &str) -> GrimoireResponse<User> {
        match self.repository.find_user_by_node_id(node_id).await {
            Ok(Some(user)) => GrimoireResponse::success("User found", user),
            Ok(None) => GrimoireResponse::failure(
                "User not found for node_id",
                vec![AuthError::UserNotFound.into()],
            ),
            Err(err) => GrimoireResponse::failure("Failed to find user", vec![err.into()]),
        }
    }

    /// Create or update a federated user from haruspex sync
    ///
    /// If a user with the haruspex_user_id already exists, updates their profile.
    /// If a deleted user with haruspex_user_id exists, restores them.
    /// If a user with the username exists but no haruspex_user_id, links them.
    /// Otherwise creates a new user.
    pub async fn sync_federated_user(
        &self,
        username: &str,
        haruspex_user_id: &str,
        role: UserRole,
        avatar_url: Option<&str>,
    ) -> GrimoireResponse<User> {
        // helper to ensure API key exists before returning
        let ensure_key = |user: User| async move { self.ensure_api_key(user).await };

        // first check if user already exists by haruspex_user_id (active users only)
        if let Ok(Some(existing)) = self
            .repository
            .find_user_by_haruspex_id(haruspex_user_id)
            .await
        {
            // user exists - update their profile (username and avatar)
            match self
                .repository
                .update_federated_user_profile(&existing.id, username, avatar_url)
                .await
            {
                Ok(user) => return ensure_key(user).await,
                Err(err) => {
                    return GrimoireResponse::failure(
                        "failed to update federated user",
                        vec![err.into()],
                    )
                }
            }
        }

        // check if there's a deleted user with this haruspex_user_id - restore them
        if let Ok(Some(deleted)) = self
            .repository
            .find_user_by_haruspex_id_include_deleted(haruspex_user_id)
            .await
        {
            // found a deleted user - restore them
            if deleted.deleted_at.is_some() {
                match self.repository.restore_user(&deleted.id).await {
                    Ok(_) => {
                        // now update their profile
                        match self
                            .repository
                            .update_federated_user_profile(&deleted.id, username, avatar_url)
                            .await
                        {
                            Ok(user) => return ensure_key(user).await,
                            Err(err) => {
                                return GrimoireResponse::failure(
                                    "failed to update restored user",
                                    vec![err.into()],
                                )
                            }
                        }
                    }
                    Err(err) => {
                        return GrimoireResponse::failure(
                            "failed to restore deleted user",
                            vec![err.into()],
                        )
                    }
                }
            }
        }

        // check if user exists by username
        match self.repository.find_user_by_username(username).await {
            Ok(Some(existing)) => {
                // user exists, link haruspex_user_id if not already set
                if existing.haruspex_user_id.is_some() {
                    // different haruspex_user_id - conflict
                    return GrimoireResponse::failure(
                        "username already exists with different haruspex identity",
                        vec![AuthError::UserAlreadyExists {
                            username: username.to_string(),
                        }
                        .into()],
                    );
                }
                // link the haruspex_user_id
                if let Err(err) = self
                    .repository
                    .set_haruspex_user_id(&existing.id, haruspex_user_id)
                    .await
                {
                    return GrimoireResponse::failure(
                        "failed to link haruspex identity",
                        vec![err.into()],
                    );
                }
                // re-fetch with updated data
                match self.repository.find_user_by_id(&existing.id).await {
                    Ok(Some(user)) => ensure_key(user).await,
                    Ok(None) => GrimoireResponse::failure(
                        "user not found after update",
                        vec![AuthError::UserNotFound.into()],
                    ),
                    Err(err) => {
                        GrimoireResponse::failure("failed to fetch updated user", vec![err.into()])
                    }
                }
            }
            Ok(None) => {
                // create new user
                match self
                    .repository
                    .create_federated_user(username, haruspex_user_id, role, avatar_url)
                    .await
                {
                    Ok(user) => ensure_key(user).await,
                    Err(err) => GrimoireResponse::failure(
                        "failed to create federated user",
                        vec![err.into()],
                    ),
                }
            }
            Err(err) => {
                GrimoireResponse::failure("failed to check existing user", vec![err.into()])
            }
        }
    }

    /// Add or update a peer node_id for a user
    pub async fn upsert_peer_node(
        &self,
        user_id: &str,
        node_id: &str,
        instance_name: Option<&str>,
    ) -> GrimoireResponse<UserPeerNode> {
        match self
            .repository
            .upsert_peer_node(user_id, node_id, instance_name)
            .await
        {
            Ok(peer_node) => GrimoireResponse::success("Peer node upserted", peer_node),
            Err(err) => GrimoireResponse::failure("Failed to upsert peer node", vec![err.into()]),
        }
    }

    /// Get all peer nodes for a user
    pub async fn get_user_peer_nodes(&self, user_id: &str) -> GrimoireResponse<Vec<UserPeerNode>> {
        match self.repository.get_user_peer_nodes(user_id).await {
            Ok(nodes) => GrimoireResponse::success("Peer nodes retrieved", nodes),
            Err(err) => GrimoireResponse::failure("Failed to get peer nodes", vec![err.into()]),
        }
    }

    /// Remove a peer node_id from a user
    pub async fn remove_peer_node(&self, user_id: &str, node_id: &str) -> GrimoireResponse<()> {
        match self.repository.remove_peer_node(user_id, node_id).await {
            Ok(()) => GrimoireResponse::success("Peer node removed", ()),
            Err(err) => GrimoireResponse::failure("Failed to remove peer node", vec![err.into()]),
        }
    }

    /// Update last_seen_at for a peer node (called on P2P connection)
    pub async fn touch_peer_node(&self, node_id: &str) -> GrimoireResponse<()> {
        match self.repository.touch_peer_node(node_id).await {
            Ok(()) => GrimoireResponse::success("Peer node touched", ()),
            Err(err) => GrimoireResponse::failure("Failed to touch peer node", vec![err.into()]),
        }
    }

    /// Get user by haruspex_user_id
    pub async fn get_by_haruspex_user_id(&self, haruspex_user_id: &str) -> GrimoireResponse<User> {
        match self
            .repository
            .find_user_by_haruspex_id(haruspex_user_id)
            .await
        {
            Ok(Some(user)) => GrimoireResponse::success("User found", user),
            Ok(None) => {
                GrimoireResponse::failure("User not found", vec![AuthError::UserNotFound.into()])
            }
            Err(err) => GrimoireResponse::failure("Failed to find user", vec![err.into()]),
        }
    }

    /// Get user by peer node_id
    pub async fn get_user_by_peer_node_id(&self, node_id: &str) -> GrimoireResponse<User> {
        match self.repository.find_user_by_node_id(node_id).await {
            Ok(Some(user)) => GrimoireResponse::success("User found", user),
            Ok(None) => GrimoireResponse::failure(
                "User not found for node_id",
                vec![AuthError::UserNotFound.into()],
            ),
            Err(err) => GrimoireResponse::failure("Failed to find user", vec![err.into()]),
        }
    }

    /// Get API key for a peer by node_id
    ///
    /// Used by federation proxy handler to authenticate requests to local server.
    /// Returns the API key if the user exists and has one, otherwise an error.
    /// If the user exists but has no API key, generates one first.
    pub async fn get_api_key_for_peer(&self, node_id: &str) -> GrimoireResponse<String> {
        // first find the user
        let user = match self.repository.find_user_by_node_id(node_id).await {
            Ok(Some(user)) => user,
            Ok(None) => {
                return GrimoireResponse::failure(
                    "peer not found",
                    vec![AuthError::UserNotFound.into()],
                );
            }
            Err(err) => {
                return GrimoireResponse::failure("failed to find peer", vec![err.into()]);
            }
        };

        // check if user has API key
        if let Some(api_key) = &user.api_key {
            if !api_key.is_empty() {
                return GrimoireResponse::success("api key found", api_key.clone());
            }
        }

        // user has no API key - generate one
        match self.ensure_api_key(user).await {
            GrimoireResponse {
                success: true,
                data: Some(updated_user),
                ..
            } => {
                if let Some(api_key) = updated_user.api_key {
                    GrimoireResponse::success("api key generated", api_key)
                } else {
                    GrimoireResponse::failure(
                        "failed to generate api key",
                        vec![AuthError::InsufficientPermissions.into()],
                    )
                }
            }
            GrimoireResponse {
                success: false,
                message,
                errors,
                ..
            } => GrimoireResponse::failure(&message, errors),
            _ => GrimoireResponse::failure(
                "unexpected error generating api key",
                vec![AuthError::InsufficientPermissions.into()],
            ),
        }
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
