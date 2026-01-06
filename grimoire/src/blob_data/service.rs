//! blob_data service functions
//! handles raw binary data storage for thumbnails, waveforms, etc.

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// store binary data for a media blob
pub async fn store_blob_data(blob_id: &str, data: Vec<u8>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    sqlx::query!(
        "INSERT INTO blob_data (id, data) VALUES ($1, $2)",
        blob_id,
        data
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// retrieve binary data for a media blob
pub async fn get_blob_data(blob_id: &str) -> GrimoireResult<Vec<u8>> {
    let pool = database::connect().await?;

    let row = sqlx::query!("SELECT data FROM blob_data WHERE id = $1", blob_id)
        .fetch_optional(&pool)
        .await?;

    match row {
        Some(row) => Ok(row.data),
        None => Err(GrimoireError::MediaBlobNotFound {
            id: blob_id.to_string(),
        }),
    }
}

/// check if binary data exists for a media blob
pub async fn blob_data_exists(blob_id: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await?;

    let row = sqlx::query!(
        "SELECT COUNT(*) as count FROM blob_data WHERE id = $1",
        blob_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(row.count > 0)
}

/// delete binary data for a media blob
pub async fn delete_blob_data(blob_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    sqlx::query!("DELETE FROM blob_data WHERE id = $1", blob_id)
        .execute(&pool)
        .await?;

    Ok(())
}
