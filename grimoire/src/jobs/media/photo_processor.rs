//! photo thumbnail generation and metadata extraction
//!
//! processes uploaded photos:
//! 1. extracts image dimensions
//! 2. extracts EXIF metadata (dates, camera info, GPS, orientation)
//! 3. converts to WebP and creates child blob with sized thumbnails
//! 4. updates the photoz entity with extracted metadata

use crate::blob_data;
use crate::jobs::{Job, JobError};
use crate::media::photoz;
use crate::media_blobz::BlobType;
use image::GenericImageView;
use serde_json::{json, Value};
use std::io::Cursor;
use tracing::{debug, info, warn};

/// process a GeneratePhotoThumbnail job
///
/// extracts EXIF metadata, converts to WebP, creates sized thumbnails,
/// and updates the photo entity with extracted metadata
pub async fn process_generate_photo_thumbnail_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing GeneratePhotoThumbnail job: {}", job.id);

    // parse job parameters
    let params_value: Value = job.parameters()?;
    let params = super::MediaJobParams::from_value(&params_value)?;

    debug!(
        "photo job params: blob_id={}, entity_id={}, mime={}",
        params.blob_id, params.entity_id, params.mime
    );

    // get source image bytes
    let (_blob, data) = super::get_source_bytes(&params.blob_id).await?;
    info!(
        "loaded {} bytes for photo blob {}",
        data.len(),
        params.blob_id
    );

    // extract image dimensions using the image crate
    let img = image::load_from_memory(&data).map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to decode image: {}", e),
    })?;

    let (width, height) = img.dimensions();
    debug!(
        "image dimensions: {}x{} for blob {}",
        width, height, params.blob_id
    );

    // extract EXIF metadata (best-effort — many formats like PNG have no EXIF)
    let exif_metadata = extract_exif_metadata(&data);
    if exif_metadata.is_some() {
        debug!("extracted EXIF metadata for blob {}", params.blob_id);
    } else {
        debug!(
            "no EXIF metadata available for blob {} (mime: {})",
            params.blob_id, params.mime
        );
    }

    let (taken_at, camera_make, camera_model, gps_lat, gps_lon, orientation) = match exif_metadata {
        Some(meta) => (
            meta.taken_at,
            meta.camera_make,
            meta.camera_model,
            meta.gps_lat,
            meta.gps_lon,
            meta.orientation,
        ),
        None => (None, None, None, None, None, None),
    };

    // convert image to WebP
    let webp_data = blob_data::convert_to_webp(&data).map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to convert image to webp: {}", e),
    })?;
    info!(
        "converted photo to webp: {} bytes -> {} bytes for blob {}",
        data.len(),
        webp_data.len(),
        params.blob_id
    );

    // build metadata JSON for the child blob
    let blob_metadata = json!({
        "type": "photo_webp",
        "source_blob_id": params.blob_id,
        "source_mime": params.mime,
        "width": width,
        "height": height,
        "format": "webp",
        "generated_with": "grimoire",
    });

    // create a child blob for the WebP version (this auto-generates sized thumbnails)
    let create_response = blob_data::create_image_blob_from_webp_data(
        webp_data,
        BlobType::Preview,
        Some(params.blob_id.clone()),
        blob_metadata,
        job.created_by.clone(),
    )
    .await;

    let webp_blob_id = if create_response.success {
        let blob_id = create_response
            .data
            .ok_or_else(|| JobError::ProcessingFailed {
                reason: "create_image_blob_from_webp_data returned success but no blob id"
                    .to_string(),
            })?;
        info!(
            "created webp child blob {} for source blob {}",
            blob_id, params.blob_id
        );
        blob_id
    } else {
        return Err(JobError::ProcessingFailed {
            reason: format!(
                "failed to create webp child blob: {}",
                create_response.message
            ),
        });
    };

    // update photo entity with extracted metadata
    match photoz::repository::update_photo_metadata(
        &params.entity_id,
        Some(width as i64),
        Some(height as i64),
        taken_at,
        camera_make.clone(),
        camera_model.clone(),
        gps_lat,
        gps_lon,
        orientation,
    )
    .await
    {
        Ok(photo) => {
            info!(
                "updated photo metadata for entity {}: {}x{}",
                photo.id, width, height
            );
        }
        Err(e) => {
            // log but don't fail the job — the thumbnail was already created
            warn!(
                "failed to update photo metadata for entity {}: {}",
                params.entity_id, e
            );
        }
    }

    let result = json!({
        "blob_id": params.blob_id,
        "entity_id": params.entity_id,
        "webp_blob_id": webp_blob_id,
        "width": width,
        "height": height,
        "taken_at": taken_at,
        "camera_make": camera_make,
        "camera_model": camera_model,
        "gps_lat": gps_lat,
        "gps_lon": gps_lon,
        "orientation": orientation,
    });

    Ok(Some(result))
}

