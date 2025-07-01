//! File hashing utilities for music files
//!
//! This module provides SHA256 hashing functionality for audio files,
//! extracted and cleaned up from the original file_walker implementation.

use sha2::{Digest, Sha256};
use std::path::Path;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

/// Default buffer size for file reading (4KB)
const DEFAULT_BUFFER_SIZE: usize = 4096;

/// Errors that can occur during file hashing
#[derive(Debug, Error)]
pub enum HasherError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Invalid file path: {0}")]
    InvalidPath(String),
    #[error("Task join error: {0}")]
    TaskJoinError(#[from] tokio::task::JoinError),
}

/// File hasher for generating SHA256 hashes
pub struct FileHasher {
    buffer_size: usize,
}

impl FileHasher {
    /// Create a new file hasher with default buffer size
    pub fn new() -> Self {
        Self {
            buffer_size: DEFAULT_BUFFER_SIZE,
        }
    }

    /// Create a new file hasher with custom buffer size
    pub fn with_buffer_size(buffer_size: usize) -> Self {
        Self { buffer_size }
    }

    /// Generate SHA256 hash for a file, returning base64-encoded result
    pub async fn hash_file<P: AsRef<Path>>(&self, path: P) -> Result<String, HasherError> {
        let path = path.as_ref();
        let mut file = File::open(path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; self.buffer_size];

        loop {
            let bytes_read = file.read(&mut buffer).await?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let hash = hasher.finalize();
        Ok(format!("{:x}", hash))
    }

    /// Generate SHA256 hash for file content bytes
    pub fn hash_bytes(&self, content: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content);
        let hash = hasher.finalize();
        format!("{:x}", hash)
    }

    /// Verify that a file matches the expected hash
    pub async fn verify_file<P: AsRef<Path>>(
        &self,
        path: P,
        expected_hash: &str,
    ) -> Result<bool, HasherError> {
        let actual_hash = self.hash_file(path).await?;
        Ok(actual_hash == expected_hash)
    }
}

impl Default for FileHasher {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience function to hash a file with default settings
pub async fn hash_file<P: AsRef<Path>>(path: P) -> Result<String, HasherError> {
    let hasher = FileHasher::new();
    hasher.hash_file(path).await
}

/// Convenience function to hash bytes with default settings
pub fn hash_bytes(content: &[u8]) -> String {
    let hasher = FileHasher::new();
    hasher.hash_bytes(content)
}

/// Hash multiple files in parallel
pub async fn hash_files_parallel<P: AsRef<Path>>(
    paths: Vec<P>,
) -> Result<Vec<(String, String)>, HasherError> {
    let _hasher = FileHasher::new();
    let mut handles = Vec::new();

    for path in paths {
        let path_str = path.as_ref().to_string_lossy().to_string();
        let hasher = FileHasher::new(); // Each task gets its own hasher

        let handle = tokio::spawn(async move {
            let hash = hasher.hash_file(&path_str).await?;
            Ok::<_, HasherError>((path_str, hash))
        });

        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        let (path, hash) = handle.await??;
        results.push((path, hash));
    }

    Ok(results)
}

/// Calculate hash for a portion of a file (useful for deduplication)
pub async fn hash_file_chunk<P: AsRef<Path>>(
    path: P,
    offset: u64,
    length: u64,
) -> Result<String, HasherError> {
    use tokio::io::{AsyncSeekExt, SeekFrom};

    let path = path.as_ref();
    let mut file = File::open(path).await?;
    file.seek(SeekFrom::Start(offset)).await?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; DEFAULT_BUFFER_SIZE];
    let mut remaining = length;

    while remaining > 0 {
        let to_read = std::cmp::min(remaining, buffer.len() as u64) as usize;
        let bytes_read = file.read(&mut buffer[..to_read]).await?;

        if bytes_read == 0 {
            break; // EOF reached
        }

        hasher.update(&buffer[..bytes_read]);
        remaining -= bytes_read as u64;
    }

