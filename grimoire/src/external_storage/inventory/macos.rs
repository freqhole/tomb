//! diskutil supplies stable identities; kernel mount records validate selections.

use super::RemovableVolume;
use plist::Value;
use serde::Deserialize;
use std::{collections::HashSet, io, time::Duration};

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DiskList {
    all_disks_and_partitions: Vec<Disk>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Disk {
    device_identifier: String,
    #[serde(default)]
    partitions: Vec<Disk>,
    #[serde(default, rename = "APFSVolumes")]
    apfs_volumes: Vec<Disk>,
    #[serde(default, rename = "APFSPhysicalStores")]
    apfs_physical_stores: Vec<Store>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Store {
    device_identifier: String,
}

async fn diskutil(args: &[&str]) -> io::Result<Value> {
    let output = tokio::process::Command::new("/usr/sbin/diskutil")
        .args(args)
        .kill_on_drop(true)
        .output()
        .await?;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "diskutil failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Value::from_reader(std::io::Cursor::new(output.stdout))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

pub(super) async fn list() -> io::Result<Vec<RemovableVolume>> {
    tokio::time::timeout(Duration::from_secs(30), async {
        // built-in card readers report internal disks with removable media.
        // physical ancestry also keeps disk images out of APFS discovery.
        let physical = diskutil(&["list", "-plist", "physical"]).await?;
        let mut eligible = Vec::new();
        for disk in decode_list(&physical)?.all_disks_and_partitions {
            validate_identifier(&disk.device_identifier)?;
            let info = diskutil(&["info", "-plist", &disk.device_identifier]).await?;
            if is_library_disk(&info) {
                eligible.push(disk);
            }
        }
        let all = diskutil(&["list", "-plist"]).await?;
        let identifiers = candidates(&eligible, &all)?;
        let mut volumes = Vec::new();
        for identifier in identifiers {
            let info = diskutil(&["info", "-plist", &identifier]).await?;
            if let Some(volume) = volume(&info)? {
                volumes.push(volume);
            }
        }
        volumes.sort_by(|a, b| a.device_path.cmp(&b.device_path));
        Ok(volumes)
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "diskutil inventory timed out"))?
}

fn decode_list(value: &Value) -> io::Result<DiskList> {
    plist::from_value(value).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn is_library_disk(info: &Value) -> bool {
    let flag = |key| info.as_dictionary()?.get(key)?.as_boolean();
    flag("Internal") == Some(false)
        || flag("RemovableMedia") == Some(true)
        || flag("Removable") == Some(true)
}

fn validate_identifier(identifier: &str) -> io::Result<()> {
    if !identifier.starts_with("disk") || !identifier.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid diskutil device identifier",
        ));
    }
    Ok(())
}

fn candidates(physical: &[Disk], all: &Value) -> io::Result<Vec<String>> {
    fn collect(disk: &Disk, result: &mut HashSet<String>) {
        result.insert(disk.device_identifier.clone());
        for child in disk.partitions.iter().chain(&disk.apfs_volumes) {
            collect(child, result);
        }
    }
    let mut devices = HashSet::new();
    for disk in physical {
        collect(disk, &mut devices);
    }
    let mut result = devices.clone();
    for disk in decode_list(all)?.all_disks_and_partitions {
        if !disk.apfs_physical_stores.is_empty()
            && disk
                .apfs_physical_stores
                .iter()
                .all(|store| devices.contains(&store.device_identifier))
        {
            collect(&disk, &mut result);
        }
    }
    let mut identifiers: Vec<_> = result.into_iter().collect();
    // never pass arbitrary strings returned by an unexpected tool as options.
    for identifier in &identifiers {
        validate_identifier(identifier)?;
    }
    identifiers.sort();
    Ok(identifiers)
}

fn volume(info: &Value) -> io::Result<Option<RemovableVolume>> {
    let data = info
        .as_dictionary()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid diskutil info"))?;
    let text = |key: &str| {
        data.get(key)
            .and_then(Value::as_string)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let Some(filesystem) = text("FilesystemType") else {
        return Ok(None);
    };
    if !is_library_disk(info) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "removable disk identity changed during inventory",
        ));
    }
    let device_path = text("DeviceNode").ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidData, "missing diskutil device path")
    })?;
    let writable = data
        .get("Writable")
        .and_then(Value::as_boolean)
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "missing diskutil writable flag")
        })?;
    let size_bytes = data
        .get("TotalSize")
        .and_then(Value::as_unsigned_integer)
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "missing diskutil volume size")
        })?;
    let mount_points: Vec<_> = text("MountPoint").into_iter().collect();
    if mount_points
        .iter()
        .any(|p| p == "/" || p.starts_with("/System/"))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "external inventory includes system volume",
        ));
    }
    Ok(Some(RemovableVolume {
        device_path,
        uuid: text("VolumeUUID"),
        partition_uuid: text("DiskUUID"),
        label: text("VolumeName"),
        filesystem,
        mount_points,
        read_only: !writable,
        size_bytes,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "read-only probe of the host's actual external disks"]
    async fn host_inventory_matches_kernel_mount_records() {
        let volumes = list().await.unwrap();
        let mounts = crate::external_storage::mounts::read_mounts().unwrap();
        for volume in &volumes {
            assert!(volume.device_path.starts_with("/dev/disk"));
            println!("{}: {:?}", volume.device_path, volume.mount_points);
            for path in &volume.mount_points {
                let root = std::fs::canonicalize(path).unwrap();
                let mount = crate::external_storage::mounts::deepest_mount(&mounts, &root).unwrap();
                assert_eq!(mount.path, root);
                assert_eq!(
                    std::fs::canonicalize(&mount.device).unwrap(),
                    std::fs::canonicalize(&volume.device_path).unwrap()
                );
            }
        }
        println!("observed {} external filesystem volumes", volumes.len());
    }

    fn value(xml_body: &str) -> Value {
        Value::from_reader_xml(format!("<plist version=\"1.0\">{xml_body}</plist>").as_bytes())
            .unwrap()
    }

    #[test]
    fn physical_disks_and_their_apfs_volumes_exclude_disk_images() {
        let physical = value("<dict><key>AllDisksAndPartitions</key><array><dict><key>DeviceIdentifier</key><string>disk2</string><key>Partitions</key><array><dict><key>DeviceIdentifier</key><string>disk2s1</string></dict></array></dict></array></dict>");
        let external = value("<dict><key>AllDisksAndPartitions</key><array><dict><key>DeviceIdentifier</key><string>disk3</string><key>APFSPhysicalStores</key><array><dict><key>DeviceIdentifier</key><string>disk2s1</string></dict></array><key>APFSVolumes</key><array><dict><key>DeviceIdentifier</key><string>disk3s1</string></dict></array></dict><dict><key>DeviceIdentifier</key><string>disk5</string><key>APFSPhysicalStores</key><array><dict><key>DeviceIdentifier</key><string>disk4s1</string></dict></array></dict></array></dict>");
        assert_eq!(
            candidates(
                &decode_list(&physical).unwrap().all_disks_and_partitions,
                &external,
            )
            .unwrap(),
            ["disk2", "disk2s1", "disk3", "disk3s1"]
        );
    }

    #[test]
    fn retains_unmounted_read_only_volume_identity_and_rejects_internal_or_incomplete_info() {
        let mut info = value("<dict><key>DeviceNode</key><string>/dev/disk2s1</string><key>Internal</key><false/><key>FilesystemType</key><string>exfat</string><key>VolumeUUID</key><string>1234-ABCD</string><key>DiskUUID</key><string>partition</string><key>Writable</key><false/><key>TotalSize</key><integer>2048</integer></dict>");
        let disk = volume(&info).unwrap().unwrap();
        assert!(disk.mount_points.is_empty());
        assert!(disk.read_only);
        assert_eq!(disk.uuid.as_deref(), Some("1234-ABCD"));
        assert_eq!(disk.partition_uuid.as_deref(), Some("partition"));
        info.as_dictionary_mut()
            .unwrap()
            .insert("Internal".into(), Value::Boolean(true));
        assert!(volume(&info).is_err());
        assert!(decode_list(&value("<dict/>")).is_err());
        assert!(candidates(&[], &value("<dict/>")).is_err());
    }

    #[test]
    fn internal_card_reader_media_is_eligible_but_fixed_internal_storage_is_not() {
        let mut info = value("<dict><key>DeviceNode</key><string>/dev/disk6s1</string><key>Internal</key><true/><key>RemovableMedia</key><true/><key>FilesystemType</key><string>exfat</string><key>VolumeUUID</key><string>card-uuid</string><key>MountPoint</key><string>/Volumes/fatty</string><key>Writable</key><true/><key>TotalSize</key><integer>63831146496</integer></dict>");
        assert!(is_library_disk(&info));
        let disk = volume(&info).unwrap().unwrap();
        assert_eq!(disk.mount_points, ["/Volumes/fatty"]);
        assert_eq!(disk.uuid.as_deref(), Some("card-uuid"));
        let data = info.as_dictionary_mut().unwrap();
        data.insert("RemovableMedia".into(), Value::Boolean(false));
        assert!(!is_library_disk(&info));
        assert!(volume(&info).is_err());
        info.as_dictionary_mut()
            .unwrap()
            .insert("Removable".into(), Value::Boolean(true));
        assert!(is_library_disk(&info));
        assert!(volume(&info).unwrap().is_some());
        info.as_dictionary_mut()
            .unwrap()
            .insert("MountPoint".into(), Value::String("/".into()));
        assert!(volume(&info).is_err());
    }
}
