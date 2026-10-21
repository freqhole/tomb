//! Win32 volume GUID and mount-path helpers shared by probing and validation.

use std::io;
use windows_sys::Win32::{
    Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_FILES, HANDLE, INVALID_HANDLE_VALUE},
    Storage::FileSystem::*,
    System::SystemServices::FILE_READ_ONLY_VOLUME,
};

pub(super) fn probe_volume(volume: &str) -> io::Result<(Vec<String>, String, bool)> {
    let name = wide(volume)?;
    let mut serial = 0;
    let mut flags = 0;
    if unsafe {
        GetVolumeInformationW(
            name.as_ptr(),
            std::ptr::null_mut(),
            0,
            &mut serial,
            std::ptr::null_mut(),
            &mut flags,
            std::ptr::null_mut(),
            0,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // match Windows' existing `vol` serial format used by sync registrations.
    Ok((
        mount_paths(volume)?,
        format!("{:04X}-{:04X}", serial >> 16, serial & 0xffff),
        flags & FILE_READ_ONLY_VOLUME != 0,
    ))
}

fn wide(value: &str) -> io::Result<Vec<u16>> {
    if value.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "volume path contains NUL",
        ));
    }
    Ok(value.encode_utf16().chain(Some(0)).collect())
}

fn text(chars: &[u16]) -> io::Result<String> {
    String::from_utf16(chars).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

pub(super) fn mount_paths(volume: &str) -> io::Result<Vec<String>> {
    let name = wide(volume)?;
    let mut buffer = vec![0u16; 256];
    loop {
        let mut needed = 0;
        let success = unsafe {
            GetVolumePathNamesForVolumeNameW(
                name.as_ptr(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                &mut needed,
            )
        };
        if success != 0 {
            return buffer
                .split(|c| *c == 0)
                .take_while(|s| !s.is_empty())
                .map(text)
                .collect();
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(ERROR_MORE_DATA as i32)
            || needed as usize <= buffer.len()
            || needed > 1_048_576
        {
            return Err(error);
        }
        buffer.resize(needed as usize, 0);
    }
}

struct VolumeSearch(HANDLE);
impl Drop for VolumeSearch {
    fn drop(&mut self) {
        unsafe {
            FindVolumeClose(self.0);
        }
    }
}

pub(super) fn read_mounts() -> io::Result<Vec<super::mounts::Mount>> {
    let mut name = vec![0u16; 1024];
    let handle = unsafe { FindFirstVolumeW(name.as_mut_ptr(), name.len() as u32) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let search = VolumeSearch(handle);
    let mut mounts = Vec::new();
    loop {
        let end = name
            .iter()
            .position(|c| *c == 0)
            .ok_or_else(|| io::Error::other("unterminated Windows volume name"))?;
        let device = text(&name[..end])?;
        for path in mount_paths(&device)? {
            mounts.push(super::mounts::Mount {
                device: device.clone(),
                path: std::fs::canonicalize(path)?,
            });
        }
        if unsafe { FindNextVolumeW(search.0, name.as_mut_ptr(), name.len() as u32) } == 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
                break;
            }
            return Err(error);
        }
    }
    Ok(mounts)
}

pub(super) fn mount_matches(mount: &super::mounts::Mount, expected: &str) -> io::Result<bool> {
    let mut path = mount.path.to_string_lossy().into_owned();
    if !path.ends_with('\\') {
        path.push('\\');
    }
    let path = wide(&path)?;
    let mut name = vec![0u16; 1024];
    if unsafe {
        GetVolumeNameForVolumeMountPointW(path.as_ptr(), name.as_mut_ptr(), name.len() as u32)
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let end = name
        .iter()
        .position(|c| *c == 0)
        .ok_or_else(|| io::Error::other("unterminated Windows volume name"))?;
    let current = text(&name[..end])?;
    Ok(current.eq_ignore_ascii_case(expected) && current.eq_ignore_ascii_case(&mount.device))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_paths_preserve_spaces_and_reject_nul_or_invalid_encoding() {
        let path = r"C:\USB music\";
        let encoded = wide(path).unwrap();
        assert_eq!(text(&encoded[..encoded.len() - 1]).unwrap(), path);
        assert!(wide("E:\\\0other").is_err());
        assert!(text(&[0xd800]).is_err());
    }

    #[test]
    #[ignore = "read-only mount probe on a Windows host"]
    fn host_mounts_are_bound_to_their_current_volume_guid() {
        let mounts = read_mounts().unwrap();
        assert!(!mounts.is_empty());
        for mount in mounts {
            assert!(mount_matches(&mount, &mount.device).unwrap());
            assert!(
                !mount_matches(&mount, r"\\?\Volume{00000000-0000-0000-0000-000000000000}\")
                    .unwrap()
            );
        }
    }
}
