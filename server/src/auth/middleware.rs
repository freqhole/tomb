use axum::{
    extract::{Extension, Request},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use grimoire::auth::{AuthError, User, UserRole};
use grimoire::AuthRepository;
use grimoire::DatabaseConnection;
use tower_sessions::Session;
use uuid::Uuid;

/// Extension type for the authenticated user
#[derive(Debug, Clone)]
pub struct AuthenticatedUser(pub User);

impl AuthenticatedUser {
    pub fn user(&self) -> &User {
        &self.0
    }

    pub fn is_admin(&self) -> bool {
        self.0.is_admin()
    }

    pub fn can_access_analytics(&self) -> bool {
        self.0.can_access_analytics()
    }
}

/// Authentication middleware that checks if user is logged in
pub async fn require_authentication(
    session: Session,
    Extension(db): Extension<DatabaseConnection>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // Get user ID from session
    let user_id = match session.get::<Uuid>("user_id").await {
        Ok(Some(user_id)) => user_id,
        Ok(None) => {
            tracing::warn!("Authentication required but no user_id in session");
            return Err(StatusCode::UNAUTHORIZED);
        }
        Err(e) => {
            tracing::error!("Failed to get user_id from session: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Get user from database
    let auth_repo = AuthRepository::new(&db);
    let user = match auth_repo.get_user_by_id(user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => {
            tracing::warn!("User {} found in session but not in database", user_id);
            // Clear the invalid session
            let _ = session.remove_value("user_id").await;
            return Err(StatusCode::UNAUTHORIZED);
        }
        Err(e) => {
            tracing::error!("Database error while getting user {}: {}", user_id, e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Add user to request extensions
    request.extensions_mut().insert(AuthenticatedUser(user));

    Ok(next.run(request).await)
}

/// Middleware that requires admin role
pub async fn require_admin(
    Extension(user): Extension<AuthenticatedUser>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if !user.is_admin() {
        tracing::warn!(
            "Admin access denied for user {} (role: {:?})",
            user.user().username,
            user.user().role
        );
        return Err(StatusCode::FORBIDDEN);
    }

    tracing::debug!("Admin access granted for user {}", user.user().username);

    // Add the AuthenticatedUser back to the request for handlers to use
    request.extensions_mut().insert(user);

    Ok(next.run(request).await)
}

/// Middleware that requires analytics access (currently admin only)
pub async fn require_analytics_access(
    Extension(user): Extension<AuthenticatedUser>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if !user.can_access_analytics() {
        tracing::warn!(
            "Analytics access denied for user {} (role: {:?})",
            user.user().username,
            user.user().role
        );
        return Err(StatusCode::FORBIDDEN);
    }

    tracing::debug!("Analytics access granted for user {}", user.user().username);
    Ok(next.run(request).await)
}

/// Helper function to extract authenticated user from request
pub fn extract_user(request: &Request) -> Result<&User, AuthError> {
    request
        .extensions()
        .get::<AuthenticatedUser>()
        .map(|auth_user| auth_user.user())
        .ok_or(AuthError::AuthenticationRequired)
}

/// Helper function to check if current user is admin
pub fn is_admin_user(request: &Request) -> bool {
    request
        .extensions()
        .get::<AuthenticatedUser>()
        .map(|auth_user| auth_user.is_admin())
        .unwrap_or(false)
}

/// Helper function to check if current user can access analytics
pub fn can_access_analytics(request: &Request) -> bool {
    request
        .extensions()
        .get::<AuthenticatedUser>()
        .map(|auth_user| auth_user.can_access_analytics())
        .unwrap_or(false)
}

/// Helper function to require user authentication from session
pub async fn require_user(session: &Session) -> Result<User, AuthError> {
    let user_id = session
        .get::<Uuid>("user_id")
        .await
        .map_err(|_| AuthError::AuthenticationRequired)?
        .ok_or(AuthError::AuthenticationRequired)?;

    // In a real implementation, we'd fetch the user from the database
    // For now, we'll create a minimal user object
    Ok(User {
        id: user_id,
        username: format!("user_{}", user_id),
        role: UserRole::Member,
        created_at: time::OffsetDateTime::now_utc(),
        invite_code_used: None,
    })
}

/// Role-based access control middleware factory
pub fn require_role(
    required_role: UserRole,
) -> impl Fn(
    Extension<AuthenticatedUser>,
    Request,
    Next,
) -> std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<Response, StatusCode>> + Send>,
> + Clone {
    move |Extension(user): Extension<AuthenticatedUser>, request: Request, next: Next| {
        let user_role = user.user().role;
        let username = user.user().username.clone();

        Box::pin(async move {
            let has_access = match required_role {
                UserRole::Admin => user_role == UserRole::Admin,
                UserRole::Member => true, // Both admin and member can access member resources
            };

            if !has_access {
                tracing::warn!(
                    "Access denied for user {} (role: {:?}, required: {:?})",
                    username,
                    user_role,
                    required_role
                );
                return Err(StatusCode::FORBIDDEN);
            }

            tracing::debug!(
                "Access granted for user {} (role: {:?})",
                username,
                user_role
            );
            Ok(next.run(request).await)
        })
    }
}

/// Error response helper for auth failures
pub fn auth_error_response(error: AuthError) -> Response {
    let (status, message) = match error {
        AuthError::AuthenticationRequired => (StatusCode::UNAUTHORIZED, "Authentication required"),
        AuthError::InsufficientPermissions => (StatusCode::FORBIDDEN, "Insufficient permissions"),
        AuthError::AdminRequired => (StatusCode::FORBIDDEN, "Admin access required"),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "Authentication error"),
    };

    (status, message).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::OffsetDateTime;

    fn create_test_user(role: UserRole) -> User {
        User {
            id: Uuid::new_v4(),
            username: "testuser".to_string(),
            role,
            created_at: OffsetDateTime::now_utc(),
            invite_code_used: None,
        }
    }

    #[test]
    fn test_authenticated_user() {
        let admin_user = create_test_user(UserRole::Admin);
        let member_user = create_test_user(UserRole::Member);

        let auth_admin = AuthenticatedUser(admin_user);
        let auth_member = AuthenticatedUser(member_user);

        assert!(auth_admin.is_admin());
        assert!(auth_admin.can_access_analytics());

        assert!(!auth_member.is_admin());
        assert!(!auth_member.can_access_analytics());
    }

    #[test]
    fn test_user_role_permissions() {
        assert!(UserRole::Admin.is_admin());
        assert!(UserRole::Admin.can_access_analytics());
        assert!(UserRole::Admin.can_manage_invites());

        assert!(!UserRole::Member.is_admin());
        assert!(!UserRole::Member.can_access_analytics());
        assert!(!UserRole::Member.can_manage_invites());
    }
}
