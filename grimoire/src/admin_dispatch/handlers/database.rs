//! database test/info handlers.

use crate::admin_dispatch::helpers::internal;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn test() -> GrimoireResponse<JsonValue> {
    match crate::test_database().await {
        Ok(result) => {
            let msg = if result.connection_ok {
                "database connection successful"
            } else {
                "database connection test failed"
            };
            match serde_json::to_value(&result) {
                Ok(v) => GrimoireResponse::success(msg, v),
                Err(e) => internal(format!("serialize failed: {e}")),
            }
        }
        Err(e) => GrimoireResponse::failure("failed to test database connection", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn info() -> GrimoireResponse<JsonValue> {
    match crate::get_database_info().await {
        Ok(info) => match serde_json::to_value(&info) {
            Ok(v) => GrimoireResponse::success(format!("database: {}", info.database_file), v),
            Err(e) => internal(format!("serialize failed: {e}")),
        },
        Err(e) => GrimoireResponse::failure("failed to get database info", vec![e.into()]),
    }
}
