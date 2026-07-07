//! byte-storage abstraction for the opfs blob store.
//!
//! the actor and its state machine are written against these traits so all
//! protocol logic is natively testable with `cargo test` (mirroring
//! reliquary's native-testable conventions): `NativeDir` backs tests with
//! plain in-memory buffers, `OpfsDir` (opfs.rs) backs the browser with
//! `FileSystemSyncAccessHandle` files.
//!
//! the trait shape deliberately mirrors what bao-tree's sync io traits
//! need — positioned reads/writes, length, truncate — plus the few
//! directory operations the store requires (create/open/delete/list).
//! everything is synchronous EXCEPT open/create/delete/list, which need
//! async on OPFS (handle acquisition is promise-based even though reads
//! and writes are sync).

use std::io;

/// a single storage file (data, outboard, or meta sidecar).
///
/// Clone must be cheap and alias the same underlying content (Rc handles).
pub trait BlobFile: Clone {
    fn len(&self) -> io::Result<u64>;
    fn read_exact_at(&self, offset: u64, len: usize) -> io::Result<Vec<u8>>;
    fn write_at(&self, offset: u64, data: &[u8]) -> io::Result<()>;
    fn truncate(&self, len: u64) -> io::Result<()>;
    /// flush to durable storage (no-op where writes are already durable).
    fn flush(&self) -> io::Result<()>;
}

/// a directory of storage files keyed by name.
///
/// names are flat strings like `<hash-hex>.data` / `<hash-hex>.obao` /
/// `<hash-hex>.meta` — no nesting.
#[allow(async_fn_in_trait)] // single-threaded wasm: no Send bounds wanted
pub trait BlobDir {
    type File: BlobFile;

    /// open a file, creating it empty if missing.
    async fn open(&self, name: &str) -> io::Result<Self::File>;
    /// delete a file if it exists (Ok on missing).
    async fn delete(&self, name: &str) -> io::Result<()>;
    /// list all file names in the directory.
    async fn list(&self) -> io::Result<Vec<String>>;
    /// release all held file resources (e.g. cached sync access handles —
    /// which hold exclusive same-origin locks). called on store shutdown so
    /// a successor store over the same directory can open the files.
    fn close_all(&self);
}

// ---------------------------------------------------------------------------
// native impl (cargo test)
// ---------------------------------------------------------------------------

#[cfg(not(target_arch = "wasm32"))]
pub mod native {
    use std::{cell::RefCell, collections::BTreeMap, io, rc::Rc};

    use super::{BlobDir, BlobFile};

    /// grow-on-write in-memory file. shared (Rc) so a NativeDir handing the
    /// same name out twice aliases the same content, like a real fs would.
    #[derive(Clone, Default)]
    pub struct NativeFile(Rc<RefCell<Vec<u8>>>);

    impl BlobFile for NativeFile {
        fn len(&self) -> io::Result<u64> {
            Ok(self.0.borrow().len() as u64)
        }

        fn read_exact_at(&self, offset: u64, len: usize) -> io::Result<Vec<u8>> {
            let data = self.0.borrow();
            let start = offset as usize;
            let end = start + len;
            if end > data.len() {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    format!("read past end: {}..{} of {}", start, end, data.len()),
                ));
            }
            Ok(data[start..end].to_vec())
        }

        fn write_at(&self, offset: u64, buf: &[u8]) -> io::Result<()> {
            let mut data = self.0.borrow_mut();
            let end = offset as usize + buf.len();
            if data.len() < end {
                data.resize(end, 0);
            }
            data[offset as usize..end].copy_from_slice(buf);
            Ok(())
        }

        fn truncate(&self, len: u64) -> io::Result<()> {
            self.0.borrow_mut().truncate(len as usize);
            Ok(())
        }

        fn flush(&self) -> io::Result<()> {
            Ok(())
        }
    }

    /// in-memory directory for native tests.
    #[derive(Clone, Default)]
    pub struct NativeDir {
        files: Rc<RefCell<BTreeMap<String, NativeFile>>>,
    }

    impl NativeDir {
        pub fn new() -> Self {
            Self::default()
        }
    }

    impl BlobDir for NativeDir {
        type File = NativeFile;

        async fn open(&self, name: &str) -> io::Result<NativeFile> {
            Ok(self
                .files
                .borrow_mut()
                .entry(name.to_string())
                .or_default()
                .clone())
        }

        async fn delete(&self, name: &str) -> io::Result<()> {
            self.files.borrow_mut().remove(name);
            Ok(())
        }

        async fn list(&self) -> io::Result<Vec<String>> {
            Ok(self.files.borrow().keys().cloned().collect())
        }

        fn close_all(&self) {
            // in-memory files hold no external resources
        }
    }
}
