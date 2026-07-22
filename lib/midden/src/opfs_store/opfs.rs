//! OPFS-backed implementation of the byte-storage traits (wasm-only).
//!
//! files are `FileSystemSyncAccessHandle`s: acquisition is async
//! (promise-based) and worker-only, but reads/writes/truncate/flush are
//! synchronous — exactly what bao-tree's sync io traits need. an open
//! handle holds an exclusive same-origin lock on its file, which doubles
//! as the store's single-owner guarantee.
//!
//! handles are cached per name for the lifetime of the dir (dropping and
//! reopening per call would be slow and would break the lock-as-ownership
//! property); `delete` closes the cached handle first.

use std::{cell::RefCell, collections::HashMap, io, rc::Rc};

use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use web_sys::{
    FileSystemDirectoryHandle, FileSystemFileHandle, FileSystemGetDirectoryOptions,
    FileSystemGetFileOptions, FileSystemReadWriteOptions, FileSystemSyncAccessHandle,
};

use super::storage::{BlobDir, BlobFile};

fn js_io_err(context: &str, e: wasm_bindgen::JsValue) -> io::Error {
    io::Error::other(format!("{context}: {e:?}"))
}

/// resolve the OPFS root and open (creating if needed) a store directory.
/// works in both worker and window scopes, but sync access handles can
/// only be created in a dedicated worker — window contexts fail at open().
pub async fn open_store_dir(dir_name: &str) -> io::Result<FileSystemDirectoryHandle> {
    let global = js_sys::global();
    let storage = if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
        scope.navigator().storage()
    } else if let Some(win) = global.dyn_ref::<web_sys::Window>() {
        win.navigator().storage()
    } else {
        return Err(io::Error::other("no global scope with navigator.storage"));
    };
    let root: FileSystemDirectoryHandle = JsFuture::from(storage.get_directory())
        .await
        .map_err(|e| js_io_err("getDirectory failed (OPFS unavailable?)", e))?
        .dyn_into()
        .map_err(|e| js_io_err("getDirectory returned non-directory", e))?;
    let opts = FileSystemGetDirectoryOptions::new();
    opts.set_create(true);
    let dir: FileSystemDirectoryHandle =
        JsFuture::from(root.get_directory_handle_with_options(dir_name, &opts))
            .await
            .map_err(|e| js_io_err("getDirectoryHandle failed", e))?
            .dyn_into()
            .map_err(|e| js_io_err("getDirectoryHandle returned non-directory", e))?;
    Ok(dir)
}

/// a sync-access-handle file.
#[derive(Clone)]
pub struct OpfsFile {
    sah: Rc<FileSystemSyncAccessHandle>,
}

impl BlobFile for OpfsFile {
    fn len(&self) -> io::Result<u64> {
        let size = self
            .sah
            .get_size()
            .map_err(|e| js_io_err("OPFS getSize failed", e))?;
        Ok(size as u64)
    }

    fn read_exact_at(&self, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        let mut buf = vec![0u8; len];
        let opts = FileSystemReadWriteOptions::new();
        opts.set_at(offset as f64);
        let n = self
            .sah
            .read_with_u8_array_and_options(&mut buf, &opts)
            .map_err(|e| js_io_err("OPFS read failed", e))?;
        if (n as usize) != len {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                format!("short OPFS read: wanted {len}, got {n}"),
            ));
        }
        Ok(buf)
    }

    fn write_at(&self, offset: u64, data: &[u8]) -> io::Result<()> {
        let opts = FileSystemReadWriteOptions::new();
        opts.set_at(offset as f64);
        let n = self
            .sah
            .write_with_u8_array_and_options(data, &opts)
            .map_err(|e| js_io_err("OPFS write failed", e))?;
        if (n as usize) != data.len() {
            return Err(io::Error::other(format!(
                "short OPFS write: wanted {}, wrote {}",
                data.len(),
                n
            )));
        }
        Ok(())
    }

    fn truncate(&self, len: u64) -> io::Result<()> {
        self.sah
            .truncate_with_f64(len as f64)
            .map_err(|e| js_io_err("OPFS truncate failed", e))
    }

    fn flush(&self) -> io::Result<()> {
        self.sah
            .flush()
            .map_err(|e| js_io_err("OPFS flush failed", e))
    }
}

