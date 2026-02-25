//! User management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::users::{
    CreateInviteCodeRequest, CreateUserRequest, InviteCodeInfoResponse, InviteCodeType,
    InviteCodesGeneratedResponse, UpdateUserRequest, User, UserCreatedResponse, UserInfoResponse,
    UserListResponse, UserQueryParams, UserRole, UserService,
};
use grimoire::wordlist::{initialize_wordlist, is_initialized, ManagementWordlistConfig};

#[derive(Subcommand)]
pub enum UserAction {
    /// Create a new user
    Create {
        #[command(flatten)]
        request: CreateUserRequest,
        /// Bootstrap mode (skip invite code check for first admin)
        #[arg(long)]
        bootstrap: bool,
    },
    /// API key management
    ApiKey {
        #[command(subcommand)]
        action: ApiKeyAction,
    },
    /// List users
    List {
        /// Filter by role
        #[arg(long)]
        role: Option<String>,
        /// Include deleted users
        #[arg(long)]
        include_deleted: bool,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Update user
    Update {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// New role
        #[arg(long)]
        role: Option<String>,
    },
    /// Delete user
    Delete {
        /// User ID
        #[arg(long)]
        user_id: String,
    },
    /// Generate invite codes
    GenerateInvites {
        /// Number of codes to generate
        #[arg(long, default_value = "1")]
        count: usize,
        /// Number of words per code
        #[arg(long, default_value = "3")]
        word_count: usize,
        /// Code type (wordlist, random, etc)
        #[arg(long)]
        code_type: Option<String>,
        /// Expiration time in hours
        #[arg(long)]
        expires_hours: Option<i64>,
        /// Role granted to users who register with this code (admin, member, viewer)
        #[arg(long)]
        role: Option<String>,
    },
    /// List invite codes
    ListInvites {
        /// Show only active codes
        #[arg(long)]
        active_only: bool,
    },
    /// Deactivate an invite code
    DeactivateInvite {
        /// Invite code
        code: String,
    },
}

#[derive(Subcommand)]
pub enum ApiKeyAction {
    /// Generate or regenerate an API key for a user
    Generate {
        /// Username to generate key for
        username: String,
    },
    /// Revoke (clear) a user's API key
    Revoke {
        /// Username to revoke key for
        username: String,
    },
    /// Show API key status for a user
    ShowStatus {
        /// Username to check
        username: String,
    },
}

/// Get the first root user for CLI authorization.
/// Returns an error if no root user exists (setup not complete).
async fn get_root_user(service: &UserService) -> Result<User, CommandOutput<serde_json::Value>> {
    let response = service.get_first_root_user().await;
    match response.data {
        Some(user) => Ok(user),
        None => Err(CommandOutput::failure(
            "No root user found - run setup first",
            response.errors,
            (),
        )),
    }
}

/// Parse role string to UserRole
fn parse_role(role_str: &str) -> UserRole {
    match role_str.to_lowercase().as_str() {
        "admin" => UserRole::Admin,
        "member" => UserRole::Member,
        _ => UserRole::Viewer,
    }
}

/// Convert any error to GrimoireError with context

/// Handle user commands
pub async fn handle_command(action: UserAction) -> CommandOutput<serde_json::Value> {
    let service = UserService::new();

    match action {
        UserAction::Create {
            mut request,
            bootstrap,
        } => {
            // Bootstrap mode: clear invite_code and ensure admin role
            if bootstrap {
                if request.role != Some(UserRole::Admin) {
                    return CommandOutput::failure(
                        "bootstrap flag can only be used with --role admin",
                        vec![],
                        (),
                    );
                }
                request.invite_code = None;
            }

            let response = service.register_user(&request).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(user) = response.data else {
                return CommandOutput::failure("No user data returned", vec![], ());
            };

            let username = user.username.clone();
            let data = UserCreatedResponse {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.created_at,
            };

            let message = format!("User created: {}", username);
            CommandOutput::success(message, data)
        }
        UserAction::List {
            role,
            include_deleted,
            limit,
            offset,
        } => {
            let user_role = role.as_deref().map(parse_role);

            let params = UserQueryParams {
                username: None,
                role: user_role,
                include_deleted: Some(include_deleted),
                limit: Some(limit as u32),
                offset: Some(offset as u32),
            };

            let admin_user = match get_root_user(&service).await {
                Ok(user) => user,
                Err(e) => return e,
            };

            let response = service.list_users(&params, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(users) = response.data else {
                return CommandOutput::failure("No users data returned", vec![], ());
            };

            let user_infos: Vec<UserInfoResponse> = users
                .iter()
                .map(|u| UserInfoResponse {
                    id: u.id.clone(),
                    username: u.username.clone(),
                    role: format!("{}", u.role),
                    deleted: u.is_deleted(),
                })
                .collect();

            let data = UserListResponse {
                total: user_infos.len(),
                users: user_infos,
            };

            let message = format!(
                "Found {} user{}",
                data.total,
                if data.total == 1 { "" } else { "s" }
            );
            CommandOutput::success(message, data)
        }
        UserAction::Update { user_id, role } => {
            let user_role = role.as_deref().map(parse_role);

            let request = UpdateUserRequest { role: user_role };

            let admin_user = match get_root_user(&service).await {
                Ok(user) => user,
                Err(e) => return e,
            };

            let response = service.update_user(&user_id, &request, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(user) = response.data else {
                return CommandOutput::failure("No user data returned", vec![], ());
            };

            let username = user.username.clone();
            let data = UserCreatedResponse {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.updated_at,
            };

            let message = format!("User updated: {}", username);
            CommandOutput::success(message, data)
        }
        UserAction::Delete { user_id } => {
            let admin_user = match get_root_user(&service).await {
                Ok(user) => user,
                Err(e) => return e,
            };

            let response = service.delete_user(&user_id, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let message = format!("User deleted: {}", user_id);
            CommandOutput::success(message, ())
        }
        UserAction::GenerateInvites {
            count,
            word_count,
            code_type,
            expires_hours,
            role,
        } => {
            // If wordlist not initialized, initialize with default config (uses grimoire config path)
            if !is_initialized() {
                let config = ManagementWordlistConfig::default();
                let response = initialize_wordlist(&config);
                if !response.success {
                    return CommandOutput::failure(response.message, response.errors, ());
                }
            }

            let invite_type = code_type
                .map(|ct| match ct.to_lowercase().as_str() {
                    "account-link" => InviteCodeType::AccountLink,
                    _ => InviteCodeType::Invite,
                })
                .unwrap_or_default();

            // prompt for role if not specified
            let grants_role = match role.as_deref().map(|r| r.to_lowercase()).as_deref() {
                Some("root") => {
                    return CommandOutput::failure(
                        "cannot create invite codes that grant root role",
                        vec![],
                        (),
                    );
                }
                Some("admin") => UserRole::Admin,
                Some("member") => UserRole::Member,
                Some("viewer") => UserRole::Viewer,
                Some(_) => UserRole::Member,
                None => {
                    // interactive prompt for role
                    use dialoguer::Select;
                    let roles = ["member", "admin", "viewer"];
                    let selection = Select::new()
                        .with_prompt("role to grant")
                        .items(&roles)
                        .default(0)
                        .interact()
                        .unwrap_or(0);
                    match roles[selection] {
                        "admin" => UserRole::Admin,
                        "viewer" => UserRole::Viewer,
                        _ => UserRole::Member,
                    }
                }
            };

            let request = CreateInviteCodeRequest {
                code_type: Some(invite_type),
                link_for_user_id: None,
                expires_hours: expires_hours.map(|h| h as u32),
                grants_role: Some(grants_role),
            };

            let admin_user = match get_root_user(&service).await {
                Ok(user) => user,
                Err(e) => return e,
            };

            let response = service
                .generate_invite_codes(&request, count as u32, word_count, &admin_user)
                .await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(codes) = response.data else {
                return CommandOutput::failure("No invite codes data returned", vec![], ());
            };

            let code_infos: Vec<InviteCodeInfoResponse> = codes
                .iter()
                .map(|c| InviteCodeInfoResponse {
                    code: c.code.clone(),
                    expires_at: c.link_expires_at,
                })
                .collect();

            let data = InviteCodesGeneratedResponse {
                count: code_infos.len(),
                codes: code_infos,
            };

            let message = format!(
                "Generated {} invite code{}",
                data.count,
                if data.count == 1 { "" } else { "s" }
            );
            CommandOutput::success(message, data)
        }
        UserAction::ListInvites { active_only } => {
            let admin_user = match get_root_user(&service).await {
                Ok(user) => user,
                Err(e) => return e,
            };

            let response = service.list_invite_codes(active_only, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(codes) = response.data else {
                return CommandOutput::failure("No invite codes data returned", vec![], ());
            };

            let message = format!(
                "Found {} invite code{}",
                codes.len(),
                if codes.len() == 1 { "" } else { "s" }
            );
            CommandOutput::success(message, codes)
        }
        UserAction::DeactivateInvite { code } => {
            let admin_user = match get_root_user(&service).await {
                Ok(user) => user,
                Err(e) => return e,
            };

            let response = service.deactivate_invite_code(&code, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let message = format!("Invite code deactivated: {}", code);
            CommandOutput::success(message, ())
        }
        UserAction::ApiKey { action } => match action {
            ApiKeyAction::Generate { username } => {
                // Find user by username
                let user_response = service.get_user_by_username(&username).await;
                if !user_response.success {
                    return CommandOutput::failure(user_response.message, user_response.errors, ());
                }

                let Some(user) = user_response.data else {
                    return CommandOutput::failure("User not found", vec![], ());
                };

                // Generate API key
                let api_key_response = service.generate_api_key(&user.id).await;
                if !api_key_response.success {
                    return CommandOutput::failure(
                        api_key_response.message,
                        api_key_response.errors,
                        (),
                    );
                }

                let Some(updated_user) = api_key_response.data else {
                    return CommandOutput::failure("No user data returned", vec![], ());
                };

                let Some(api_key) = &updated_user.api_key else {
                    return CommandOutput::failure("API key not generated", vec![], ());
                };

                let data = serde_json::json!({
                    "user_id": updated_user.id,
                    "username": updated_user.username,
                    "api_key": api_key,
                });

                let message = format!(
                    "API key generated for user: {}\n\nIMPORTANT: Save this key securely!\n\nTest with:\ncurl -H 'Authorization: Bearer {}' http://localhost:8080/auth/whoami",
                    username, api_key
                );
                CommandOutput::success(message, data)
            }
            ApiKeyAction::Revoke { username } => {
                // Find user by username
                let user_response = service.get_user_by_username(&username).await;
                if !user_response.success {
                    return CommandOutput::failure(user_response.message, user_response.errors, ());
                }

                let Some(user) = user_response.data else {
                    return CommandOutput::failure("User not found", vec![], ());
                };

                if user.api_key.is_none() {
                    return CommandOutput::failure("User does not have an API key", vec![], ());
                }

                // Revoke API key using service method
                let revoke_response = service.revoke_api_key(&user.id).await;
                if !revoke_response.success {
                    return CommandOutput::failure(
                        revoke_response.message,
                        revoke_response.errors,
                        (),
                    );
                }

                let message = format!("API key revoked for user: {}", username);
                CommandOutput::success(message, ())
            }
            ApiKeyAction::ShowStatus { username } => {
                // Find user by username
                let user_response = service.get_user_by_username(&username).await;
                if !user_response.success {
                    return CommandOutput::failure(user_response.message, user_response.errors, ());
                }

                let Some(user) = user_response.data else {
                    return CommandOutput::failure("User not found", vec![], ());
                };

                let has_key = user.api_key.is_some() && !user.api_key.as_ref().unwrap().is_empty();
                let data = serde_json::json!({
                    "user_id": user.id,
                    "username": user.username,
                    "has_api_key": has_key,
                    "api_key_preview": if has_key {
                        user.api_key.as_ref().map(|k| format!("{}...{}", &k[..8], &k[k.len()-8..]))
                    } else {
                        None
                    }
                });

                let message = if has_key {
                    format!("User {} has an active API key", username)
                } else {
                    format!("User {} does not have an API key", username)
                };
                CommandOutput::success(message, data)
            }
        },
    }
}
