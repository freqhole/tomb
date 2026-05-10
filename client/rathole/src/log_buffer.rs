//! in-memory ring buffer that mirrors the file-logging layer.
//! used by the `/logs` slash command to dump recent log lines into
//! the result panel without having to read + tail the rathole.log
//! file from disk (which would also miss everything that happened
//! before the user opened it).
//!
//! the buffer is a process-wide singleton (set at log-init time) so
//! both the tracing layer and the slash handler can reach it. lines
//! are stored as already-formatted strings so the slash handler is
//! cheap and doesn't need to know anything about tracing's event
//! shape.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::{Arc, Mutex, OnceLock};

/// max number of lines retained in the ring buffer. ~2k lines is
/// enough for an interactive `/logs` view without ballooning memory
/// (each line is typically <300 bytes -> ~600 KiB worst case).
const RING_CAPACITY: usize = 2048;

/// shared in-memory ring buffer. a `VecDeque<String>` behind a
/// mutex; new lines push to the back, oldest lines drop off the
/// front. cheap to clone the `Arc`, but each push briefly takes
/// the lock.
#[derive(Clone, Default)]
pub struct LogBuffer {
    inner: Arc<Mutex<VecDeque<String>>>,
}

impl LogBuffer {
    fn with_capacity(cap: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(VecDeque::with_capacity(cap))),
        }
    }

    fn push_line(&self, line: String) {
        if let Ok(mut q) = self.inner.lock() {
            if q.len() == RING_CAPACITY {
                q.pop_front();
            }
            q.push_back(line);
        }
    }

    /// snapshot the buffer as a `Vec<String>` ordered oldest-first.
    /// caller can then take the tail / search / format as needed.
    pub fn snapshot(&self) -> Vec<String> {
        match self.inner.lock() {
            Ok(q) => q.iter().cloned().collect(),
            Err(_) => Vec::new(),
        }
    }
}

static GLOBAL: OnceLock<LogBuffer> = OnceLock::new();

/// install the process-wide ring buffer. idempotent: subsequent
/// calls return the buffer already in place.
pub fn install() -> LogBuffer {
    GLOBAL
        .get_or_init(|| LogBuffer::with_capacity(RING_CAPACITY))
        .clone()
}

/// fetch the global buffer if it's been installed. returns `None`
/// when called before `install()` (e.g. the wasm shell or unit
/// tests that don't init logging).
pub fn global() -> Option<LogBuffer> {
    GLOBAL.get().cloned()
}

/// `MakeWriter` impl so the buffer can be plugged into a
/// `tracing_subscriber::fmt::layer().with_writer(...)`. each
/// formatted event arrives as a single `write_all` call from
/// tracing's fmt layer, so we treat each writer instance as one
/// line and push on drop.
impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogBuffer {
    type Writer = LineWriter;

    fn make_writer(&'a self) -> Self::Writer {
        LineWriter {
            buf: Vec::with_capacity(256),
            sink: self.clone(),
        }
    }
}

pub struct LineWriter {
    buf: Vec<u8>,
    sink: LogBuffer,
}

impl Write for LineWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for LineWriter {
    fn drop(&mut self) {
        if self.buf.is_empty() {
            return;
        }
        // strip the trailing newline tracing-fmt always appends so
        // each ring entry maps cleanly to one displayed line.
        let mut s = String::from_utf8_lossy(&self.buf).into_owned();
        while s.ends_with('\n') || s.ends_with('\r') {
            s.pop();
        }
        if !s.is_empty() {
            self.sink.push_line(s);
        }
    }
}
