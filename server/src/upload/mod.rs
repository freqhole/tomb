//! upload handlers for file uploads
//!
//! module structure:
//! - images: image upload and deletion (entity image associations)
//! - music: music file uploads (audio files stored on filesystem)

pub mod images;
pub mod music;

// re-export handlers for route registration
pub use images::{delete_image_handler, upload_image_handler};
pub use music::upload_music_handler;
