//! read-only block-volume inventory for library source selection.
//! mounting remains the OS's responsibility; no filesystem traversal is needed.

use serde::{Deserialize, Serialize};
use std::io;

#[cfg(target_os = "macos")]
#[path = "inventory/macos.rs"]
mod macos;

#[cfg(any(target_os = "windows", test))]
#[path = "inventory/windows.rs"]
mod windows;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, zod_gen_derive::ZodSchema)]
pub struct RemovableVolume {
    pub device_path: String,
    pub uuid: Option<String>,
    pub partition_uuid: Option<String>,
    pub label: Option<String>,
    pub filesystem: String,
    pub mount_points: Vec<String>,
    pub read_only: bool,
    pub size_bytes: u64,
}

/// returns filesystem-bearing USB/removable volumes, including unmounted ones.
/// UUIDs are observations, not unique keys: cloned disks can share them.
pub async fn list_removable_volumes() -> io::Result<Vec<RemovableVolume>> {
    #[cfg(target_os = "macos")]
    {
        return macos::list().await;
    }
    #[cfg(target_os = "windows")]
    {
        return windows::list().await;
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "removable volume inventory requires Linux, macOS or Windows",
        ));
    }
    #[cfg(target_os = "linux")]
    list_linux().await
}

#[cfg(target_os = "linux")]
async fn list_linux() -> io::Result<Vec<RemovableVolume>> {
    let mut command = tokio::process::Command::new("lsblk");
    command.kill_on_drop(true).args([
        "--json",
        "--bytes",
        "--paths",
        "--tree",
        "--output",
        "PATH,TYPE,TRAN,RM,LABEL,UUID,PARTUUID,FSTYPE,MOUNTPOINTS,RO,SIZE",
    ]);
    let output = tokio::time::timeout(std::time::Duration::from_secs(10), command.output())
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "lsblk inventory timed out"))??;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "lsblk failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    parse_inventory(&output.stdout)
}

#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
struct Inventory {
    blockdevices: Vec<BlockDevice>,
}

#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
struct BlockDevice {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    tran: Option<String>,
    rm: Flag,
    label: Option<String>,
    uuid: Option<String>,
    partuuid: Option<String>,
    fstype: Option<String>,
    mountpoints: Vec<Option<String>>,
    ro: Flag,
    size: Size,
    #[serde(default)]
    children: Vec<BlockDevice>,
}

#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
#[serde(untagged)]
enum Flag {
    Bool(bool),
    Number(u8),
}

#[cfg(any(target_os = "linux", test))]
impl Flag {
    fn value(&self) -> io::Result<bool> {
        match self {
            Self::Bool(value) => Ok(*value),
            Self::Number(0) => Ok(false),
            Self::Number(1) => Ok(true),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid lsblk flag",
            )),
        }
    }
}

#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
#[serde(untagged)]
enum Size {
    Number(u64),
    Text(String),
}

#[cfg(any(target_os = "linux", test))]
impl Size {
    fn value(&self) -> io::Result<u64> {
        match self {
            Self::Number(value) => Ok(*value),
            Self::Text(value) => value
                .parse()
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
        }
    }
}

#[cfg(any(target_os = "linux", test))]
fn parse_inventory(bytes: &[u8]) -> io::Result<Vec<RemovableVolume>> {
    let inventory: Inventory = serde_json::from_slice(bytes)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut volumes = Vec::new();
    for device in &inventory.blockdevices {
        if !contains_system_mount(device) {
            collect_volumes(device, false, &mut volumes)?;
        }
    }
    volumes.sort_by(|a, b| a.device_path.cmp(&b.device_path));
    volumes.dedup_by(|a, b| a.device_path == b.device_path);
    Ok(volumes)
}

#[cfg(any(target_os = "linux", test))]
fn contains_system_mount(device: &BlockDevice) -> bool {
    device.mountpoints.iter().flatten().any(|path| {
        matches!(
            path.as_str(),
            "/" | "/boot" | "/boot/firmware" | "/usr" | "/var" | "/home"
        )
    }) || device.children.iter().any(contains_system_mount)
}

