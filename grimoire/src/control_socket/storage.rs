//! restricted storage operations for the same-user OLED control socket.

use crate::{offal::Caller, response::GrimoireResponse, users::UserRole, ErrorDetail};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{sync::OnceLock, time::Duration};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    command: String,
    #[serde(default)]
    args: Value,
}

pub(super) async fn handle(payload: &str) -> String {
    let response = dispatch(payload).await;
    if !response.success {
        tracing::warn!(errors = ?response.errors, "control socket storage operation failed");
    }
    serde_json::to_string(&response).expect("storage response contains only JSON values")
}

async fn dispatch(payload: &str) -> GrimoireResponse<Value> {
    let request: Request = match serde_json::from_str(payload) {
        Ok(request) => request,
        Err(error) => return failure("invalid_storage_request", error.to_string()),
    };
    if request.command == "watch" {
        return match watch(request.args.get("revision").and_then(Value::as_str)).await {
            Ok(revision) => {
                GrimoireResponse::success("storage notification", json!({ "revision": revision }))
            }
            Err(error) => failure("storage_watch_failed", error.to_string()),
        };
    }
    if matches!(
        request.command.as_str(),
        "storage_data_dir_preview" | "storage_data_dir_schedule"
    ) {
        return data_dir_change(request.command == "storage_data_dir_schedule", request.args).await;
    }
    if !matches!(
        request.command.as_str(),
        "library_list_removable_volumes"
            | "library_list_sources"
            | "library_browse_volume"
            | "library_register_source"
    ) {
        return failure(
            "invalid_storage_command",
            "unsupported local storage command".into(),
        );
    }
    // the listener checks OS peer identity; the allowlist never exposes general
    // admin dispatch or destructive operations (a data dir move keeps its source
    // files until the verified cutover). registration wakes the job runner.
    let caller = Caller::new("control-socket", "OLED", UserRole::Admin);
    crate::admin_dispatch::handle(&request.command, request.args, &caller).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DataDirRequest {
    selection: crate::external_storage::sources::SourceSelection,
    #[serde(default)]
    create_folder: Option<String>,
}

/// moves this player's data directory onto a removable volume folder. only
/// queues the move (same as `config storage schedule move-data`); it runs at
/// the player's next startup, so the caller restarts the player afterwards.
async fn data_dir_change(queue: bool, args: Value) -> GrimoireResponse<Value> {
    let request: DataDirRequest = match serde_json::from_value(args) {
        Ok(request) => request,
        Err(error) => return failure("invalid_storage_request", error.to_string()),
    };
    let Some(config_path) = crate::config::get_config_path() else {
        return failure(
            "storage_config_unavailable",
            "player config path is unknown".into(),
        );
    };
    let destination = match crate::external_storage::sources::data_dir_destination(
        &request.selection,
        request.create_folder.as_deref(),
    )
    .await
    {
        Ok(destination) => destination,
        Err(error) => {
            return GrimoireResponse::failure(
                "storage request failed",
                vec![ErrorDetail::from(&error)],
            )
        }
    };
    let result = tokio::task::spawn_blocking(move || {
        use crate::storage_migration::{preview, schedule, Operation};
        if queue {
            schedule(
                &config_path,
                Operation::MoveData,
                &destination,
                false,
                "move my storage",
            )
        } else {
            preview(&config_path, Operation::MoveData, &destination)
        }
    })
    .await;
    match result {
        Ok(Ok(report)) => GrimoireResponse::success(
            if queue {
                "data directory move queued; restart the player to apply"
            } else {
                "data directory move preview"
            },
            serde_json::to_value(report).expect("preview serializes"),
        ),
        Ok(Err(error)) => failure("storage_data_dir_failed", format!("{error:#}")),
        Err(error) => failure("storage_data_dir_failed", error.to_string()),
    }
}

async fn watch(previous: Option<&str>) -> std::io::Result<String> {
    static INSTANCE: OnceLock<uuid::Uuid> = OnceLock::new();
    let instance = INSTANCE.get_or_init(uuid::Uuid::new_v4);
    let mut events = crate::external_storage::events::subscribe()?;
    wait_for_revision(instance, previous, &mut events).await
}

async fn wait_for_revision(
    instance: &uuid::Uuid,
    previous: Option<&str>,
    events: &mut tokio::sync::watch::Receiver<u64>,
) -> std::io::Result<String> {
    let current = format!("{instance}:{}", *events.borrow_and_update());
    if previous == Some(current.as_str()) {
        match tokio::time::timeout(Duration::from_secs(20), events.changed()).await {
            Ok(Ok(())) | Err(_) => {}
            Ok(Err(error)) => return Err(std::io::Error::other(error)),
        }
    }
    Ok(format!("{instance}:{}", *events.borrow_and_update()))
}

fn failure(error_type: &str, detail: String) -> GrimoireResponse<Value> {
    GrimoireResponse::failure(
        "storage request failed",
        vec![ErrorDetail::new(
            error_type,
            "storage request failed",
            detail,
        )],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_malformed_requests_and_non_storage_admin_commands() {
        for payload in [
            "not JSON",
            r#"{"command":"users_delete","args":{"id":"someone"}}"#,
            r#"{"command":"library_scan_source","args":{"id":"source"}}"#,
            r#"{"command":"library_register_source","extra":true}"#,
            r#"{"command":"storage_data_dir_schedule","args":{}}"#,
            r#"{"command":"storage_data_dir_preview","args":{"selection":{"device_path":"/dev/x","mount_path":"/","relative_path":"","domain":"both"},"create_folder":"../escape"}}"#,
        ] {
            let response = dispatch(payload).await;
            assert!(!response.success);
            assert!(response.data.is_none());
            assert!(!response.errors.is_empty());
        }
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[tokio::test]
    async fn initial_watch_returns_an_opaque_revision() {
        let response = dispatch(r#"{"command":"watch"}"#).await;
        assert!(response.success);
        assert!(response.data.unwrap()["revision"]
            .as_str()
            .unwrap()
            .contains(':'));
    }

    #[tokio::test(start_paused = true)]
    async fn waits_for_notifications_and_heartbeats_without_inventory_probes() {
        let instance = uuid::Uuid::new_v4();
        let (sender, mut events) = tokio::sync::watch::channel(0);
        let initial = wait_for_revision(&instance, None, &mut events)
            .await
            .unwrap();
        let started = tokio::time::Instant::now();
        {
            let heartbeat = wait_for_revision(&instance, Some(&initial), &mut events);
            tokio::pin!(heartbeat);
            tokio::select! {
                result = &mut heartbeat => panic!("watch returned early: {result:?}"),
                _ = tokio::time::sleep(Duration::from_secs(19)) => {}
            }
            assert_eq!(heartbeat.await.unwrap(), initial);
        }
        assert_eq!(started.elapsed(), Duration::from_secs(20));

        let notified = wait_for_revision(&instance, Some(&initial), &mut events);
        tokio::pin!(notified);
        tokio::select! {
            result = &mut notified => panic!("watch returned without notification: {result:?}"),
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
        sender.send(1).unwrap();
        assert_eq!(notified.await.unwrap(), format!("{instance}:1"));
    }

    #[tokio::test]
    async fn new_process_revisions_do_not_wait_and_closed_channels_fail_explicitly() {
        let instance = uuid::Uuid::new_v4();
        let (sender, mut events) = tokio::sync::watch::channel(0);
        let current = wait_for_revision(&instance, Some("old-process:0"), &mut events)
            .await
            .unwrap();
        assert_eq!(current, format!("{instance}:0"));
        drop(sender);
        assert!(wait_for_revision(&instance, Some(&current), &mut events)
            .await
            .is_err());
    }
}
