//! Analytics module - domain-agnostic event tracking
//!
//! This module provides core analytics functionality for tracking user interactions
//! with media. It is designed to be domain-agnostic, meaning it can track events
//! for any type of media (music, photos, videos, documents, etc.).
//!
//! Domain-specific analytics (e.g., music play analytics) should be implemented
//! in their respective domain modules (e.g., `music::analytics`).

pub mod events;
pub mod models;

// Re-export core types
pub use models::{MediaEvent, MediaEventType};

// Re-export core functions
pub use events::{record_event, record_event_with_conn, record_events_batch};