    let hash = hasher.finalize();
    Ok(format!("{:x}", hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use tokio::fs;

    #[tokio::test]
    async fn test_hash_file() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = b"Hello, World!";

        fs::write(temp_file.path(), test_content).await.unwrap();

        let hasher = FileHasher::new();
        let hash = hasher.hash_file(temp_file.path()).await.unwrap();

        // Verify hash is not empty and has expected format
        assert!(!hash.is_empty());
        assert!(hash.len() > 32); // Base64 encoded SHA256 should be longer than 32 chars
    }

    #[test]
    fn test_hash_bytes() {
        let hasher = FileHasher::new();
        let content = b"Hello, World!";
        let hash1 = hasher.hash_bytes(content);
        let hash2 = hasher.hash_bytes(content);

        // Same content should produce same hash
        assert_eq!(hash1, hash2);

        // Different content should produce different hash
        let different_content = b"Hello, Universe!";
        let hash3 = hasher.hash_bytes(different_content);
        assert_ne!(hash1, hash3);
    }

    #[tokio::test]
    async fn test_verify_file() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = b"Test content for verification";

        fs::write(temp_file.path(), test_content).await.unwrap();

        let hasher = FileHasher::new();
        let hash = hasher.hash_file(temp_file.path()).await.unwrap();

        // Verification should succeed with correct hash
        assert!(hasher.verify_file(temp_file.path(), &hash).await.unwrap());

        // Verification should fail with incorrect hash
        let wrong_hash = "wrong_hash_value";
        assert!(!hasher
            .verify_file(temp_file.path(), wrong_hash)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn test_convenience_functions() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = b"Convenience test content";

        fs::write(temp_file.path(), test_content).await.unwrap();

        // Test convenience hash_file function
        let hash1 = hash_file(temp_file.path()).await.unwrap();

        // Test convenience hash_bytes function
        let hash2 = hash_bytes(test_content);

        // Both should produce the same result
        assert_eq!(hash1, hash2);
    }

    #[tokio::test]
    async fn test_hash_files_parallel() {
        let mut temp_files = Vec::new();
        let test_contents = vec![b"File 1", b"File 2", b"File 3"];

        // Create test files
        for content in &test_contents {
            let temp_file = NamedTempFile::new().unwrap();
            fs::write(temp_file.path(), content).await.unwrap();
            temp_files.push(temp_file);
        }

        let paths: Vec<_> = temp_files.iter().map(|f| f.path()).collect();
        let results = hash_files_parallel(paths).await.unwrap();

        assert_eq!(results.len(), 3);

        // Each file should have a unique hash
        let hashes: Vec<_> = results.iter().map(|(_, hash)| hash.clone()).collect();
        let unique_hashes: std::collections::HashSet<_> = hashes.iter().collect();
        assert_eq!(unique_hashes.len(), 3);
    }

    #[tokio::test]
    async fn test_hash_file_chunk() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = b"0123456789abcdefghijklmnopqrstuvwxyz";

        fs::write(temp_file.path(), test_content).await.unwrap();

        // Hash first 10 bytes
        let chunk_hash = hash_file_chunk(temp_file.path(), 0, 10).await.unwrap();

        // Hash the same content directly
        let direct_hash = hash_bytes(&test_content[0..10]);

        assert_eq!(chunk_hash, direct_hash);
    }

    #[tokio::test]
    async fn test_custom_buffer_size() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = vec![0u8; 10000]; // 10KB file

        fs::write(temp_file.path(), &test_content).await.unwrap();

        let hasher_small = FileHasher::with_buffer_size(512);
        let hasher_large = FileHasher::with_buffer_size(8192);

        let hash1 = hasher_small.hash_file(temp_file.path()).await.unwrap();
        let hash2 = hasher_large.hash_file(temp_file.path()).await.unwrap();

        // Different buffer sizes should produce same hash
        assert_eq!(hash1, hash2);
    }

    #[tokio::test]
    async fn test_empty_file() {
        let temp_file = NamedTempFile::new().unwrap();
        // File is created but empty

        let hasher = FileHasher::new();
        let hash = hasher.hash_file(temp_file.path()).await.unwrap();

        // Empty file should still produce a valid hash
        assert!(!hash.is_empty());

        // Should match hash of empty bytes
        let empty_hash = hasher.hash_bytes(&[]);
        assert_eq!(hash, empty_hash);
    }
}
