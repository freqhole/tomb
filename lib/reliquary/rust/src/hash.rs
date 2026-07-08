//! blake3 content hashing.
//!
//! streaming file hashing (bounded memory regardless of file size) and
//! in-memory byte hashing, shared by every blob store and app-level import
//! path that needs a canonical blake3 hex digest.

use std::path::Path;

use thiserror::Error;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, BufReader};

const CHUNK_SIZE: usize = 64 * 1024;

#[derive(Debug, Error)]
pub enum HashError {
    #[error("failed to open file for hashing: {0}")]
    Open(std::io::Error),
    #[error("failed to read file while hashing: {0}")]
    Read(std::io::Error),
}

/// compute the blake3 hex digest of a file, reading it in fixed-size chunks
/// so memory use stays bounded no matter how large the file is.
pub async fn hash_file(path: &Path) -> Result<String, HashError> {
    let file = File::open(path).await.map_err(HashError::Open)?;
    let mut reader = BufReader::new(file);
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];

    loop {
        let bytes_read = reader.read(&mut buffer).await.map_err(HashError::Read)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hasher.finalize().to_hex().to_string())
}

/// compute the blake3 hex digest of an in-memory byte slice.
pub fn hash_bytes(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_bytes_matches_known_digest() {
        let hash = hash_bytes(b"hello world");
        assert_eq!(hash.len(), 64);
        assert_eq!(
            hash,
            "d74981efa70a0c880b8d8c1985d075dbcbf679b99a5f9914e5aaf96b831a9e24"
        );
    }

    #[tokio::test]
    async fn hash_file_matches_hash_bytes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("sample.bin");
        let data = vec![7u8; CHUNK_SIZE * 3 + 17];
        tokio::fs::write(&path, &data).await.expect("write");

        let expected = hash_bytes(&data);
        let actual = hash_file(&path).await.expect("hash_file");
        assert_eq!(actual, expected);
    }

    #[tokio::test]
    async fn hash_file_missing_path_errors() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("does-not-exist.bin");
        assert!(hash_file(&path).await.is_err());
    }
}