/// an OPFS directory with cached sync access handles.
pub struct OpfsDir {
    dir: FileSystemDirectoryHandle,
    handles: RefCell<HashMap<String, OpfsFile>>,
}

impl OpfsDir {
    pub fn new(dir: FileSystemDirectoryHandle) -> Self {
        Self {
            dir,
            handles: RefCell::new(HashMap::new()),
        }
    }
}

impl BlobDir for OpfsDir {
    type File = OpfsFile;

    async fn open(&self, name: &str) -> io::Result<OpfsFile> {
        if let Some(file) = self.handles.borrow().get(name) {
            return Ok(file.clone());
        }
        let opts = FileSystemGetFileOptions::new();
        opts.set_create(true);
        let fh: FileSystemFileHandle =
            JsFuture::from(self.dir.get_file_handle_with_options(name, &opts))
                .await
                .map_err(|e| js_io_err("getFileHandle failed", e))?
                .dyn_into()
                .map_err(|e| js_io_err("getFileHandle returned non-file", e))?;
        let sah: FileSystemSyncAccessHandle = JsFuture::from(fh.create_sync_access_handle())
            .await
            .map_err(|e| js_io_err("createSyncAccessHandle failed (not in a worker?)", e))?
            .dyn_into()
            .map_err(|e| js_io_err("createSyncAccessHandle returned unexpected type", e))?;
        let file = OpfsFile { sah: Rc::new(sah) };
        self.handles
            .borrow_mut()
            .insert(name.to_string(), file.clone());
        Ok(file)
    }

    async fn delete(&self, name: &str) -> io::Result<()> {
        // close the cached handle first — a held sync access handle locks
        // the file and removeEntry would fail
        if let Some(file) = self.handles.borrow_mut().remove(name) {
            file.sah.close();
        }
        match JsFuture::from(self.dir.remove_entry(name)).await {
            Ok(_) => Ok(()),
            Err(e) => {
                // missing file is fine (NotFoundError)
                let msg = format!("{e:?}");
                if msg.contains("NotFoundError") {
                    Ok(())
                } else {
                    Err(js_io_err("removeEntry failed", e))
                }
            }
        }
    }

    async fn list(&self) -> io::Result<Vec<String>> {
        // FileSystemDirectoryHandle.keys() is an async iterator
        let keys_fn = js_sys::Reflect::get(&self.dir, &"keys".into())
            .map_err(|e| js_io_err("no keys() on directory handle", e))?
            .dyn_into::<js_sys::Function>()
            .map_err(|e| js_io_err("keys is not a function", e))?;
        let iter = keys_fn
            .call0(&self.dir)
            .map_err(|e| js_io_err("keys() call failed", e))?;
        let mut names = Vec::new();
        loop {
            let next_fn = js_sys::Reflect::get(&iter, &"next".into())
                .map_err(|e| js_io_err("no next() on iterator", e))?
                .dyn_into::<js_sys::Function>()
                .map_err(|e| js_io_err("next is not a function", e))?;
            let promise = next_fn
                .call0(&iter)
                .map_err(|e| js_io_err("next() call failed", e))?;
            let result = JsFuture::from(js_sys::Promise::from(promise))
                .await
                .map_err(|e| js_io_err("iterator next rejected", e))?;
            let done = js_sys::Reflect::get(&result, &"done".into())
                .map(|d| d.as_bool().unwrap_or(true))
                .unwrap_or(true);
            if done {
                break;
            }
            if let Some(name) = js_sys::Reflect::get(&result, &"value".into())
                .ok()
                .and_then(|v| v.as_string())
            {
                names.push(name);
            }
        }
        Ok(names)
    }

    fn close_all(&self) {
        for (_, file) in self.handles.borrow_mut().drain() {
            file.sah.close();
        }
    }
}
