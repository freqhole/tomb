//! blobz inspection command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};

pub(in crate::ratcore::catalog) fn backfill_blake3() -> AdminCommand {
    AdminCommand {
        name: "blobz_backfill_blake3".to_string(),
        request_type: "BlobzBackfillBlake3Request".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "batch_size".to_string(),
            kind: ArgKind::Number {
                placeholder: "(blank = 100) blobs to hash per batch".to_string(),
                signed: false,
                min: Some(1),
                max: None,
            },
            required: false,
            help: Some("how many rows to process in one pass".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn check_references() -> AdminCommand {
    AdminCommand {
        name: "blobz_check_references".to_string(),
        request_type: "BlobzCheckReferencesRequest".to_string(),
        response_type: "MediaBlobReferences".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "blob_id".to_string(),
            kind: ArgKind::Text {
                placeholder: "media blob id (uuid)".to_string(),
            },
            required: true,
            help: Some("which blob to look up references for".to_string()),
        }],
    }
}
