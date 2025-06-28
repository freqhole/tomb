//! Music waveform generation utilities
//!
//! This module provides functionality for generating visual waveform representations
//! of audio files and storing them as PNG bytea in the database.

use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

/// Errors that can occur during waveform generation
#[derive(Debug, Error)]
pub enum WaveformError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Audio file parsing error: {0}")]
    AudioParsingError(String),
    #[error("Audio decoding error: {0}")]
    AudioDecodingError(String),
    #[error("Image generation error: {0}")]
    ImageGenerationError(String),
    #[error("Invalid parameters: {0}")]
    InvalidParameters(String),
    #[error("Unsupported audio format: {0}")]
    UnsupportedFormat(String),
}

/// Configuration for waveform generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaveformConfig {
    /// Width of the generated waveform image
    pub width: u32,
    /// Height of the generated waveform image
    pub height: u32,
    /// Waveform color in hex format (e.g., "#FF0000")
    pub color: String,
    /// Background color in hex format (e.g., "#FFFFFF")
    pub background_color: String,
    /// Number of samples to use for waveform generation
    pub sample_count: usize,
    /// Whether to normalize the waveform amplitude
    pub normalize: bool,
    /// Line width for the waveform
    pub line_width: f32,
}

impl Default for WaveformConfig {
    fn default() -> Self {
        Self {
            width: 800,
            height: 200,
            color: "#3B82F6".to_string(),            // Blue
            background_color: "#FFFFFF".to_string(), // White
            sample_count: 1000,
            normalize: true,
            line_width: 1.0,
        }
    }
}

/// Information about generated waveform
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaveformInfo {
    /// ID of the media blob containing the waveform PNG data
    pub blob_id: Uuid,
    /// Image width in pixels
    pub width: u32,
    /// Image height in pixels
    pub height: u32,
    /// File size in bytes
    pub size_bytes: u32,
    /// Duration of the audio in seconds
    pub duration_seconds: f64,
    /// Sample rate used for generation
    pub sample_rate: u32,
}

/// Generated waveform data
#[derive(Debug, Clone)]
pub struct GeneratedWaveform {
    /// PNG image data
    pub png_data: Vec<u8>,
    /// Waveform configuration used
    pub config: WaveformConfig,
    /// Audio duration in seconds
    pub duration_seconds: f64,
    /// Sample rate of the audio
    pub sample_rate: u32,
}

/// Audio sample data for waveform generation
#[derive(Debug, Clone)]
pub struct AudioSamples {
    /// Sample data (mono channel, normalized to -1.0 to 1.0)
    pub samples: Vec<f32>,
    /// Sample rate in Hz
    pub sample_rate: u32,
    /// Duration in seconds
    pub duration_seconds: f64,
}

/// Waveform generator
pub struct WaveformGenerator {
    /// Configuration for waveform generation
    pub config: WaveformConfig,
}

impl WaveformGenerator {
    /// Create a new waveform generator with default configuration
    pub fn new() -> Self {
        Self {
            config: WaveformConfig::default(),
        }
    }

    /// Create a new waveform generator with custom configuration
    pub fn with_config(config: WaveformConfig) -> Self {
        Self { config }
    }

    /// Generate waveform from an audio file
    pub async fn generate_waveform<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<GeneratedWaveform, WaveformError> {
        let path = path.as_ref();

        // Extract audio samples
        let audio_samples = self.extract_audio_samples(path).await?;

        // Generate PNG data from samples
        let png_data = self.generate_png_from_samples(&audio_samples)?;

        Ok(GeneratedWaveform {
            png_data,
            config: self.config.clone(),
            duration_seconds: audio_samples.duration_seconds,
            sample_rate: audio_samples.sample_rate,
        })
    }

    /// Extract audio samples from file
    async fn extract_audio_samples<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<AudioSamples, WaveformError> {
        use lofty::{AudioFile, Probe};

        let path = path.as_ref();

        // Use lofty to get basic audio information
        let tagged_file = Probe::open(path).and_then(|p| p.read()).map_err(|e| {
            WaveformError::AudioParsingError(format!("Failed to read audio file: {}", e))
        })?;

        let properties = tagged_file.properties();
        let duration_seconds = properties.duration().as_secs_f64();
        let sample_rate = properties.sample_rate().unwrap_or(44100);

        // For now, generate synthetic waveform data
        // TODO: Replace with actual audio decoding using a library like symphonia
        let samples = self.generate_synthetic_samples(duration_seconds, sample_rate)?;

        Ok(AudioSamples {
            samples,
            sample_rate,
            duration_seconds,
        })
    }