// ============================================================================
// EXIF extraction helpers
// ============================================================================

/// extracted EXIF metadata from a photo
struct ExifMetadata {
    taken_at: Option<i64>,
    camera_make: Option<String>,
    camera_model: Option<String>,
    gps_lat: Option<f64>,
    gps_lon: Option<f64>,
    orientation: Option<i64>,
}

/// extract EXIF metadata from image bytes
///
/// returns None if EXIF data is not present or cannot be parsed (e.g., PNG files).
/// this is intentionally best-effort — failures are logged and silenced.
fn extract_exif_metadata(data: &[u8]) -> Option<ExifMetadata> {
    let reader = exif::Reader::new();
    let exif_data = match reader.read_from_container(&mut Cursor::new(data)) {
        Ok(exif) => exif,
        Err(e) => {
            debug!(
                "no EXIF data found (this is normal for non-JPEG formats): {}",
                e
            );
            return None;
        }
    };

    // DateTimeOriginal -> unix timestamp
    let taken_at = exif_data
        .get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
        .and_then(|f| parse_exif_datetime(&f.display_value().to_string()));

    // camera make
    let camera_make = exif_data
        .get_field(exif::Tag::Make, exif::In::PRIMARY)
        .map(|f| f.display_value().to_string().trim_matches('"').to_string())
        .filter(|s| !s.is_empty());

    // camera model
    let camera_model = exif_data
        .get_field(exif::Tag::Model, exif::In::PRIMARY)
        .map(|f| f.display_value().to_string().trim_matches('"').to_string())
        .filter(|s| !s.is_empty());

    // GPS coordinates
    let gps_lat = extract_gps_coordinate(
        exif_data.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY),
        exif_data.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY),
    );

    let gps_lon = extract_gps_coordinate(
        exif_data.get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY),
        exif_data.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY),
    );

    // orientation (1-8)
    let orientation = exif_data
        .get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|f| match f.value {
            exif::Value::Short(ref v) => v.first().map(|&val| val as i64),
            exif::Value::Long(ref v) => v.first().map(|&val| val as i64),
            _ => None,
        });

    // also check EXIF-embedded dimensions (PixelXDimension / PixelYDimension)
    // these are informational only — we use image crate dimensions as the source of truth
    let exif_width = exif_data
        .get_field(exif::Tag::PixelXDimension, exif::In::PRIMARY)
        .and_then(|f| extract_dimension_value(f));
    let exif_height = exif_data
        .get_field(exif::Tag::PixelYDimension, exif::In::PRIMARY)
        .and_then(|f| extract_dimension_value(f));

    if exif_width.is_some() || exif_height.is_some() {
        debug!("EXIF dimensions: {:?}x{:?}", exif_width, exif_height);
    }

    Some(ExifMetadata {
        taken_at,
        camera_make,
        camera_model,
        gps_lat,
        gps_lon,
        orientation,
    })
}

/// parse EXIF datetime string "YYYY:MM:DD HH:MM:SS" to unix timestamp
fn parse_exif_datetime(datetime_str: &str) -> Option<i64> {
    // EXIF datetime format: "YYYY:MM:DD HH:MM:SS"
    // the display_value() may include quotes, so strip them
    let cleaned = datetime_str.trim().trim_matches('"');

    // try parsing the standard EXIF format
    let parts: Vec<&str> = cleaned.splitn(2, ' ').collect();
    if parts.len() != 2 {
        debug!("unexpected EXIF datetime format: {}", cleaned);
        return None;
    }

    let date_parts: Vec<&str> = parts[0].split(':').collect();
    let time_parts: Vec<&str> = parts[1].split(':').collect();

    if date_parts.len() != 3 || time_parts.len() != 3 {
        debug!("unexpected EXIF datetime components: {}", cleaned);
        return None;
    }

    let year: i32 = date_parts[0].parse().ok()?;
    let month: u32 = date_parts[1].parse().ok()?;
    let day: u32 = date_parts[2].parse().ok()?;
    let hour: u32 = time_parts[0].parse().ok()?;
    let minute: u32 = time_parts[1].parse().ok()?;
    let second: u32 = time_parts[2].parse().ok()?;

    // basic validation
    if month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 {
        debug!("invalid EXIF datetime values: {}", cleaned);
        return None;
    }

    // convert to unix timestamp using a simplified calculation
    // (no timezone info in EXIF DateTimeOriginal, assume local time / treat as UTC)
    let timestamp = naive_datetime_to_unix(year, month, day, hour, minute, second);
    Some(timestamp)
}

