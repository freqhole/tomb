//! blob_data service functions
//! handles raw binary data storage for thumbnails, waveforms, etc.
//! uses a separate SQLite database file for blob storage

use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;
use sqlx::Row;

/// store binary data for a media blob
pub async fn store_blob_data(blob_id: &str, data: Vec<u8>) -> GrimoireResponse<()> {
    let pool = match database::connect_blob_data().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to blob database", vec![e.into()])
        }
    };

    match sqlx::query("INSERT INTO blob_data (id, data) VALUES (?, ?)")
        .bind(blob_id)
        .bind(&data)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("blob data stored successfully", ()),
        Err(e) => GrimoireResponse::failure("failed to store blob data", vec![e.into()]),
    }
}

/// retrieve binary data for a media blob
pub async fn get_blob_data(blob_id: &str) -> GrimoireResponse<Vec<u8>> {
    let pool = match database::connect_blob_data().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to blob database", vec![e.into()])
        }
    };

    let row = match sqlx::query("SELECT data FROM blob_data WHERE id = ?")
        .bind(blob_id)
        .fetch_optional(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("failed to retrieve blob data", vec![e.into()]),
    };

    match row {
        Some(row) => {
            let data: Vec<u8> = row.get("data");
            GrimoireResponse::success("blob data retrieved successfully", data)
        }
        None => GrimoireResponse::failure(
            "blob data not found",
            vec![ErrorDetail::new(
                "media_blob_not_found",
                "Media Blob Not Found",
                format!("no blob data found for id: {}", blob_id),
            )],
        ),
    }
}

/// check if binary data exists for a media blob
pub async fn blob_data_exists(blob_id: &str) -> GrimoireResponse<bool> {
    let pool = match database::connect_blob_data().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to blob database", vec![e.into()])
        }
    };

    let row = match sqlx::query("SELECT COUNT(*) as count FROM blob_data WHERE id = ?")
        .bind(blob_id)
        .fetch_one(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to check blob data existence", vec![e.into()])
        }
    };

    let count: i32 = row.get("count");
    GrimoireResponse::success("blob data existence checked", count > 0)
}

/// delete binary data for a media blob
pub async fn delete_blob_data(blob_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect_blob_data().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to blob database", vec![e.into()])
        }
    };

    match sqlx::query("DELETE FROM blob_data WHERE id = ?")
        .bind(blob_id)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("blob data deleted successfully", ()),
        Err(e) => GrimoireResponse::failure("failed to delete blob data", vec![e.into()]),
    }
}
