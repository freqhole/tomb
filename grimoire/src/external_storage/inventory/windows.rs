//! the Storage module supplies physical-disk eligibility; Win32 verifies mounts.

use super::RemovableVolume;
use serde::Deserialize;
use std::io;

#[cfg(target_os = "windows")]
const INVENTORY: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$result = @(
    foreach ($disk in Get-Disk) {
        if ($disk.IsBoot -or $disk.IsSystem -or $disk.BusType -notin @('USB', 'SD', 'MMC')) { continue }
        foreach ($partition in @($disk | Get-Partition)) {
            if ($partition.IsBoot -or $partition.IsSystem) { continue }
            foreach ($volume in @($partition | Get-Volume)) {
                if (-not $volume.FileSystemType -or $volume.FileSystemType -eq 'Unknown') { continue }
                [pscustomobject]@{
                    path = [string]$volume.Path
                    partition_uuid = if ($partition.Guid) { [string]$partition.Guid } else { $null }
                    label = [string]$volume.FileSystemLabel
                    filesystem = [string]$volume.FileSystemType
                    read_only = [bool]($disk.IsReadOnly -or $partition.IsReadOnly)
                    size_bytes = [uint64]$volume.Size
                }
            }
        }
    }
)
ConvertTo-Json -InputObject $result -Compress -Depth 4
"#;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Volume {
    path: String,
    partition_uuid: Option<String>,
    label: String,
    filesystem: String,
    read_only: bool,
    size_bytes: u64,
}

#[cfg(target_os = "windows")]
pub(super) async fn list() -> io::Result<Vec<RemovableVolume>> {
    // no user input or paths are interpolated into PowerShell.
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::process::Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                INVENTORY,
            ])
            .creation_flags(0x08000000)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "Windows disk inventory timed out"))??;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "Windows disk inventory failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    parse(&output.stdout, super::super::windows::probe_volume)
}

fn parse(
    bytes: &[u8],
    mut probe: impl FnMut(&str) -> io::Result<(Vec<String>, String, bool)>,
) -> io::Result<Vec<RemovableVolume>> {
    let volumes: Vec<Volume> =
        serde_json::from_slice(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes))
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let mut result = Vec::new();
    for volume in volumes {
        let guid = volume_guid(&volume.path)?;
        let (mount_points, uuid, read_only) = probe(&volume.path)?;
        if volume.filesystem.is_empty() || volume.filesystem == "Unknown" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid Windows filesystem",
            ));
        }
        let partition_uuid = match volume.partition_uuid.as_deref().filter(|id| !id.is_empty()) {
            Some(id) => {
                let id = uuid::Uuid::parse_str(id.trim_matches(['{', '}']))
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                if id.is_nil() {
                    guid
                } else {
                    id.to_string()
                }
            }
            None => guid,
        };
        result.push(RemovableVolume {
            mount_points,
            device_path: volume.path,
            uuid: Some(uuid),
            partition_uuid: Some(partition_uuid),
            label: (!volume.label.is_empty()).then_some(volume.label),
            filesystem: volume.filesystem,
            read_only: volume.read_only || read_only,
            size_bytes: volume.size_bytes,
        });
    }
    result.sort_by(|a, b| a.device_path.cmp(&b.device_path));
    result.dedup_by(|a, b| a.device_path.eq_ignore_ascii_case(&b.device_path));
    Ok(result)
}

fn volume_guid(path: &str) -> io::Result<String> {
    let guid = path
        .strip_prefix(r"\\?\Volume{")
        .and_then(|p| p.strip_suffix("}\\"));
    match guid {
        Some(guid) if uuid::Uuid::parse_str(guid).is_ok() => Ok(guid.to_ascii_lowercase()),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid Windows volume GUID path",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keeps_unmounted_ntfs_exfat_and_fat_volumes_and_mount_paths_with_spaces() {
        let volumes: Vec<_> = ["NTFS", "exFAT", "FAT32"]
            .iter()
            .enumerate()
            .map(|(i, fs)| {
                json!({
                    "path": format!(r"\\?\Volume{{12345678-1234-1234-1234-12345678900{i}}}\"),
                    "partition_uuid": null, "label": "my music", "filesystem": fs,
                    "read_only": i == 1, "size_bytes": 123
                })
            })
            .collect();
        let disks = parse(&serde_json::to_vec(&volumes).unwrap(), |path| {
            Ok((
                if path.contains("9000") {
                    vec![]
                } else {
                    vec![r"E:\".into(), r"C:\USB music\".into()]
                },
                "1234-ABCD".into(),
                false,
            ))
        })
        .unwrap();
        assert_eq!(disks.len(), 3);
        assert!(disks[0].mount_points.is_empty());
        assert!(disks[1].read_only);
        assert_eq!(disks[1].uuid.as_deref(), Some("1234-ABCD"));
        assert_ne!(disks[0].partition_uuid, disks[1].partition_uuid);
        assert_eq!(disks[2].mount_points[1], r"C:\USB music\");
        assert_eq!(disks[2].filesystem, "FAT32");
    }

    #[test]
    fn canonical_guid_fallback_and_filesystem_read_only_flag_are_preserved() {
        let input = serde_json::to_vec(&json!([{
            "path": r"\\?\Volume{ABCDEFAB-1234-1234-1234-123456789000}\",
            "partition_uuid": "{00000000-0000-0000-0000-000000000000}",
            "label": "music", "filesystem": "NTFS", "read_only": false, "size_bytes": 1024
        }]))
        .unwrap();
        let disks = parse(&input, |_| {
            Ok((vec![r"E:\".into()], "1234-ABCD".into(), true))
        })
        .unwrap();
        assert_eq!(
            disks[0].partition_uuid.as_deref(),
            Some("abcdefab-1234-1234-1234-123456789000")
        );
        assert!(disks[0].read_only);
    }

    #[test]
    fn rejects_malformed_partial_and_failed_snapshots() {
        assert!(parse(b"null", |_| Ok((vec![], "serial".into(), false))).is_err());
        assert!(parse(b"[{}]", |_| Ok((vec![], "serial".into(), false))).is_err());
        assert!(volume_guid(r"C:\").is_err());
        assert!(volume_guid(r"\\?\Volume{not-a-guid}\").is_err());
        let input = serde_json::to_vec(&json!([{
            "path": r"\\?\Volume{12345678-1234-1234-1234-123456789000}\",
            "partition_uuid": null, "label": "", "filesystem": "NTFS",
            "read_only": false, "size_bytes": 123
        }]))
        .unwrap();
        assert!(parse(&input, |_| Err(io::Error::other("mount changed"))).is_err());
        assert!(parse(b"[]", |_| panic!("empty inventory probed mounts"))
            .unwrap()
            .is_empty());
    }
}