/// convert a naive date/time to a unix timestamp (assuming UTC)
///
/// this is a simplified conversion without pulling in chrono as a dependency.
/// accurate for dates from 1970 onwards.
fn naive_datetime_to_unix(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
) -> i64 {
    // days in each month for non-leap years
    let days_in_month: [u32; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    let is_leap = |y: i32| -> bool { (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 };

    // count days from 1970-01-01 to the given date
    let mut total_days: i64 = 0;

    // add days for complete years
    for y in 1970..year {
        total_days += if is_leap(y) { 366 } else { 365 };
    }
    // handle years before 1970 (unlikely for photos but handle gracefully)
    for y in year..1970 {
        total_days -= if is_leap(y) { 366 } else { 365 };
    }

    // add days for complete months in the current year
    for m in 0..(month - 1) as usize {
        total_days += days_in_month[m] as i64;
        if m == 1 && is_leap(year) {
            total_days += 1; // february in a leap year
        }
    }

    // add remaining days (1-indexed, so subtract 1)
    total_days += (day - 1) as i64;

    // convert to seconds and add time components
    total_days * 86400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64
}

/// parse a GPS coordinate from EXIF rational values with direction reference
///
/// GPS coordinates are stored as three rationals [degrees, minutes, seconds]
/// with a separate reference field indicating direction (N/S for latitude, E/W for longitude).
/// south and west directions are negative.
fn extract_gps_coordinate(
    coord_field: Option<&exif::Field>,
    ref_field: Option<&exif::Field>,
) -> Option<f64> {
    let field = coord_field?;

    if let exif::Value::Rational(ref rationals) = field.value {
        if rationals.len() >= 3 {
            let degrees = rationals[0].to_f64();
            let minutes = rationals[1].to_f64();
            let seconds = rationals[2].to_f64();
            let mut coord = degrees + minutes / 60.0 + seconds / 3600.0;

            // check reference direction for sign
            if let Some(ref_f) = ref_field {
                if let exif::Value::Ascii(ref strings) = ref_f.value {
                    if let Some(first) = strings.first() {
                        if first == b"S" || first == b"W" {
                            coord = -coord;
                        }
                    }
                }
            }

            return Some(coord);
        }
    }

    None
}

/// extract a dimension value from an EXIF field (PixelXDimension / PixelYDimension)
fn extract_dimension_value(field: &exif::Field) -> Option<u32> {
    match field.value {
        exif::Value::Short(ref v) => v.first().map(|&val| val as u32),
        exif::Value::Long(ref v) => v.first().copied(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_exif_datetime_valid() {
        let ts = parse_exif_datetime("2024:06:15 14:30:00");
        assert!(ts.is_some());
        // 2024-06-15 14:30:00 UTC
        let expected = naive_datetime_to_unix(2024, 6, 15, 14, 30, 0);
        assert_eq!(ts.unwrap(), expected);
    }

    #[test]
    fn test_parse_exif_datetime_with_quotes() {
        let ts = parse_exif_datetime("\"2023:01:01 00:00:00\"");
        assert!(ts.is_some());
        let expected = naive_datetime_to_unix(2023, 1, 1, 0, 0, 0);
        assert_eq!(ts.unwrap(), expected);
    }

    #[test]
    fn test_parse_exif_datetime_invalid() {
        assert!(parse_exif_datetime("not a date").is_none());
        assert!(parse_exif_datetime("").is_none());
        assert!(parse_exif_datetime("2024:13:01 00:00:00").is_none()); // invalid month
        assert!(parse_exif_datetime("2024:01:32 00:00:00").is_none()); // invalid day
    }

    #[test]
    fn test_naive_datetime_to_unix_epoch() {
        // 1970-01-01 00:00:00 should be 0
        assert_eq!(naive_datetime_to_unix(1970, 1, 1, 0, 0, 0), 0);
    }

    #[test]
    fn test_naive_datetime_to_unix_known_date() {
        // 2000-01-01 00:00:00 UTC = 946684800
        let ts = naive_datetime_to_unix(2000, 1, 1, 0, 0, 0);
        assert_eq!(ts, 946684800);
    }

    #[test]
    fn test_naive_datetime_to_unix_with_time() {
        // 1970-01-01 01:00:00 should be 3600
        assert_eq!(naive_datetime_to_unix(1970, 1, 1, 1, 0, 0), 3600);
    }

    #[test]
    fn test_naive_datetime_to_unix_leap_year() {
        // 2024 is a leap year — 2024-03-01 should account for feb 29
        let mar1 = naive_datetime_to_unix(2024, 3, 1, 0, 0, 0);
        let feb28 = naive_datetime_to_unix(2024, 2, 28, 0, 0, 0);
        // feb 28 -> feb 29 -> mar 1 = 2 days
        assert_eq!(mar1 - feb28, 2 * 86400);
    }
}