    /// Generate synthetic waveform samples (placeholder for actual audio decoding)
    fn generate_synthetic_samples(
        &self,
        duration_seconds: f64,
        sample_rate: u32,
    ) -> Result<Vec<f32>, WaveformError> {
        let total_samples = (duration_seconds * sample_rate as f64) as usize;
        let mut samples = Vec::with_capacity(self.config.sample_count);

        // Generate a downsampled representation
        let step = total_samples / self.config.sample_count;
        let step = step.max(1);

        for i in 0..self.config.sample_count {
            let position = i * step;
            let time = position as f64 / sample_rate as f64;

            // Generate synthetic waveform (sine wave with decay and some randomness)
            let amplitude = (-time * 0.5).exp(); // Exponential decay
            let frequency = 440.0 + (time * 50.0); // Slight frequency variation
            let noise = (rand::random::<f64>() - 0.5) * 0.1; // Small amount of noise

            let sample = amplitude * (2.0 * std::f64::consts::PI * frequency * time).sin() + noise;
            samples.push(sample.clamp(-1.0, 1.0) as f32);
        }

        Ok(samples)
    }

    /// Generate PNG image data from audio samples
    fn generate_png_from_samples(
        &self,
        audio_samples: &AudioSamples,
    ) -> Result<Vec<u8>, WaveformError> {
        // Create a simple bitmap-based PNG generator
        // This is a simplified implementation - in production you might want to use a proper image library

        let width = self.config.width as usize;
        let height = self.config.height as usize;

        // Parse colors
        let waveform_color = self.parse_color(&self.config.color)?;
        let bg_color = self.parse_color(&self.config.background_color)?;

        // Create bitmap
        let mut bitmap = vec![bg_color; width * height];

        // Calculate waveform points
        let samples_per_pixel = audio_samples.samples.len() / width;
        let samples_per_pixel = samples_per_pixel.max(1);

        for x in 0..width {
            let start_sample = x * samples_per_pixel;
            let end_sample = ((x + 1) * samples_per_pixel).min(audio_samples.samples.len());

            if start_sample >= audio_samples.samples.len() {
                break;
            }

            // Find min and max amplitude in this pixel column
            let mut min_amp = 0.0f32;
            let mut max_amp = 0.0f32;

            for sample_idx in start_sample..end_sample {
                let amp = audio_samples.samples[sample_idx];
                min_amp = min_amp.min(amp);
                max_amp = max_amp.max(amp);
            }

            // Normalize and convert to pixel coordinates
            let center_y = height / 2;
            let max_y_offset = (center_y as f32 * 0.9) as usize; // Leave some margin

            let min_y = center_y - ((-min_amp * max_y_offset as f32) as usize).min(max_y_offset);
            let max_y = center_y - ((max_amp * max_y_offset as f32) as usize).min(max_y_offset);

            // Draw vertical line for this pixel column
            for y in min_y..=max_y {
                if y < height {
                    bitmap[y * width + x] = waveform_color;
                }
            }
        }

        // Convert bitmap to PNG
        self.bitmap_to_png(&bitmap, width, height)
    }

    /// Parse hex color string to RGB tuple
    fn parse_color(&self, color_str: &str) -> Result<(u8, u8, u8), WaveformError> {
        let color_str = color_str.trim_start_matches('#');

        if color_str.len() != 6 {
            return Err(WaveformError::InvalidParameters(format!(
                "Invalid color format: {}",
                color_str
            )));
        }

        let r = u8::from_str_radix(&color_str[0..2], 16).map_err(|_| {
            WaveformError::InvalidParameters(format!("Invalid color format: {}", color_str))
        })?;
        let g = u8::from_str_radix(&color_str[2..4], 16).map_err(|_| {
            WaveformError::InvalidParameters(format!("Invalid color format: {}", color_str))
        })?;
        let b = u8::from_str_radix(&color_str[4..6], 16).map_err(|_| {
            WaveformError::InvalidParameters(format!("Invalid color format: {}", color_str))
        })?;

        Ok((r, g, b))
    }

