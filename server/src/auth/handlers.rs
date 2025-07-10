use crate::auth::{AuthRepository, UserRole};
use crate::error::WebauthnError;
use crate::startup::AppState;
use axum::{
    extract::{Extension, Json, Path, Query},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

/*
 * Webauthn RS auth handlers.
 * These files use webauthn to process the data received from each route, and are closely tied to axum
 */

// 1. Import the prelude - this contains everything needed for the server to function.
use webauthn_rs::prelude::*;

/// Helper function to get WebAuthn instance for the request origin
fn get_webauthn_for_request(
    app_state: &AppState,
    request_origin: Option<&str>,
) -> Result<Webauthn, WebauthnError> {
    // Try to get origin from request header
    let origin = if let Some(origin) = request_origin {
        origin
    } else {
        // Fallback to first configured origin or legacy single origin
        if !app_state.config.webauthn.rp_origins.is_empty() {
            &app_state.config.webauthn.rp_origins[0]
        } else {
            &app_state.config.webauthn.rp_origin
        }
    };

    app_state.create_webauthn_for_origin(origin).map_err(|e| {
        error!(
            "Failed to create WebAuthn instance for origin '{}': {}",
            origin, e
        );
        WebauthnError::InvalidRPOrigin
    })
}

#[derive(Deserialize)]
pub struct RegisterStartQuery {
    invite_code: Option<String>,
}

#[derive(Serialize)]
pub struct RegistrationResponse {
    success: bool,
    operation_type: String,
    message: String,
}

// 2. The first step a client (user) will carry out is requesting a credential to be
// registered. We need to provide a challenge for this. The work flow will be:
//
//          ┌───────────────┐     ┌───────────────┐      ┌───────────────┐
//          │ Authenticator │     │    Browser    │      │     Site      │
//          └───────────────┘     └───────────────┘      └───────────────┘
//                  │                     │                      │
//                  │                     │     1. Start Reg     │
//                  │                     │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│
//                  │                     │                      │
//                  │                     │     2. Challenge     │
//                  │                     │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
//                  │                     │                      │
//                  │  3. Select Token    │                      │
//             ─ ─ ─│◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                      │
//  4. Verify │     │                     │                      │
//                  │  4. Yield PubKey    │                      │
//            └ ─ ─▶│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶                      │
//                  │                     │                      │
//                  │                     │  5. Send Reg Opts    │
//                  │                     │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│─ ─ ─
//                  │                     │                      │     │ 5. Verify
//                  │                     │                      │         PubKey
//                  │                     │                      │◀─ ─ ┘
//                  │                     │                      │─ ─ ─
//                  │                     │                      │     │ 6. Persist
//                  │                     │                      │       Credential
//                  │                     │                      │◀─ ─ ┘
//                  │                     │                      │
//                  │                     │                      │
//
// In this step, we are responding to the start reg(istration) request, and providing
// the challenge to the browser.

pub async fn start_register(
    Extension(app_state): Extension<AppState>,
    session: Session,
    Path(username): Path<String>,
    Query(params): Query<RegisterStartQuery>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, WebauthnError> {
    info!("Start register for username: {}", username);

    let auth_repo = AuthRepository::new(&app_state.database);

    // Check if invite codes are required and validate accordingly
    let invite_code = if app_state.config.features.invite_codes_required {
        // Invite codes are required
        let invite_code_str = params
            .invite_code
            .as_ref()
            .ok_or(WebauthnError::InvalidInviteCode)?;

        let invite_code = auth_repo
            .get_invite_code(invite_code_str)
            .await
            .map_err(|_| WebauthnError::DatabaseError)?;

        match invite_code {
            Some(code) if code.is_valid_for_use() => Some(code),
            Some(_) => {
                warn!(
                    "Invite code {} is not valid for use (inactive, used, or expired)",
                    invite_code_str
                );
                return Err(WebauthnError::InvalidInviteCode);
            }
            None => {
                warn!("Invite code {} not found", invite_code_str);
                return Err(WebauthnError::InvalidInviteCode);
            }
        }
    } else {
        // Invite codes are not required
        if let Some(invite_code_str) = &params.invite_code {
            // If an invite code is provided, validate it
            let invite_code = auth_repo
                .get_invite_code(invite_code_str)
                .await
                .map_err(|_| WebauthnError::DatabaseError)?;

            match invite_code {
                Some(code) if code.is_valid_for_use() => Some(code),
                Some(_) => {
                    warn!(
                        "Invite code {} is not valid for use (inactive, used, or expired)",
                        invite_code_str
                    );
                    return Err(WebauthnError::InvalidInviteCode);
                }
                None => {
                    warn!("Invite code {} not found", invite_code_str);
                    return Err(WebauthnError::InvalidInviteCode);
                }
            }
        } else {
            None
        }
    };

    // Determine if this is account linking or new user registration
    let (user_unique_id, is_account_linking) = if let Some(ref code) = invite_code {
        if code.is_account_link_code() {
            // Account linking: validate username matches target user
            let target_user_id = code
                .get_target_user_id()
                .ok_or(WebauthnError::InvalidInviteCode)?;

            let target_user = auth_repo
                .get_user_by_id(target_user_id)
                .await
                .map_err(|_| WebauthnError::DatabaseError)?
                .ok_or(WebauthnError::UserNotFound)?;

            if target_user.username != username {
                warn!(
                    "Account link code {} is for user '{}' but registration attempted for '{}'",
                    code.code, target_user.username, username
                );
                return Err(WebauthnError::InvalidInviteCode);
            }

            info!(
                "Starting account link registration for existing user: {}",
                username
            );
            (target_user_id, true)
        } else {
            // Regular invite code: check username doesn't exist
            if auth_repo
                .get_user_by_username(&username)
                .await
                .map_err(|_| WebauthnError::DatabaseError)?
                .is_some()
            {
                return Err(WebauthnError::UserAlreadyExists);
            }

            info!("Starting new user registration for: {}", username);
            (Uuid::new_v4(), false)
        }
    } else {
        // No invite code: check username doesn't exist
        if auth_repo
            .get_user_by_username(&username)
            .await
            .map_err(|_| WebauthnError::DatabaseError)?
            .is_some()
        {
            return Err(WebauthnError::UserAlreadyExists);
        }

        info!(
            "Starting new user registration without invite code for: {}",
            username
        );
        (Uuid::new_v4(), false)
    };

    // Remove any previous registrations that may have occurred from the session.
    let _ = session.remove_value("reg_state").await;

    // Get existing credentials for this user
    let exclude_credentials = auth_repo
        .get_user_credentials(user_unique_id)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?
        .iter()
        .map(|sk| sk.cred_id().clone())
        .collect();

    // Get WebAuthn instance for the request origin
    let origin_str = headers.get("origin").and_then(|h| h.to_str().ok());
    let webauthn = get_webauthn_for_request(&app_state, origin_str)?;

    let res = match webauthn.start_passkey_registration(
        user_unique_id,
        &username,
        &username,
        Some(exclude_credentials),
    ) {
        Ok((ccr, reg_state)) => {
            // Note that due to the session store in use being a server side memory store, this is
            // safe to store the reg_state into the session since it is not client controlled and
            // not open to replay attacks. If this was a cookie store, this would be UNSAFE.
            session
                .insert(
                    "reg_state",
                    (
                        username,
                        user_unique_id,
                        reg_state,
                        invite_code.as_ref().map(|c| c.code.clone()),
                        is_account_linking,
                    ),
                )
                .await
                .expect("Failed to insert");
            info!("Registration challenge created successfully!");
            Json(ccr)
        }
        Err(e) => {
            error!("challenge_register -> {:?}", e);
            return Err(WebauthnError::Unknown);
        }
    };
    Ok(res)
}

// 3. The browser has completed its steps and the user has created a public key
// on their device. Now we have the registration options sent to us, and we need
// to verify these and persist them.

pub async fn finish_register(
    Extension(app_state): Extension<AppState>,
    session: Session,
    headers: HeaderMap,
    Json(reg): Json<RegisterPublicKeyCredential>,
) -> Result<impl IntoResponse, WebauthnError> {
    let (username, _user_unique_id, reg_state, invite_code, is_account_linking): (
        String,
        Uuid,
        PasskeyRegistration,
        Option<String>,
        bool,
    ) = match session.get("reg_state").await? {
        Some((username, user_unique_id, reg_state, invite_code, is_account_linking)) => (
            username,
            user_unique_id,
            reg_state,
            invite_code,
            is_account_linking,
        ),
        None => {
            error!("Failed to get session");
            return Err(WebauthnError::CorruptSession);
        }
    };

    let _ = session.remove_value("reg_state").await;

    // Get WebAuthn instance for the request origin
    let origin_str = headers.get("origin").and_then(|h| h.to_str().ok());
    let webauthn = get_webauthn_for_request(&app_state, origin_str)?;

    match webauthn.finish_passkey_registration(&reg, &reg_state) {
        Ok(sk) => {
            let auth_repo = AuthRepository::new(&app_state.database);

            if is_account_linking {
                // Account linking: add credential to existing user
                match invite_code {
                    Some(ref code) => {
                        match auth_repo.link_credential_to_user(code, &sk).await {
                            Ok(user) => {
                                // Set user_id in session to automatically log in the user
                                session
                                    .insert("user_id", user.id)
                                    .await
                                    .expect("Failed to insert user_id into session");

                                info!(
                                    "New credential linked to existing user {} using account link code {} and automatically logged in",
                                    username, code
                                );
                                Ok(Json(RegistrationResponse {
                                    success: true,
                                    operation_type: "account_link".to_string(),
                                    message:
                                        "Successfully added new passkey to your existing account!"
                                            .to_string(),
                                }))
                            }
                            Err(e) => {
                                error!("Failed to link credential to user: {:?}", e);
                                Err(WebauthnError::DatabaseError)
                            }
                        }
                    }
                    None => {
                        error!("Account linking attempted without invite code");
                        Err(WebauthnError::CorruptSession)
                    }
                }
            } else {
                // New user registration
                // Check if this is the first user (make them admin)
                let is_first_user = match auth_repo.list_users().await {
                    Ok(users) => users.is_empty(),
                    Err(_) => false,
                };

                let role = if is_first_user {
                    UserRole::Admin
                } else {
                    UserRole::Member
                };

                match auth_repo
                    .create_user_with_role(&username, invite_code.as_deref(), role)
                    .await
                {
                    Ok(user) => {
                        // Save the credential
                        if let Err(e) = auth_repo.save_credential(user.id, &sk).await {
                            error!("Failed to save credential: {:?}", e);
                            return Err(WebauthnError::DatabaseError);
                        }

                        // Mark the invite code as used (if one was provided)
                        if let Some(ref code) = invite_code {
                            if let Err(e) = auth_repo.use_invite_code(code, user.id).await {
                                error!("Failed to mark invite code as used: {:?}", e);
                                // Don't fail the registration for this, but log it
                            }
                        }

                        // Set user_id in session to automatically log in the user
                        session
                            .insert("user_id", user.id)
                            .await
                            .expect("Failed to insert user_id into session");

                        if let Some(ref code) = invite_code {
                            info!(
                                "User {} registered successfully with invite code {} (role: {:?}) and automatically logged in",
                                username, code, user.role
                            );
                        } else {
                            info!(
                                "User {} registered successfully without invite code (role: {:?}) and automatically logged in",
                                username, user.role
                            );
                        }
                        Ok(Json(RegistrationResponse {
                            success: true,
                            operation_type: "new_registration".to_string(),
                            message: "Successfully registered new account!".to_string(),
                        }))
                    }
                    Err(e) => {
                        error!("Failed to create user: {:?}", e);
                        Err(WebauthnError::DatabaseError)
                    }
                }
            }
        }
        Err(e) => {
            error!("finish_passkey_registration -> {:?}", e);
            Err(WebauthnError::BadRequest)
        }
    }
}

// 4. Now that our public key has been registered, we can authenticate a user and verify
// that they are the holder of that security token. The work flow is similar to registration.
//
//          ┌───────────────┐     ┌───────────────┐      ┌───────────────┐
//          │ Authenticator │     │    Browser    │      │     Site      │
//          └───────────────┘     └───────────────┘      └───────────────┘
//                  │                     │                      │
//                  │                     │     1. Start Auth    │
//                  │                     │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│
//                  │                     │                      │
//                  │                     │     2. Challenge     │
//                  │                     │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
//                  │                     │                      │
//                  │  3. Select Token    │                      │
//             ─ ─ ─│◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                      │
//  4. Verify │     │                     │                      │
//                  │    4. Yield Sig     │                      │
//            └ ─ ─▶│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶                      │
//                  │                     │    5. Send Auth      │
//                  │                     │        Opts          │
//                  │                     │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│─ ─ ─
//                  │                     │                      │     │ 5. Verify
//                  │                     │                      │          Sig
//                  │                     │                      │◀─ ─ ┘
//                  │                     │                      │
//                  │                     │                      │
//
// The user indicates the wish to start authentication and we need to provide a challenge.

pub async fn start_authentication(
    Extension(app_state): Extension<AppState>,
    session: Session,
    Path(username): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, WebauthnError> {
    info!("Start Authentication for username: {}", username);

    // Remove any previous authentication that may have occurred from the session.
    let _ = session.remove_value("auth_state").await;

    // Look up the user by username
    let auth_repo = AuthRepository::new(&app_state.database);
    let user = auth_repo
        .get_user_by_username(&username)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?
        .ok_or(WebauthnError::UserNotFound)?;

    // Get the user's credentials
    let allow_credentials = auth_repo
        .get_user_credentials(user.id)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    if allow_credentials.is_empty() {
        return Err(WebauthnError::UserHasNoCredentials);
    }

    // Get WebAuthn instance for the request origin
    let origin_str = headers.get("origin").and_then(|h| h.to_str().ok());
    let webauthn = get_webauthn_for_request(&app_state, origin_str)?;

    let res = match webauthn.start_passkey_authentication(&allow_credentials) {
        Ok((rcr, auth_state)) => {
            // Note that due to the session store in use being a server side memory store, this is
            // safe to store the auth_state into the session since it is not client controlled and
            // not open to replay attacks. If this was a cookie store, this would be UNSAFE.
            session
                .insert("auth_state", (user.id, auth_state))
                .await
                .expect("Failed to insert");
            Json(rcr)
        }
        Err(e) => {
            error!("start_passkey_authentication -> {:?}", e);
            return Err(WebauthnError::Unknown);
        }
    };
    Ok(res)
}

// 5. The browser and user have completed their part of the processing. Only in the
// case that the webauthn authenticate call returns Ok, is authentication considered
// a success. If the browser does not complete this call, or *any* error occurs,
// this is an authentication failure.

pub async fn logout(session: Session) -> Result<impl IntoResponse, WebauthnError> {
    // Remove user_id from session to log out
    let _ = session.remove_value("user_id").await;
    let _ = session.remove_value("auth_state").await;
    let _ = session.remove_value("reg_state").await;

    info!("User logged out successfully");
    Ok(StatusCode::OK)
}

/// Check authentication status
pub async fn auth_status(
    session: Session,
    Extension(app_state): Extension<AppState>,
) -> Result<impl IntoResponse, WebauthnError> {
    let user_id: Option<Uuid> = session.get("user_id").await?;

    let empty_response = serde_json::json!({
        "authenticated": false,
        "user_id": null,
        "username": null,
        "role": null
    });

    if let Some(user_id) = user_id {
        // Get user details from database
        let repository = AuthRepository::new(&app_state.database);

        match repository.get_user_by_id(user_id).await {
            Ok(Some(user)) => {
                let response = serde_json::json!({
                    "authenticated": true,
                    "user_id": user_id,
                    "username": user.username,
                    "role": user.role
                });
                Ok(Json(response))
            }
            _ => Ok(Json(empty_response)), // Ok(None) => {
                                           //     tracing::warn!("User {} found in session but not in database", user_id);
                                           //     // Clear the invalid session
                                           //     // let _ = session.remove_value("user_id").await;
                                           //     // Err(StatusCode::UNAUTHORIZED)
                                           // }
                                           // Err(e) => {
                                           //     tracing::error!("Database error while getting user {}: {}", user_id, e);
                                           //     Err(StatusCode::INTERNAL_SERVER_ERROR)
                                           // }
        }

        // match repository.get_user_by_id(user_id).await {
        //     Ok(user) => {
        //         let response = serde_json::json!({
        //             "authenticated": true,
        //             "user_id": user_id,
        //             "username": user.unwrap().username,
        //             "role": user.unwrap().role
        //         });
        //         Ok(Json(response))
        //     }
        //     Err(_) => {
        //         // User not found in database, clear session
        //         session.remove("user_id").await?;
        //         let response = serde_json::json!({
        //             "authenticated": false,
        //             "user_id": null,
        //             "username": null,
        //             "role": null
        //         });
        //         Ok(Json(response))
        //     }
        // }
    } else {
        Ok(Json(empty_response))
    }
}

pub async fn finish_authentication(
    Extension(app_state): Extension<AppState>,
    session: Session,
    headers: HeaderMap,
    Json(auth): Json<PublicKeyCredential>,
) -> Result<impl IntoResponse, WebauthnError> {
    let (user_unique_id, auth_state): (Uuid, PasskeyAuthentication) = session
        .get("auth_state")
        .await?
        .ok_or(WebauthnError::CorruptSession)?;

    let _ = session.remove_value("auth_state").await;

    // Get WebAuthn instance for the request origin
    let origin_str = headers.get("origin").and_then(|h| h.to_str().ok());
    let webauthn = get_webauthn_for_request(&app_state, origin_str)?;

    let res = match webauthn.finish_passkey_authentication(&auth, &auth_state) {
        Ok(auth_result) => {
            // Get the user's current credentials
            let auth_repo = AuthRepository::new(&app_state.database);
            let mut credentials = auth_repo
                .get_user_credentials(user_unique_id)
                .await
                .map_err(|_| WebauthnError::DatabaseError)?;

            if credentials.is_empty() {
                return Err(WebauthnError::UserHasNoCredentials);
            }

            // Update the credential counter
            for sk in credentials.iter_mut() {
                sk.update_credential(&auth_result);
                // Save the updated credential back to the database
                if let Err(e) = auth_repo.update_credential(user_unique_id, sk).await {
                    error!("Failed to update credential: {:?}", e);
                    // Don't fail authentication for this, but log it
                }
            }

            // Set user_id in session to mark user as authenticated
            session
                .insert("user_id", user_unique_id)
                .await
                .expect("Failed to insert user_id into session");

            info!("Authentication successful for user: {}", user_unique_id);
            StatusCode::OK
        }
        Err(e) => {
            error!("finish_passkey_authentication -> {:?}", e);
            StatusCode::BAD_REQUEST
        }
    };

    Ok(res)
}
