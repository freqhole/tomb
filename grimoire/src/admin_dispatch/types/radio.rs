//! typed radio admin command envelopes.
//!
//! response shapes:
//! - `radio_stations_list`  -> `Vec<RadioStation>`
//! - `radio_stations_get`   -> `RadioStation`
//! - `radio_stations_create` -> `RadioStation`
//! - `radio_stations_update` -> `RadioStation`
//! - `radio_stations_delete` -> `EmptyResponse`

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// request for `radio_stations_get` and `radio_stations_delete`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationsByIdRequest {
    pub id: String,
}