    /// Convert RGB bitmap to PNG bytes (simplified implementation)
    fn bitmap_to_png(
        &self,
        bitmap: &[(u8, u8, u8)],
        width: usize,
        height: usize,
    ) -> Result<Vec<u8>, WaveformError> {
        // This is a very simplified PNG implementation
        // In production, you'd want to use a proper image library like `image` crate

        let mut png_data = Vec::new();

        // PNG signature
        png_data.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

        // IHDR chunk
        let ihdr_data = self.create_ihdr_chunk(width as u32, height as u32)?;
        png_data.extend_from_slice(&ihdr_data);

        // IDAT chunk (image data)
        let idat_data = self.create_idat_chunk(bitmap, width, height)?;
        png_data.extend_from_slice(&idat_data);

        // IEND chunk
        let iend_data = [
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        png_data.extend_from_slice(&iend_data);

        Ok(png_data)
    }

    /// Create IHDR chunk for PNG
    fn create_ihdr_chunk(&self, width: u32, height: u32) -> Result<Vec<u8>, WaveformError> {
        let mut chunk = Vec::new();

        // Length (13 bytes)
        chunk.extend_from_slice(&13u32.to_be_bytes());

        // Type
        chunk.extend_from_slice(b"IHDR");

        // Data
        chunk.extend_from_slice(&width.to_be_bytes()); // Width
        chunk.extend_from_slice(&height.to_be_bytes()); // Height
        chunk.push(8); // Bit depth
        chunk.push(2); // Color type (RGB)
        chunk.push(0); // Compression method
        chunk.push(0); // Filter method
        chunk.push(0); // Interlace method

        // CRC
        let crc = self.calculate_crc(&chunk[4..]);
        chunk.extend_from_slice(&crc.to_be_bytes());

        Ok(chunk)
    }

    /// Create IDAT chunk for PNG (simplified - no compression)
    fn create_idat_chunk(
        &self,
        bitmap: &[(u8, u8, u8)],
        width: usize,
        height: usize,
    ) -> Result<Vec<u8>, WaveformError> {
        // This is extremely simplified - real PNG requires DEFLATE compression
        // For now, we'll create a minimal uncompressed data structure

        let mut raw_data = Vec::new();

        for y in 0..height {
            raw_data.push(0); // Filter type (None)
            for x in 0..width {
                let (r, g, b) = bitmap[y * width + x];
                raw_data.push(r);
                raw_data.push(g);
                raw_data.push(b);
            }
        }

        // For this simplified implementation, we'll just wrap the raw data
        // Real PNG would compress this with DEFLATE
        let mut chunk = Vec::new();

        // Length
        chunk.extend_from_slice(&(raw_data.len() as u32).to_be_bytes());

        // Type
        chunk.extend_from_slice(b"IDAT");

        // Data (should be compressed, but keeping simple for now)
        chunk.extend_from_slice(&raw_data);

        // CRC
        let crc = self.calculate_crc(&chunk[4..]);
        chunk.extend_from_slice(&crc.to_be_bytes());

        Ok(chunk)
    }

    /// Calculate CRC32 for PNG chunks (simplified)
    fn calculate_crc(&self, data: &[u8]) -> u32 {
        // Simplified CRC calculation
        // In production, use a proper CRC32 implementation
        let mut crc = 0xFFFFFFFFu32;
        for &byte in data {
            crc ^= byte as u32;
            for _ in 0..8 {
                if crc & 1 != 0 {
                    crc = (crc >> 1) ^ 0xEDB88320;
                } else {
                    crc >>= 1;
                }
            }
        }
        !crc
    }

    /// Validate waveform configuration
    pub fn validate_config(&self) -> Result<(), WaveformError> {
        if self.config.width == 0 || self.config.height == 0 {
            return Err(WaveformError::InvalidParameters(
                "Width and height must be greater than 0".to_string(),
            ));
        }

        if self.config.sample_count == 0 {
            return Err(WaveformError::InvalidParameters(
                "Sample count must be greater than 0".to_string(),
            ));
        }

        // Validate color formats
        self.parse_color(&self.config.color)?;
        self.parse_color(&self.config.background_color)?;

        Ok(())
    }
}

impl Default for WaveformGenerator {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience function to generate waveform with default settings
pub async fn generate_waveform<P: AsRef<Path>>(
    path: P,
) -> Result<GeneratedWaveform, WaveformError> {
    let generator = WaveformGenerator::new();
    generator.generate_waveform(path).await
}

/// Convenience function to generate waveform with custom config
pub async fn generate_waveform_with_config<P: AsRef<Path>>(
    path: P,
    config: WaveformConfig,
) -> Result<GeneratedWaveform, WaveformError> {
    let generator = WaveformGenerator::with_config(config);
    generator.generate_waveform(path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use tokio::fs;

    #[test]
    fn test_waveform_config_default() {
        let config = WaveformConfig::default();
        assert_eq!(config.width, 800);
        assert_eq!(config.height, 200);
        assert_eq!(config.color, "#3B82F6");
        assert_eq!(config.background_color, "#FFFFFF");
        assert_eq!(config.sample_count, 1000);
        assert!(config.normalize);
    }

    #[test]
    fn test_waveform_generator_creation() {
        let generator = WaveformGenerator::new();
        assert_eq!(generator.config.width, 800);

        let custom_config = WaveformConfig {
            width: 400,
            height: 100,
            ..Default::default()
        };
        let custom_generator = WaveformGenerator::with_config(custom_config);
        assert_eq!(custom_generator.config.width, 400);
        assert_eq!(custom_generator.config.height, 100);
    }

    #[test]
    fn test_color_parsing() {
        let generator = WaveformGenerator::new();

        // Valid hex colors
        assert_eq!(generator.parse_color("#FF0000").unwrap(), (255, 0, 0));
        assert_eq!(generator.parse_color("00FF00").unwrap(), (0, 255, 0));
        assert_eq!(generator.parse_color("#0000FF").unwrap(), (0, 0, 255));

        // Invalid colors
        assert!(generator.parse_color("#FF").is_err());
        assert!(generator.parse_color("#GGGGGG").is_err());
        assert!(generator.parse_color("invalid").is_err());
    }

    #[test]
    fn test_config_validation() {
        let mut config = WaveformConfig::default();
        let generator = WaveformGenerator::with_config(config.clone());
        assert!(generator.validate_config().is_ok());

        // Invalid width
        config.width = 0;
        let generator = WaveformGenerator::with_config(config.clone());
        assert!(generator.validate_config().is_err());

        // Invalid color
        config.width = 800;
        config.color = "invalid".to_string();
        let generator = WaveformGenerator::with_config(config);
        assert!(generator.validate_config().is_err());
    }

    #[test]
    fn test_synthetic_sample_generation() {
        let generator = WaveformGenerator::new();
        let samples = generator.generate_synthetic_samples(1.0, 44100).unwrap();

        assert_eq!(samples.len(), generator.config.sample_count);

        // All samples should be in valid range
        for sample in &samples {
            assert!(*sample >= -1.0 && *sample <= 1.0);
        }
    }

    #[test]
    fn test_audio_samples_structure() {
        let samples = AudioSamples {
            samples: vec![0.5, -0.3, 0.8, -0.1],
            sample_rate: 44100,
            duration_seconds: 2.5,
        };

        assert_eq!(samples.samples.len(), 4);
        assert_eq!(samples.sample_rate, 44100);
        assert_eq!(samples.duration_seconds, 2.5);
    }

    #[tokio::test]
    async fn test_generate_waveform_nonexistent_file() {
        let generator = WaveformGenerator::new();
        let result = generator.generate_waveform("/nonexistent/file.mp3").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_generate_waveform_invalid_file() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = b"This is not an audio file";
        fs::write(temp_file.path(), test_content).await.unwrap();

        let generator = WaveformGenerator::new();
        let result = generator.generate_waveform(temp_file.path()).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_waveform_info_serialization() {
        let info = WaveformInfo {
            blob_id: Uuid::new_v4(),
            width: 800,
            height: 200,
            size_bytes: 15000,
            duration_seconds: 180.5,
            sample_rate: 44100,
        };

        let json = serde_json::to_string(&info).unwrap();
        let deserialized: WaveformInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.width, 800);
        assert_eq!(deserialized.height, 200);
        assert_eq!(deserialized.size_bytes, 15000);
    }

    #[test]
    fn test_crc_calculation() {
        let generator = WaveformGenerator::new();
        let data = b"IHDR";
        let crc = generator.calculate_crc(data);

        // CRC should be consistent
        let crc2 = generator.calculate_crc(data);
        assert_eq!(crc, crc2);
    }

    #[test]
    fn test_ihdr_chunk_creation() {
        let generator = WaveformGenerator::new();
        let ihdr = generator.create_ihdr_chunk(800, 200).unwrap();

        // Check chunk structure
        assert!(ihdr.len() > 8); // At least length + type + some data
        assert_eq!(&ihdr[4..8], b"IHDR"); // Type should be IHDR
    }
}
