//! Music waveform generation utilities
//!
//! This module provides functionality for generating visual waveform representations
//! of audio files and storing them as PNG bytea in the database.

use image::{ImageBuffer, Rgb, RgbImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
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
        let width = self.config.width;
        let height = self.config.height;

        // Parse colors
        let waveform_color = self.parse_color(&self.config.color)?;
        let bg_color = self.parse_color(&self.config.background_color)?;

        // Create image buffer
        let mut img: RgbImage = ImageBuffer::new(width, height);

        // Fill background
        for pixel in img.pixels_mut() {
            *pixel = Rgb([bg_color.0, bg_color.1, bg_color.2]);
        }

        // Calculate waveform points
        let samples_per_pixel = audio_samples.samples.len() / width as usize;
        let samples_per_pixel = samples_per_pixel.max(1);

        for x in 0..width {
            let start_sample = (x as usize) * samples_per_pixel;
            let end_sample =
                ((x as usize + 1) * samples_per_pixel).min(audio_samples.samples.len());

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
            let max_y_offset = (center_y as f32 * 0.9) as u32; // Leave some margin

            let min_y = center_y - ((-min_amp * max_y_offset as f32) as u32).min(max_y_offset);
            let max_y = center_y - ((max_amp * max_y_offset as f32) as u32).min(max_y_offset);

            // Draw vertical line for this pixel column
            for y in min_y..=max_y {
                if y < height {
                    img.put_pixel(
                        x,
                        y,
                        Rgb([waveform_color.0, waveform_color.1, waveform_color.2]),
                    );
                }
            }
        }

        // Convert to PNG bytes using the image crate
        let mut png_data = Vec::new();
        let mut cursor = Cursor::new(&mut png_data);

        img.write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| WaveformError::InvalidParameters(format!("PNG encoding failed: {}", e)))?;

        Ok(png_data)
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
