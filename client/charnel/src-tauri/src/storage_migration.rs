use grimoire::storage_migration::{Operation, Preview};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[cfg(desktop)]
pub fn start_pending(app: &AppHandle, path: PathBuf) -> Result<bool, String> {
    if !grimoire::storage_migration::pending(&path).map_err(|e| e.to_string())? {
        return Ok(false);
    }
    // a system dialog avoids opening a webview/profile inside the source folder.
    app.dialog()
        .message(
            "storage migration is starting. keep both disks connected and leave Charnel running. \
         copying and verification may take a long time. Charnel will reopen when finished. \
         close any other freqhole apps first. progress is recorded in charnel.log.",
        )
        .title("moving storage")
        .show(|_| {});
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || {
            grimoire::storage_migration::prepare_startup(&path).map_err(|e| format!("{e:#}"))
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
        match result {
            Ok(()) => {
                if std::env::var("FREQHOLE_PI_SERVICE").as_deref() == Ok("1") {
                    // systemd must relaunch us; a child would die with this service's cgroup.
                    app.exit(75);
                } else {
                    app.restart();
                }
            }
            Err(error) => {
                tracing::error!(%error, "storage migration stopped");
                let handle = app.clone();
                app.dialog()
                    .message(format!(
                        "storage migration stopped: {error}\n\n\
                     no destination files were overwritten. do not delete either folder. \
                     fix the reported problem, then reopen Charnel to resume. \
                     an unstarted change can be cancelled with `config storage cancel`."
                    ))
                    .title("storage migration needs attention")
                    .show(move |_| handle.exit(1));
            }
        }
    });
    Ok(true)
}

fn config(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(mobile) {
        return Err("storage moves are only available on desktop".into());
    }
    crate::app_config::get_server_config_path_resolved(app)
        .ok_or_else(|| "config file not found - run setup first".to_string())
}

#[tauri::command]
pub async fn preview_storage_change(
    app: AppHandle,
    operation: Operation,
    destination: String,
) -> Result<Preview, String> {
    let path = config(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        grimoire::storage_migration::preview(&path, operation, &PathBuf::from(destination))
            .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn schedule_storage_change(
    app: AppHandle,
    operation: Operation,
    destination: String,
    merge: bool,
    confirmation: String,
) -> Result<Preview, String> {
    let path = config(&app)?;
    let preferences = crate::app_config::get_config_path(&app);
    tauri::async_runtime::spawn_blocking(move || {
        grimoire::storage_migration::schedule_with_preferences(
            &path,
            operation,
            &PathBuf::from(destination),
            merge,
            &confirmation,
            preferences.as_deref(),
        )
        .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn close_for_storage_change(app: AppHandle) -> Result<(), String> {
    if !grimoire::storage_migration::pending(&config(&app)?).map_err(|e| e.to_string())? {
        return Err("no storage change is pending".into());
    }
    app.exit(0);
    Ok(())
}
