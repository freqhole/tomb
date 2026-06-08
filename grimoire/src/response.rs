//! Response types for grimoire public API
//!
//! All public API functions return `GrimoireResponse<T>` for consistency.
//! This provides a uniform structure for success/failure with structured errors.

use crate::error::ErrorDetail;
use serde::Serialize;

/// Standard response type for all public API functions
///
/// Provides consistent structure for success and failure cases with
/// human-readable messages and structured error details.
///
/// # Examples
///
/// ```
/// use grimoire::response::GrimoireResponse;
///
/// // Success case
/// let response = GrimoireResponse::success("User created", user_data);
///
/// // Failure case
/// let response = GrimoireResponse::failure("Failed to create user", vec![error.into()]);
/// ```
#[derive(Debug, Clone, Serialize)]
pub struct GrimoireResponse<T> {
    /// Operation success status
    pub success: bool,
    /// Human-readable message describing the result
    pub message: String,
    /// Result data (None on failure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    /// Error details (empty on success) - RFC 9457 style
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ErrorDetail>,
}

impl<T> GrimoireResponse<T> {
    /// Create a successful response with message and data
    pub fn success(message: impl Into<String>, data: T) -> Self {
        Self {
            success: true,
            message: message.into(),
            data: Some(data),
            errors: vec![],
        }
    }

    /// Create a failed response with message and errors
    pub fn failure(message: impl Into<String>, errors: Vec<ErrorDetail>) -> Self {
        Self {
            success: false,
            message: message.into(),
            data: None,
            errors,
        }
    }

    /// Check if the response represents success
    pub fn is_success(&self) -> bool {
        self.success
    }

    /// Check if the response represents failure
    pub fn is_failure(&self) -> bool {
        !self.success
    }

    /// Get the data if present
    pub fn data(&self) -> Option<&T> {
        self.data.as_ref()
    }

    /// Get errors
    pub fn errors(&self) -> &[ErrorDetail] {
        &self.errors
    }

    /// Convert to a Result type for easier error handling
    pub fn into_result(self) -> Result<T, Vec<ErrorDetail>> {
        if self.success {
            self.data.ok_or_else(Vec::new)
        } else {
            Err(self.errors)
        }
    }

    /// Map the data to a different type if successful
    pub fn map<U, F>(self, f: F) -> GrimoireResponse<U>
    where
        F: FnOnce(T) -> U,
    {
        GrimoireResponse {
            success: self.success,
            message: self.message,
            data: self.data.map(f),
            errors: self.errors,
        }
    }
}

impl<T: Default> GrimoireResponse<T> {
    /// Create a successful response with default data
    pub fn success_default(message: impl Into<String>) -> Self {
        Self::success(message, T::default())
    }
}

// Unit type specialization for operations with no data
impl GrimoireResponse<()> {
    /// Create a successful response with no data
    pub fn success_unit(message: impl Into<String>) -> Self {
        Self::success(message, ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorDetail;

    #[test]
    fn test_success_response() {
        let response = GrimoireResponse::success("Operation completed", 42);
        assert!(response.is_success());
        assert!(!response.is_failure());
        assert_eq!(response.data(), Some(&42));
        assert!(response.errors().is_empty());
    }

    #[test]
    fn test_failure_response() {
        let errors = vec![ErrorDetail::new("test_error", "Test Error", "Details")];
        let response: GrimoireResponse<i32> = GrimoireResponse::failure("Failed", errors.clone());
        assert!(!response.is_success());
        assert!(response.is_failure());
        assert_eq!(response.data(), None);
        assert_eq!(response.errors().len(), 1);
    }

    #[test]
    fn test_into_result() {
        let success: GrimoireResponse<i32> = GrimoireResponse::success("OK", 42);
        assert_eq!(success.into_result(), Ok(42));

        let errors = vec![ErrorDetail::new("test", "Test", "Details")];
        let failure: GrimoireResponse<i32> = GrimoireResponse::failure("Failed", errors.clone());
        assert!(failure.into_result().is_err());
    }

    #[test]
    fn test_map() {
        let response = GrimoireResponse::success("Number", 42);
        let mapped = response.map(|n| n.to_string());
        assert_eq!(mapped.data(), Some(&"42".to_string()));
    }

    #[test]
    fn test_success_unit() {
        let response = GrimoireResponse::success_unit("Done");
        assert!(response.is_success());
        assert_eq!(response.data(), Some(&()));
    }
}
