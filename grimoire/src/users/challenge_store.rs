//! challenge store for p2p webauthn flows
//!
//! http transport uses tower_sessions for challenge storage. over p2p there
//! is no cookie session, so challenges are stored here in sqlite, keyed by a
//! short-lived nonce that the client echoes back in the finish call.
//!
//! the row is deleted atomically when taken so it can only be used once.
//! expired rows are rejected on read and lazily purged.

use crate::config::get_config;
use crate::database;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// a row from webauthn_challenges
#[derive(Debug, Clone)]
pub struct ChallengeRow {
    pub nonce: String,
    pub kind: String,
    pub challenge_json: String,
    pub user_id: Option<String>,
    pub username: Option<String>,
    pub is_account_link: bool,
    pub invite_code: Option<String>,
}

/// arguments for saving a challenge
#[derive(Debug)]
pub struct SaveChallengeArgs<'a> {
    pub kind: &'a str,
    pub challenge_json: &'a str,
    pub user_id: Option<&'a str>,
    pub username: Option<&'a str>,
    pub is_account_link: bool,
    pub invite_code: Option<&'a str>,
}

/// repository for p2p webauthn challenge storage
pub struct ChallengeStore;

impl ChallengeStore {
    pub fn new() -> Self {
        Self
    }

    /// get the challenge ttl in minutes from config (default 15)
    fn ttl_minutes() -> u32 {
        get_config()
            .server
            .as_ref()
            .map(|s| s.auth.webauthn_challenge_ttl_minutes)
            .unwrap_or(15)
    }

    /// save a challenge and return the generated nonce
    pub async fn save(&self, args: SaveChallengeArgs<'_>) -> Result<String, sqlx::Error> {
        let pool = database::connect().await.map_err(|e| {
            sqlx::Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })?;

        let nonce = Uuid::new_v4().to_string();
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let ttl_secs = Self::ttl_minutes() as i64 * 60;
        let expires_at = now + ttl_secs;

        let is_account_link_i = args.is_account_link as i64;

        sqlx::query!(
            r#"
            INSERT INTO webauthn_challenges
                (nonce, kind, challenge_json, user_id, username, is_account_link, invite_code, created_at, expires_at)
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            nonce,
            args.kind,
            args.challenge_json,
            args.user_id,
            args.username,
            is_account_link_i,
            args.invite_code,
            now,
            expires_at,
        )
        .execute(&pool)
        .await?;

        Ok(nonce)
    }

    /// retrieve a challenge by nonce, verify kind and expiry, then delete it
    ///
    /// returns None if the nonce is not found, already used, expired, or kind mismatch.
    /// also lazily purges all expired rows on each call.
    pub async fn take(
        &self,
        nonce: &str,
        expected_kind: &str,
    ) -> Result<Option<ChallengeRow>, sqlx::Error> {
        let pool = database::connect().await.map_err(|e| {
            sqlx::Error::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            ))
        })?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        // purge expired rows lazily (best-effort; ignore errors)
        let _ = sqlx::query!(
            "DELETE FROM webauthn_challenges WHERE expires_at <= ?1",
            now
        )
        .execute(&pool)
        .await;

        // fetch the row
        let row = sqlx::query!(
            r#"
            SELECT nonce, kind, challenge_json, user_id, username,
                   is_account_link as "is_account_link: i64", invite_code, expires_at
            FROM webauthn_challenges
            WHERE nonce = ?1
            "#,
            nonce,
        )
        .fetch_optional(&pool)
        .await?;

        let row = match row {
            Some(r) => r,
            None => return Ok(None),
        };

        // check expiry (should have been caught by purge, but be safe)
        if row.expires_at <= now {
            let _ = sqlx::query!("DELETE FROM webauthn_challenges WHERE nonce = ?1", nonce)
                .execute(&pool)
                .await;
            return Ok(None);
        }

        // check kind
        if row.kind != expected_kind {
            return Ok(None);
        }

        // delete the row (single use)
        sqlx::query!("DELETE FROM webauthn_challenges WHERE nonce = ?1", nonce)
            .execute(&pool)
            .await?;

        Ok(Some(ChallengeRow {
            nonce: row.nonce.unwrap_or_default(),
            kind: row.kind,
            challenge_json: row.challenge_json,
            user_id: row.user_id,
            username: row.username,
            is_account_link: row.is_account_link != 0,
            invite_code: row.invite_code,
        }))
    }
}
