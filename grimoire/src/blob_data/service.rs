//! blob_data service functions
//! handles raw binary data storage for thumbnails, waveforms, etc.

use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;

/// store binary data for a media blob
pub async fn store_blob_data(blob_id: &str, data: Vec<u8>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    match sqlx::query!(
        "INSERT INTO blob_data (id, data) VALUES ($1, $2)",
        blob_id,
        data
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Blob data stored successfully", ()),
        Err(e) => GrimoireResponse::failure("Failed to store blob data", vec![e.into()]),
    }
}

/// retrieve binary data for a media blob
pub async fn get_blob_data(blob_id: &str) -> GrimoireResponse<Vec<u8>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let row = match sqlx::query!("SELECT data FROM blob_data WHERE id = $1", blob_id)
        .fetch_optional(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("Failed to retrieve blob data", vec![e.into()]),
    };

    match row {
        Some(row) => GrimoireResponse::success("Blob data retrieved successfully", row.data),
        None => GrimoireResponse::failure(
            "Blob data not found",
            vec![ErrorDetail::new(
                "media_blob_not_found",
                "Media Blob Not Found",
                format!("No blob data found for id: {}", blob_id),
            )],
        ),
    }
}

/// check if binary data exists for a media blob
pub async fn blob_data_exists(blob_id: &str) -> GrimoireResponse<bool> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let row = match sqlx::query!(
        "SELECT COUNT(*) as count FROM blob_data WHERE id = $1",
        blob_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("Failed to check blob data existence", vec![e.into()])
        }
    };

    GrimoireResponse::success("Blob data existence checked", row.count > 0)
}

/// delete binary data for a media blob
pub async fn delete_blob_data(blob_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    match sqlx::query!("DELETE FROM blob_data WHERE id = $1", blob_id)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("Blob data deleted successfully", ()),
        Err(e) => GrimoireResponse::failure("Failed to delete blob data", vec![e.into()]),
    }
}