#[cfg(any(target_os = "linux", test))]
fn collect_volumes(
    device: &BlockDevice,
    external_parent: bool,
    volumes: &mut Vec<RemovableVolume>,
) -> io::Result<()> {
    let external = external_parent || device.rm.value()? || device.tran.as_deref() == Some("usb");
    let read_only = device.ro.value()?;
    let size_bytes = device.size.value()?;
    if external && matches!(device.kind.as_str(), "disk" | "part") {
        if let Some(filesystem) = device.fstype.as_deref().filter(|fs| {
            !fs.is_empty()
                && !matches!(
                    *fs,
                    "swap" | "crypto_LUKS" | "LVM2_member" | "linux_raid_member"
                )
        }) {
            volumes.push(RemovableVolume {
                device_path: device.path.clone(),
                uuid: nonempty(&device.uuid),
                partition_uuid: nonempty(&device.partuuid),
                label: nonempty(&device.label),
                filesystem: filesystem.to_owned(),
                mount_points: device.mountpoints.iter().flatten().cloned().collect(),
                read_only,
                size_bytes,
            });
        }
    }
    for child in &device.children {
        collect_volumes(child, external, volumes)?;
    }
    Ok(())
}

#[cfg(any(target_os = "linux", test))]
fn nonempty(value: &Option<String>) -> Option<String> {
    value.as_ref().filter(|value| !value.is_empty()).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn device(path: &str) -> Value {
        json!({
            "path": path, "type": "disk", "tran": "usb", "rm": false,
            "label": "my music", "uuid": "1234-ABCD", "partuuid": null,
            "fstype": "exfat", "mountpoints": ["/media/pi/my music"],
            "ro": false, "size": 1024
        })
    }

    fn parse(devices: Vec<Value>) -> io::Result<Vec<RemovableVolume>> {
        parse_inventory(&serde_json::to_vec(&json!({"blockdevices": devices})).unwrap())
    }

    #[test]
    fn usb_partitions_inherit_transport_and_keep_mount_paths_and_duplicate_uuids() {
        let mut disk = device("/dev/sda");
        disk["fstype"] = Value::Null;
        disk["mountpoints"] = json!([null]);
        let mut first = device("/dev/sda1");
        first["type"] = json!("part");
        first["tran"] = Value::Null;
        first["mountpoints"] = json!(["/media/pi/my music", "/mnt/also here"]);
        let mut second = first.clone();
        second["path"] = json!("/dev/sda2");
        second["mountpoints"] = json!([null]);
        second["ro"] = json!(1);
        second["size"] = json!("2048");
        disk["children"] = json!([first, second]);
        let volumes = parse(vec![disk]).unwrap();
        assert_eq!(volumes.len(), 2);
        assert_eq!(volumes[0].mount_points.len(), 2);
        assert_eq!(volumes[0].label.as_deref(), Some("my music"));
        assert!(volumes[1].mount_points.is_empty());
        assert!(volumes[1].read_only);
        assert_eq!(volumes[1].size_bytes, 2048);
        assert_eq!(volumes[0].uuid, volumes[1].uuid);
    }

    #[test]
    fn excludes_entire_system_disk_even_when_booted_from_usb() {
        let mut disk = device("/dev/sda");
        let mut root = device("/dev/sda1");
        root["mountpoints"] = json!(["/"]);
        disk["children"] = json!([root, device("/dev/sda2")]);
        assert!(parse(vec![disk]).unwrap().is_empty());
    }

    #[test]
    fn excludes_internal_disks_and_non_filesystems_but_includes_removable_sd() {
        let mut internal = device("/dev/nvme0n1");
        internal["tran"] = json!("nvme");
        let mut sd = device("/dev/mmcblk1");
        sd["tran"] = Value::Null;
        sd["rm"] = json!(1);
        sd["uuid"] = Value::Null;
        let mut swap = device("/dev/sdb1");
        swap["fstype"] = json!("swap");
        let volumes = parse(vec![internal, sd, swap]).unwrap();
        assert_eq!(volumes.len(), 1);
        assert_eq!(volumes[0].device_path, "/dev/mmcblk1");
        assert_eq!(volumes[0].uuid, None);
    }

    #[test]
    fn invalid_probe_results_are_errors_not_empty_inventories() {
        assert!(parse_inventory(b"not json").is_err());
        assert!(parse_inventory(b"{}").is_err());
        let mut invalid = device("/dev/sda");
        invalid["rm"] = json!(2);
        assert!(parse(vec![invalid]).is_err());
        assert!(parse(vec![]).unwrap().is_empty());
    }
}
