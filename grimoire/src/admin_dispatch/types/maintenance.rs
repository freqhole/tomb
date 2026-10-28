use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[derive(Debug, Deserialize, ZodSchema)]
pub struct RetranscodeVideoRenditionsRequest {
    pub video_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ZodSchema)]
pub struct RetranscodeVideoRenditionsSummary {
    pub videos_with_renditions: u32,
    pub jobs_enqueued: u32,
    pub pending_jobs_skipped: u32,
    pub enqueue_failures: u32,
}
