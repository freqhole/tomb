//! blobz inspection command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};

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
