//! tauri command surface for the removable-storage sync feature.
//!
//! see docs/removable-storage-sync-plan.md. kept isolated from
//! `commands.rs` (already huge) and from `external_storage::mod` (which
//! only holds platform-specific volume/eject helpers, no tauri/config
//! glue). a single `external_storage_command` entrypoint dispatches on
//! `action` rather than registering a separate tauri command per
//! operation.

use super::{eject_device, is_still_mounted, resolve_volume_info};
use crate::app_config::{ExternalStorageDevice, FreqholeAppConfig};
use crate::spume_bridge::notify_config_changed;
use serde::{Deserialize, Serialize};

/// global removable-storage sync settings, shared by every configured
/// device (per-device state - which device, its subpath override, etc -
/// lives in `ExternalStorageDevice` instead).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalStorageSettings {
    pub default_subpath: String,
    pub reencode_enabled: bool,
    pub reencode_args: String,
}

/// tagged action payload for `external_storage_command`.
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ExternalStorageAction {
    /// get the global removable-storage sync settings (defaults if unset).
    GetSettings,
    /// save the global removable-storage sync settings.
    SetSettings { settings: ExternalStorageSettings },
    /// all remembered devices (not necessarily mounted right now).
    GetDevices,
    /// of the remembered devices, which ones are currently mounted -
    /// drives playerbar icon visibility and the multi-device picker.
    ListMounted,
    /// the currently-active device, if selected and still mounted.
    GetActive,
    /// add (or re-select) a device from a folder-picker result. upserts
    /// by id (volume uuid, falling back to path) and sets it active.
    /// `subpath` is optional - omit to fall back to the global default.
    AddDevice {
        path: String,
        subpath: Option<String>,
    },
    /// switch which remembered device is "active" in the ui.
    SetActive { id: String },
    /// forget a remembered device (does not touch files already written).
    RemoveDevice { id: String },
    /// ask the os to unmount/eject a device by id.
    EjectDevice { id: String },
}

/// serialize a response value, mapping serde errors to the plain `String`
/// error type every tauri command in this module returns.
fn to_value<T: Serialize>(v: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

/// single tauri command entrypoint for all removable-storage sync
/// operations.
#[tauri::command]
pub fn external_storage_command(
    app_handle: tauri::AppHandle,
    action: ExternalStorageAction,
) -> Result<serde_json::Value, String> {
    match action {
        ExternalStorageAction::GetSettings => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            to_value(ExternalStorageSettings {
                default_subpath: config.external_storage_default_subpath,
                reencode_enabled: config.external_storage_reencode_enabled,
                reencode_args: config.external_storage_reencode_args,
            })
        }

        ExternalStorageAction::SetSettings { settings } => {
            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            config.external_storage_default_subpath = settings.default_subpath;
            config.external_storage_reencode_enabled = settings.reencode_enabled;
            config.external_storage_reencode_args = settings.reencode_args;
            config.save(&app_handle)?;
            let _ = notify_config_changed(&app_handle, "external_storage_settings changed");
            to_value(())
        }

        ExternalStorageAction::GetDevices => {
            let devices = FreqholeAppConfig::load(&app_handle)
                .map(|c| c.external_storage_devices)
                .unwrap_or_default();
            to_value(devices)
        }

        ExternalStorageAction::ListMounted => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let mounted: Vec<ExternalStorageDevice> = config
                .external_storage_devices
                .into_iter()
                .filter(is_still_mounted)
                .collect();
            to_value(mounted)
        }

        ExternalStorageAction::GetActive => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let active = config
                .active_external_storage_device_id
                .as_ref()
                .and_then(|active_id| {
                    config
                        .external_storage_devices
                        .iter()
                        .find(|d| &d.id == active_id)
                        .cloned()
                })
                .filter(|d| is_still_mounted(d));
            to_value(active)
        }

        ExternalStorageAction::AddDevice { path, subpath } => {
            let resolved_path = grimoire::paths::canonical_path_string(&path);
            let (volume_name, volume_uuid) = resolve_volume_info(&resolved_path);
            let id = volume_uuid.clone().unwrap_or_else(|| resolved_path.clone());

            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();

            let device = if let Some(existing) = config
                .external_storage_devices
                .iter_mut()
                .find(|d| d.id == id)
            {
                existing.path = resolved_path;
                existing.volume_name = volume_name;
                existing.volume_uuid = volume_uuid;
                if subpath.is_some() {
                    existing.subpath = subpath;
                }
                existing.clone()
            } else {
                let device = ExternalStorageDevice {
                    id: id.clone(),
                    path: resolved_path,
                    volume_name,
                    volume_uuid,
                    subpath,
                    last_synced_at: None,
                };
                config.external_storage_devices.push(device.clone());
                device
            };

            config.active_external_storage_device_id = Some(id);
            config.save(&app_handle)?;
            let _ = notify_config_changed(&app_handle, "external_storage_devices changed");
            to_value(device)
        }

        ExternalStorageAction::SetActive { id } => {
            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            config.active_external_storage_device_id = Some(id);
            config.save(&app_handle)?;
            let _ = notify_config_changed(&app_handle, "external_storage_devices changed");
            to_value(())
        }

        ExternalStorageAction::RemoveDevice { id } => {
            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            config.external_storage_devices.retain(|d| d.id != id);
            if config.active_external_storage_device_id.as_deref() == Some(id.as_str()) {
                config.active_external_storage_device_id = None;
            }
            config.save(&app_handle)?;
            let _ = notify_config_changed(&app_handle, "external_storage_devices changed");
            to_value(())
        }

        ExternalStorageAction::EjectDevice { id } => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let device = config
                .external_storage_devices
                .iter()
                .find(|d| d.id == id)
                .ok_or_else(|| "device not found".to_string())?;
            eject_device(&device.path)?;
            to_value(())
        }
    }
}
