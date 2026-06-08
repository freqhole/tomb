//! authorization helper functions
//!
//! these helpers are used in route handlers to check if a user
//! has the required role or ownership to perform an action.

use crate::auth::middleware::AuthenticatedUser;
use crate::error::ApiError;
use grimoire::users::UserRole;

/// check if user has at least the required role
///
/// returns `Ok(())` if authorized, `Err(ApiError::Forbidden)` otherwise
pub fn check_role(user: &AuthenticatedUser, required: UserRole) -> Result<(), ApiError> {
    if user.role.has_privilege(required) {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

/// check if user is the owner of a resource
///
/// returns `Ok(())` if user is owner, `Err(ApiError::Forbidden)` otherwise
pub fn check_owner(user: &AuthenticatedUser, owner_id: Option<&str>) -> Result<(), ApiError> {
    match owner_id {
        Some(oid) if oid == user.user_id => Ok(()),
        _ => Err(ApiError::Forbidden),
    }
}

/// check if user is the owner OR has at least the required role
///
/// use this for resources where both owner and admins can modify
/// (e.g., playlists can be deleted by owner or admin)
pub fn check_owner_or_role(
    user: &AuthenticatedUser,
    owner_id: Option<&str>,
    required_role: UserRole,
) -> Result<(), ApiError> {
    // owner can always access
    if let Some(oid) = owner_id {
        if oid == user.user_id {
            return Ok(());
        }
    }
    // otherwise check role
    check_role(user, required_role)
}

/// shorthand for `check_owner_or_role` with Admin role
///
/// most common pattern: owner OR admin can modify
pub fn check_owner_or_admin(
    user: &AuthenticatedUser,
    owner_id: Option<&str>,
) -> Result<(), ApiError> {
    check_owner_or_role(user, owner_id, UserRole::Admin)
}
