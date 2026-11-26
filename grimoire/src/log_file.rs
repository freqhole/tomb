use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// a shared, line-bounded log writer. old lines are removed in batches so
/// steady logging does not require rewriting the file for every event.
#[derive(Clone)]
pub struct LogFile(Arc<Mutex<State>>);

struct State {
    file: File,
    max_lines: usize,
    lines: usize,
    ends_in_newline: bool,
    size: u64,
    modified: Option<std::time::SystemTime>,
}

impl LogFile {
    pub fn open(path: &Path, max_lines: usize) -> io::Result<Self> {
        if max_lines == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "log max_lines must be positive",
            ));
        }
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(path)?;
        let mut state = State {
            file,
            max_lines,
            lines: 0,
            ends_in_newline: true,
            size: 0,
            modified: None,
        };
        state.file.lock()?;
        let result = state.refresh();
        let unlock = state.file.unlock();
        result.and(unlock)?;
        Ok(Self(Arc::new(Mutex::new(state))))
    }
}

impl State {
    fn refresh(&mut self) -> io::Result<()> {
        let size = self.file.metadata()?.len();
        let mut end = size;
        let mut remaining = self.max_lines;
        let mut buffer = [0; 8192];
        let mut start = 0;
        let mut last_byte = None;
        while end > 0 {
            let len = end.min(buffer.len() as u64) as usize;
            end -= len as u64;
            self.file.seek(SeekFrom::Start(end))?;
            self.file.read_exact(&mut buffer[..len])?;
            if last_byte.is_none() {
                last_byte = Some(buffer[len - 1]);
            }
            for i in (0..len).rev() {
                if buffer[i] == b'\n' && end + i as u64 + 1 < size {
                    remaining -= 1;
                    if remaining == 0 {
                        start = end + i as u64 + 1;
                        break;
                    }
                }
            }
            if start != 0 {
                break;
            }
        }
        if start > 0 {
            let mut read_at = start;
            let mut write_at = 0;
            while read_at < size {
                let len = (size - read_at).min(buffer.len() as u64) as usize;
                self.file.seek(SeekFrom::Start(read_at))?;
                self.file.read_exact(&mut buffer[..len])?;
                self.file.seek(SeekFrom::Start(write_at))?;
                self.file.write_all(&buffer[..len])?;
                read_at += len as u64;
                write_at += len as u64;
            }
            self.file.set_len(size - start)?;
        }
        self.ends_in_newline = last_byte.is_none_or(|b| b == b'\n');
        self.lines = if size == 0 {
            0
        } else if start > 0 {
            self.max_lines
        } else {
            self.max_lines - remaining + 1
        };
        let metadata = self.file.metadata()?;
        self.size = metadata.len();
        self.modified = Some(metadata.modified()?);
        Ok(())
    }

    fn append(&mut self, data: &[u8]) -> io::Result<()> {
        self.file.lock()?;
        let result = (|| {
            let metadata = self.file.metadata()?;
            if metadata.len() != self.size || Some(metadata.modified()?) != self.modified {
                self.refresh()?;
            }
            self.file.seek(SeekFrom::End(0))?;
            self.file.write_all(data)?;
            if !data.is_empty() {
                if self.ends_in_newline {
                    self.lines += 1;
                }
                self.lines += data
                    .iter()
                    .take(data.len() - 1)
                    .filter(|&&b| b == b'\n')
                    .count();
                self.ends_in_newline = data.last() == Some(&b'\n');
            }
            if self.lines > self.max_lines {
                let max_lines = self.max_lines;
                self.max_lines = (max_lines - max_lines / 10).max(1);
                let result = self.refresh();
                self.max_lines = max_lines;
                result?;
            } else {
                let metadata = self.file.metadata()?;
                self.size = metadata.len();
                self.modified = Some(metadata.modified()?);
            }
            Ok(())
        })();
        let unlock = self.file.unlock();
        result.and(unlock)
    }
}

impl Write for LogFile {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.0
            .lock()
            .map_err(|_| io::Error::other("log writer lock poisoned"))?
            .append(data)?;
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogFile {
    type Writer = LogFile;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_existing_and_new_lines_including_partial_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.log");
        std::fs::write(&path, "old\none\ntwo\nthree\n").unwrap();
        let mut log = LogFile::open(&path, 3).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo\nthree\n");
        write!(log, "fo").unwrap();
        write!(log, "ur\nfive\nsix").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "four\nfive\nsix");
        writeln!(log, "!").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "four\nfive\nsix!\n"
        );
    }

    #[test]
    fn separate_handles_coordinate_and_keep_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.log");
        let mut a = LogFile::open(&path, 2).unwrap();
        let mut b = LogFile::open(&path, 2).unwrap();
        writeln!(a, "one").unwrap();
        writeln!(b, "two").unwrap();
        writeln!(a, "three").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "two\nthree\n");
    }

    #[test]
    fn rejects_zero_limit() {
        let dir = tempfile::tempdir().unwrap();
        assert!(LogFile::open(&dir.path().join("test.log"), 0).is_err());
    }

    #[test]
    fn trims_a_large_file_and_handles_lines_spanning_read_blocks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.log");
        let old = "old line\n".repeat(100_000);
        let long_line = "x".repeat(20_000);
        std::fs::write(&path, format!("{old}{long_line}\nlast")).unwrap();
        let mut log = LogFile::open(&path, 2).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            format!("{long_line}\nlast")
        );
        write!(log, "\nnext\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "last\nnext\n");
    }

    #[test]
    fn remains_within_limit_during_sustained_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.log");
        let mut log = LogFile::open(&path, 100).unwrap();
        for i in 0..500 {
            log.write_all(format!("{i}\n").as_bytes()).unwrap();
            let content = std::fs::read_to_string(&path).unwrap();
            assert!(content.lines().count() <= 100);
            assert_eq!(content.lines().last(), Some(i.to_string().as_str()));
        }
    }
}
