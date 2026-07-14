//! CUTOVER(0.2.0): one-shot migration of grimoire's pre-haruspex auth data
//! (`user_accountz`, `user_credentialz`, `user_peer_nodez`,
//! `knock_requestz`, `invite_codez`, `webauthn_challenges`) into haruspex's
//! own tables (`identityz`, `api_keyz`, `credentialz`, `device_nodez`,
//! `knockz`, `invite_codez`, `webauthn_challengez`). deleted once no
//! deployment still carries pre-haruspex data in grimoire's original
//! tables.
//!
//! safe to run multiple times: identities go through
//! `IdentityStore::upsert_identity` (already an upsert), and every other
//! table uses `INSERT OR IGNORE` keyed on the target table's own primary
//! key, so a rerun after a partial or complete prior run only fills in
//! whatever is still missing. never modifies or deletes anything in
//! grimoire's own tables - only reads from them, and writes into
//! haruspex's database.

use std::collections::HashSet;

use haruspex::identity::Identity;
use haruspex::sqlite::SqliteIdentityStore;
use haruspex::stores::knock_store::{
    KnockDirection, KnockScope, KnockStatus as HaruspexKnockStatus,
};
use haruspex::stores::IdentityStore;
use serde::Serialize;
use sqlx::SqlitePool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::users::haruspex_bridge;

/// namespace used to derive a stable haruspex knock id from a grimoire
/// `knock_requestz` row's own id. grimoire's original id is a short hex
/// string (`lower(hex(randomblob(8)))`), not a valid uuid on its own, but
/// haruspex's `knockz.id` column always round-trips through
/// `Uuid::parse_str` when a row is read back (see `SqliteKnockStore`'s row
/// conversion) - carrying the hex string over verbatim would break every
/// read (`list_pending`, `list_all`, `find_by_node_id`, `get_knock`) for a
/// migrated row. deriving a deterministic uuid here keeps reruns stable
/// while satisfying that constraint; the original id is preserved in the
/// row's `metadata_json` field so it stays traceable.
const GRIMOIRE_KNOCK_NAMESPACE: Uuid = Uuid::from_bytes([
    0x4d, 0x2e, 0x91, 0xaa, 0x1c, 0x77, 0x4f, 0x0e, 0x8b, 0x3a, 0x5d, 0x6c, 0x2f, 0x91, 0x0b, 0x77,
]);

/// namespace used to derive a stable haruspex invite id from a grimoire
/// `invite_codez` row's own id, for the same reason as
/// `GRIMOIRE_KNOCK_NAMESPACE` above - haruspex's `invite_codez.id` column
/// round-trips through `Uuid::parse_str` on every read. `invite_codez` has
/// no metadata column to stash the original id in, but the invite's `code`
/// itself (unique, preserved verbatim) is already the human-facing,
/// traceable identifier, so nothing is actually lost.
const GRIMOIRE_INVITE_NAMESPACE: Uuid = Uuid::from_bytes([
    0x7f, 0x1a, 0x63, 0xd4, 0x9e, 0x22, 0x41, 0x88, 0xb0, 0x5e, 0x3c, 0x77, 0x1a, 0x44, 0x9f, 0x02,
]);

fn knock_id_for_existing_knock(grimoire_knock_id: &str) -> Uuid {
    Uuid::new_v5(&GRIMOIRE_KNOCK_NAMESPACE, grimoire_knock_id.as_bytes())
}

fn invite_id_for_existing_invite(grimoire_invite_id: &str) -> Uuid {
    Uuid::new_v5(&GRIMOIRE_INVITE_NAMESPACE, grimoire_invite_id.as_bytes())
}

/// a source row referencing a `user_id`/`processed_by`/`used_by_id`/
/// `link_for_user_id` that has no corresponding `user_accountz` row at
/// all. grimoire's own foreign keys should make this impossible, but it's
/// counted and reported rather than assumed.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UnresolvedUserRef {
    pub table: String,
    pub row_id: String,
    pub field: String,
    pub user_id: String,
}

/// per-table migration counts.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct TableCounts {
    /// source rows read this run.
    pub examined: i64,
    /// rows newly inserted into the haruspex target table this run.
    pub inserted: i64,
    /// rows whose target key already existed (a previous run, or a rerun
    /// of this one, already migrated them).
    pub already_existed: i64,
    /// rows deliberately not migrated (currently only the "expired
    /// webauthn challenge" case) - never a silent drop, always counted.
    pub skipped: i64,
}

/// the result of one `migrate_to_haruspex` run.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MigrationReport {
    pub identities: TableCounts,
    pub api_keys: TableCounts,
    pub credentials: TableCounts,
    pub devices: TableCounts,
    pub knocks: TableCounts,
    pub invites: TableCounts,
    pub challenges: TableCounts,
    /// source rows referencing a user id with no corresponding
    /// `user_accountz` row. must be empty for a clean migration.
    pub unresolved_user_refs: Vec<UnresolvedUserRef>,
    /// knock rows whose status was none of "pending"/"accepted"/
    /// "rejected" - grimoire's schema has no CHECK constraint pinning
    /// this, so it's verified rather than assumed. still migrated (see
    /// `map_knock_status`), just flagged.
    pub unexpected_knock_status: Vec<(String, String)>,
}

impl MigrationReport {
    /// true when every verification count this command performs came back
    /// clean: no unresolved user references, no unexpected knock status
    /// values.
    pub fn is_clean(&self) -> bool {
        self.unresolved_user_refs.is_empty() && self.unexpected_knock_status.is_empty()
    }
}

#[derive(Debug, Clone)]
struct SourceUser {
    id: String,
    username: String,
    api_key: Option<String>,
    created_at: i64,
    deleted_at: Option<i64>,
    metadata: Option<String>,
}

async fn fetch_source_users(pool: &SqlitePool) -> GrimoireResult<Vec<SourceUser>> {
    let rows = sqlx::query_as!(
        SourceUser,
        r#"SELECT
            id as "id!",
            username as "username!",
            api_key,
            created_at as "created_at!",
            deleted_at,
            metadata
         FROM user_accountz
         ORDER BY created_at ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone)]
struct SourceCredential {
    id: String,
    user_id: String,
    credential_id: Vec<u8>,
    credential_data: String,
    name: Option<String>,
    created_at: i64,
    last_used_at: Option<i64>,
    deleted_at: Option<i64>,
}

async fn fetch_source_credentials(pool: &SqlitePool) -> GrimoireResult<Vec<SourceCredential>> {
    let rows = sqlx::query_as!(
        SourceCredential,
        r#"SELECT
            id as "id!",
            user_id as "user_id!",
            credential_id as "credential_id!",
            credential_data as "credential_data!",
            name,
            created_at as "created_at!",
            last_used_at,
            deleted_at
         FROM user_credentialz
         ORDER BY created_at ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone)]
struct SourceDevice {
    user_id: String,
    node_id: String,
    instance_name: Option<String>,
    created_at: i64,
    last_seen_at: Option<i64>,
    deleted_at: Option<i64>,
}

async fn fetch_source_devices(pool: &SqlitePool) -> GrimoireResult<Vec<SourceDevice>> {
    let rows = sqlx::query_as!(
        SourceDevice,
        r#"SELECT
            user_id as "user_id!",
            node_id as "node_id!",
            instance_name,
            created_at as "created_at!",
            last_seen_at,
            deleted_at
         FROM user_peer_nodez
         ORDER BY created_at ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone)]
struct SourceKnock {
    id: String,
    node_id: String,
    username: String,
    message: String,
    status: String,
    created_at: i64,
    processed_at: Option<i64>,
    processed_by: Option<String>,
}

async fn fetch_source_knocks(pool: &SqlitePool) -> GrimoireResult<Vec<SourceKnock>> {
    let rows = sqlx::query_as!(
        SourceKnock,
        r#"SELECT
            id as "id!",
            node_id as "node_id!",
            username as "username!",
            message as "message!",
            status as "status!",
            created_at as "created_at!",
            processed_at,
            processed_by
         FROM knock_requestz
         ORDER BY created_at ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone)]
struct SourceInvite {
    id: String,
    code: String,
    // grimoire's schema declares these with a SQL DEFAULT but no NOT NULL,
    // so a row could in principle have a NULL here - handled by falling
    // back to that same default when migrating (see `migrate_invites`).
    code_type: Option<String>,
    grants_role: Option<String>,
    link_for_user_id: Option<String>,
    link_expires_at: Option<i64>,
    created_at: i64,
    used_at: Option<i64>,
    used_by_id: Option<String>,
    is_active: Option<i64>,
}

async fn fetch_source_invites(pool: &SqlitePool) -> GrimoireResult<Vec<SourceInvite>> {
    let rows = sqlx::query_as!(
        SourceInvite,
        r#"SELECT
            id as "id!",
            code as "code!",
            code_type,
            grants_role,
            link_for_user_id,
            link_expires_at,
            created_at as "created_at!",
            used_at,
            used_by_id,
            is_active
         FROM invite_codez
         ORDER BY created_at ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[derive(Debug, Clone)]
struct SourceChallenge {
    nonce: String,
    kind: String,
    challenge_json: String,
    user_id: Option<String>,
    username: Option<String>,
    is_account_link: i64,
    invite_code: Option<String>,
    created_at: i64,
    expires_at: i64,
}

async fn fetch_source_challenges(pool: &SqlitePool) -> GrimoireResult<Vec<SourceChallenge>> {
    let rows = sqlx::query_as!(
        SourceChallenge,
        r#"SELECT
            nonce as "nonce!",
            kind as "kind!",
            challenge_json as "challenge_json!",
            user_id,
            username,
            is_account_link as "is_account_link!",
            invite_code,
            created_at as "created_at!",
            expires_at as "expires_at!"
         FROM webauthn_challenges
         ORDER BY created_at ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// merge a grimoire user's existing metadata (parsed as json if present,
/// falling back to an empty object if it's null or fails to parse) with
/// the `grimoire_user_id` key the bridge's reverse lookup depends on. the
/// merged value always carries `grimoire_user_id`, regardless of whatever
/// grimoire had stored.
fn merge_identity_metadata(
    existing_metadata: Option<&str>,
    grimoire_user_id: &str,
) -> serde_json::Value {
    let mut metadata = existing_metadata
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    metadata["grimoire_user_id"] = serde_json::Value::String(grimoire_user_id.to_string());
    metadata
}

/// grimoire's own knock wire type (`federation::knock::KnockStatus`) uses
/// "rejected" where haruspex's `KnockStatus` enum uses "denied" - the two
/// vocabularies differ by exactly that one label. mirrors the same
/// fallback `federation::knock::KnockStatus`'s own `From<String>` impl
/// uses: anything other than "accepted"/"rejected" becomes "pending".
fn map_knock_status(status: &str) -> &'static str {
    match status {
        "accepted" => HaruspexKnockStatus::Accepted.as_str(),
        "rejected" => HaruspexKnockStatus::Denied.as_str(),
        _ => HaruspexKnockStatus::Pending.as_str(),
    }
}

fn store_error(context: &str) -> impl Fn(haruspex::error::StoreError) -> GrimoireError + '_ {
    move |e| GrimoireError::ProcessingFailed {
        message: format!("{context}: {e}"),
    }
}

/// migrate every `user_accountz` row into haruspex's `identityz` table via
/// `IdentityStore::upsert_identity`, preserving the original id, username,
/// created_at and deleted_at rather than stamping "now" the way
/// `ensure_identity_for_user` does for live single-user operations.
/// returns the source rows too, since every later table's migration needs
/// to know which grimoire user ids exist.
async fn migrate_identities(
    grimoire_pool: &SqlitePool,
    identities: &SqliteIdentityStore,
) -> GrimoireResult<(TableCounts, Vec<SourceUser>)> {
    let users = fetch_source_users(grimoire_pool).await?;
    let mut counts = TableCounts::default();

    for user in &users {
        counts.examined += 1;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(&user.id);

        let existed = identities
            .get_identity(identity_id)
            .await
            .map_err(store_error("failed to look up haruspex identity"))?
            .is_some();

        let metadata = merge_identity_metadata(user.metadata.as_deref(), &user.id);
        identities
            .upsert_identity(Identity {
                id: identity_id,
                username: Some(user.username.clone()),
                created_at: user.created_at,
                metadata: Some(metadata),
                deleted_at: user.deleted_at,
            })
            .await
            .map_err(store_error("failed to migrate identity"))?;

        if existed {
            counts.already_existed += 1;
        } else {
            counts.inserted += 1;
        }
    }

    Ok((counts, users))
}

/// migrate every `user_accountz` row with a non-null `api_key` into
/// haruspex's `api_keyz` table. no `IdentityStore` method accepts an
/// explicit historical `issued_at`, so this writes directly via
/// `sqlx::query`, `INSERT OR IGNORE` keyed on `identity_id` (the primary
/// key). `issued_at` is approximated with the account's own `created_at` -
/// grimoire never tracked a separate api-key issuance timestamp.
async fn migrate_api_keys(
    haruspex_pool: &SqlitePool,
    users: &[SourceUser],
) -> GrimoireResult<TableCounts> {
    let mut counts = TableCounts::default();

    for user in users.iter().filter(|u| u.api_key.is_some()) {
        counts.examined += 1;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(&user.id);
        let api_key = user
            .api_key
            .as_deref()
            .expect("filtered to rows with a non-null api_key above");

        let result = sqlx::query(
            "INSERT OR IGNORE INTO api_keyz (identity_id, api_key, issued_at) VALUES (?1, ?2, ?3)",
        )
        .bind(identity_id.to_string())
        .bind(api_key)
        .bind(user.created_at)
        .execute(haruspex_pool)
        .await?;

        if result.rows_affected() > 0 {
            counts.inserted += 1;
        } else {
            counts.already_existed += 1;
        }
    }

    Ok(counts)
}

/// migrate every `user_credentialz` row into haruspex's `credentialz`
/// table. `credentialz.id` has no format constraint (it's a plain
/// `String`, never parsed as a uuid), so grimoire's own id is preserved
/// verbatim.
async fn migrate_credentials(
    grimoire_pool: &SqlitePool,
    haruspex_pool: &SqlitePool,
    known_user_ids: &HashSet<String>,
) -> GrimoireResult<(TableCounts, Vec<UnresolvedUserRef>)> {
    let rows = fetch_source_credentials(grimoire_pool).await?;
    let mut counts = TableCounts::default();
    let mut unresolved = Vec::new();

    for row in &rows {
        counts.examined += 1;

        if !known_user_ids.contains(&row.user_id) {
            unresolved.push(UnresolvedUserRef {
                table: "user_credentialz".to_string(),
                row_id: row.id.clone(),
                field: "user_id".to_string(),
                user_id: row.user_id.clone(),
            });
            continue;
        }

        let identity_id = haruspex_bridge::identity_id_for_existing_user(&row.user_id);
        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO credentialz
                (id, identity_id, credential_id, credential_data, name, created_at, last_used_at, deleted_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(&row.id)
        .bind(identity_id.to_string())
        .bind(&row.credential_id)
        .bind(&row.credential_data)
        .bind(&row.name)
        .bind(row.created_at)
        .bind(row.last_used_at)
        .bind(row.deleted_at)
        .execute(haruspex_pool)
        .await?;

        if result.rows_affected() > 0 {
            counts.inserted += 1;
        } else {
            counts.already_existed += 1;
        }
    }

    Ok((counts, unresolved))
}

/// migrate every `user_peer_nodez` row into haruspex's `device_nodez`
/// table, keyed on the natural `(identity_id, node_id)` primary key.
/// `last_seen_at` is `NOT NULL` on the target table but nullable on
/// grimoire's own column, so a null falls back to `created_at`.
async fn migrate_devices(
    grimoire_pool: &SqlitePool,
    haruspex_pool: &SqlitePool,
    known_user_ids: &HashSet<String>,
) -> GrimoireResult<(TableCounts, Vec<UnresolvedUserRef>)> {
    let rows = fetch_source_devices(grimoire_pool).await?;
    let mut counts = TableCounts::default();
    let mut unresolved = Vec::new();

    for row in &rows {
        counts.examined += 1;

        if !known_user_ids.contains(&row.user_id) {
            unresolved.push(UnresolvedUserRef {
                table: "user_peer_nodez".to_string(),
                row_id: row.node_id.clone(),
                field: "user_id".to_string(),
                user_id: row.user_id.clone(),
            });
            continue;
        }

        let identity_id = haruspex_bridge::identity_id_for_existing_user(&row.user_id);
        let last_seen_at = row.last_seen_at.unwrap_or(row.created_at);

        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO device_nodez
                (identity_id, node_id, instance_name, created_at, last_seen_at, deleted_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(identity_id.to_string())
        .bind(&row.node_id)
        .bind(&row.instance_name)
        .bind(row.created_at)
        .bind(last_seen_at)
        .bind(row.deleted_at)
        .execute(haruspex_pool)
        .await?;

        if result.rows_affected() > 0 {
            counts.inserted += 1;
        } else {
            counts.already_existed += 1;
        }
    }

    Ok((counts, unresolved))
}

/// migrate every `knock_requestz` row into haruspex's `knockz` table.
/// every row is treated as an inbound knock (the old schema never had an
/// outbound concept). `scope_key`/`scope_json` are both set to the same
/// `KnockScope::Account` json rendering `federation::knock::create_knock`
/// produces for a live equivalent knock. `decisions_json` becomes `"[]"`
/// for every row: the old schema only ever tracked one resolved status,
/// never a structured per-decision log, so an empty list honestly reflects
/// "no decision detail available" rather than fabricating one.
async fn migrate_knocks(
    grimoire_pool: &SqlitePool,
    haruspex_pool: &SqlitePool,
    known_user_ids: &HashSet<String>,
) -> GrimoireResult<(TableCounts, Vec<UnresolvedUserRef>, Vec<(String, String)>)> {
    let rows = fetch_source_knocks(grimoire_pool).await?;
    let mut counts = TableCounts::default();
    let mut unresolved = Vec::new();
    let mut unexpected_status = Vec::new();
    let direction = KnockDirection::Inbound.as_str();

    for row in &rows {
        counts.examined += 1;

        let processed_by = match &row.processed_by {
            Some(user_id) if known_user_ids.contains(user_id) => {
                Some(haruspex_bridge::identity_id_for_existing_user(user_id).to_string())
            }
            Some(user_id) => {
                unresolved.push(UnresolvedUserRef {
                    table: "knock_requestz".to_string(),
                    row_id: row.id.clone(),
                    field: "processed_by".to_string(),
                    user_id: user_id.clone(),
                });
                continue;
            }
            None => None,
        };

        if !matches!(row.status.as_str(), "pending" | "accepted" | "rejected") {
            unexpected_status.push((row.id.clone(), row.status.clone()));
        }
        let status = map_knock_status(&row.status);

        let scope = KnockScope::Account {
            requested_username: Some(row.username.clone()),
        };
        let scope_json = serde_json::to_string(&scope)?;
        let metadata_json =
            serde_json::to_string(&serde_json::json!({ "grimoire_knock_id": row.id }))?;
        let knock_id = knock_id_for_existing_knock(&row.id);

        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO knockz
                (id, node_id, direction, scope_key, scope_json, message, status,
                 created_at, processed_at, processed_by, decisions_json, metadata_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
        )
        .bind(knock_id.to_string())
        .bind(&row.node_id)
        .bind(direction)
        .bind(&scope_json)
        .bind(&scope_json)
        .bind(&row.message)
        .bind(status)
        .bind(row.created_at)
        .bind(row.processed_at)
        .bind(&processed_by)
        .bind("[]")
        .bind(&metadata_json)
        .execute(haruspex_pool)
        .await?;

        if result.rows_affected() > 0 {
            counts.inserted += 1;
        } else {
            counts.already_existed += 1;
        }
    }

    Ok((counts, unresolved, unexpected_status))
}

/// migrate every `invite_codez` row into haruspex's own `invite_codez`
/// table (same name, different database).
async fn migrate_invites(
    grimoire_pool: &SqlitePool,
    haruspex_pool: &SqlitePool,
    known_user_ids: &HashSet<String>,
) -> GrimoireResult<(TableCounts, Vec<UnresolvedUserRef>)> {
    let rows = fetch_source_invites(grimoire_pool).await?;
    let mut counts = TableCounts::default();
    let mut unresolved = Vec::new();

    for row in &rows {
        counts.examined += 1;

        let link_for_user_id = match &row.link_for_user_id {
            Some(user_id) if known_user_ids.contains(user_id) => {
                Some(haruspex_bridge::identity_id_for_existing_user(user_id).to_string())
            }
            Some(user_id) => {
                unresolved.push(UnresolvedUserRef {
                    table: "invite_codez".to_string(),
                    row_id: row.id.clone(),
                    field: "link_for_user_id".to_string(),
                    user_id: user_id.clone(),
                });
                continue;
            }
            None => None,
        };

        let used_by = match &row.used_by_id {
            Some(user_id) if known_user_ids.contains(user_id) => {
                Some(haruspex_bridge::identity_id_for_existing_user(user_id).to_string())
            }
            Some(user_id) => {
                unresolved.push(UnresolvedUserRef {
                    table: "invite_codez".to_string(),
                    row_id: row.id.clone(),
                    field: "used_by_id".to_string(),
                    user_id: user_id.clone(),
                });
                continue;
            }
            None => None,
        };

        // grimoire's schema declares these with a SQL DEFAULT but no NOT
        // NULL - fall back to that same default when a row somehow has a
        // literal NULL instead.
        let code_type = row.code_type.as_deref().unwrap_or("invite");
        let grants_role = row.grants_role.as_deref().unwrap_or("member");
        let is_active = row.is_active.unwrap_or(1);
        let invite_id = invite_id_for_existing_invite(&row.id);

        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO invite_codez
                (id, code, code_type, grants_role, link_for_user_id, link_expires_at,
                 created_at, used_at, used_by, is_active)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
        )
        .bind(invite_id.to_string())
        .bind(&row.code)
        .bind(code_type)
        .bind(grants_role)
        .bind(&link_for_user_id)
        .bind(row.link_expires_at)
        .bind(row.created_at)
        .bind(row.used_at)
        .bind(&used_by)
        .bind(is_active)
        .execute(haruspex_pool)
        .await?;

        if result.rows_affected() > 0 {
            counts.inserted += 1;
        } else {
            counts.already_existed += 1;
        }
    }

    Ok((counts, unresolved))
}

/// migrate every non-expired `webauthn_challenges` row into haruspex's
/// `webauthn_challengez` table. a challenge past its expiry is meaningless
/// to carry forward, so rows with `expires_at <= migration_started_at` are
/// deliberately skipped (and counted, never silently dropped).
async fn migrate_challenges(
    grimoire_pool: &SqlitePool,
    haruspex_pool: &SqlitePool,
    known_user_ids: &HashSet<String>,
    migration_started_at: i64,
) -> GrimoireResult<(TableCounts, Vec<UnresolvedUserRef>)> {
    let rows = fetch_source_challenges(grimoire_pool).await?;
    let mut counts = TableCounts::default();
    let mut unresolved = Vec::new();

    for row in &rows {
        counts.examined += 1;

        if row.expires_at <= migration_started_at {
            counts.skipped += 1;
            continue;
        }

        let identity_id = match &row.user_id {
            Some(user_id) if known_user_ids.contains(user_id) => {
                Some(haruspex_bridge::identity_id_for_existing_user(user_id).to_string())
            }
            Some(user_id) => {
                unresolved.push(UnresolvedUserRef {
                    table: "webauthn_challenges".to_string(),
                    row_id: row.nonce.clone(),
                    field: "user_id".to_string(),
                    user_id: user_id.clone(),
                });
                continue;
            }
            None => None,
        };

        let result = sqlx::query(
            r#"
            INSERT OR IGNORE INTO webauthn_challengez
                (nonce, kind, challenge_json, identity_id, username, is_account_link,
                 invite_code, created_at, expires_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
        )
        .bind(&row.nonce)
        .bind(&row.kind)
        .bind(&row.challenge_json)
        .bind(&identity_id)
        .bind(&row.username)
        .bind(row.is_account_link)
        .bind(&row.invite_code)
        .bind(row.created_at)
        .bind(row.expires_at)
        .execute(haruspex_pool)
        .await?;

        if result.rows_affected() > 0 {
            counts.inserted += 1;
        } else {
            counts.already_existed += 1;
        }
    }

    Ok((counts, unresolved))
}

/// migrate grimoire's pre-haruspex auth data into haruspex's own database,
/// in dependency order: identities first (every other table's rows
/// reference one via the bridge), then api keys, credentials, devices,
/// knocks, invites, and finally webauthn challenges.
pub async fn migrate_to_haruspex() -> GrimoireResult<MigrationReport> {
    let grimoire_pool = database::connect().await?;
    let haruspex_pool = database::connect_haruspex().await?;
    let identities = SqliteIdentityStore::new(haruspex_pool.clone());
    let migration_started_at = OffsetDateTime::now_utc().unix_timestamp();

    let (identities_counts, users) = migrate_identities(&grimoire_pool, &identities).await?;
    let known_user_ids: HashSet<String> = users.iter().map(|u| u.id.clone()).collect();

    let api_keys_counts = migrate_api_keys(&haruspex_pool, &users).await?;

    let (credentials_counts, mut unresolved_user_refs) =
        migrate_credentials(&grimoire_pool, &haruspex_pool, &known_user_ids).await?;

    let (devices_counts, more_unresolved) =
        migrate_devices(&grimoire_pool, &haruspex_pool, &known_user_ids).await?;
    unresolved_user_refs.extend(more_unresolved);

    let (knocks_counts, more_unresolved, unexpected_knock_status) =
        migrate_knocks(&grimoire_pool, &haruspex_pool, &known_user_ids).await?;
    unresolved_user_refs.extend(more_unresolved);

    let (invites_counts, more_unresolved) =
        migrate_invites(&grimoire_pool, &haruspex_pool, &known_user_ids).await?;
    unresolved_user_refs.extend(more_unresolved);

    let (challenges_counts, more_unresolved) = migrate_challenges(
        &grimoire_pool,
        &haruspex_pool,
        &known_user_ids,
        migration_started_at,
    )
    .await?;
    unresolved_user_refs.extend(more_unresolved);

    Ok(MigrationReport {
        identities: identities_counts,
        api_keys: api_keys_counts,
        credentials: credentials_counts,
        devices: devices_counts,
        knocks: knocks_counts,
        invites: invites_counts,
        challenges: challenges_counts,
        unresolved_user_refs,
        unexpected_knock_status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_identity_metadata_no_existing() {
        let merged = merge_identity_metadata(None, "user1");
        assert_eq!(merged, serde_json::json!({ "grimoire_user_id": "user1" }));
    }

    #[test]
    fn test_merge_identity_metadata_preserves_existing_keys() {
        let merged = merge_identity_metadata(Some(r#"{"foo":"bar"}"#), "user1");
        assert_eq!(
            merged,
            serde_json::json!({ "foo": "bar", "grimoire_user_id": "user1" })
        );
    }

    #[test]
    fn test_merge_identity_metadata_unparseable_defaults_to_empty_object() {
        let merged = merge_identity_metadata(Some("not json"), "user1");
        assert_eq!(merged, serde_json::json!({ "grimoire_user_id": "user1" }));
    }

    #[test]
    fn test_merge_identity_metadata_non_object_defaults_to_empty_object() {
        let merged = merge_identity_metadata(Some("[1,2,3]"), "user1");
        assert_eq!(merged, serde_json::json!({ "grimoire_user_id": "user1" }));
    }

    #[test]
    fn test_map_knock_status() {
        assert_eq!(map_knock_status("pending"), "pending");
        assert_eq!(map_knock_status("accepted"), "accepted");
        assert_eq!(map_knock_status("rejected"), "denied");
        assert_eq!(map_knock_status("garbage"), "pending");
    }

    #[test]
    fn test_knock_and_invite_id_derivation_is_deterministic_and_distinct() {
        let a = knock_id_for_existing_knock("knock001");
        let b = knock_id_for_existing_knock("knock001");
        assert_eq!(a, b);

        let invite_a = invite_id_for_existing_invite("knock001");
        assert_ne!(a, invite_a, "distinct namespaces must not collide");
    }

    // full end-to-end flow against a real, self-contained tempdir database
    // (its own grimoire.db + haruspex.db, migrated fresh). marked
    // #[ignore] per this crate's existing convention for grimoire lib
    // tests that touch real db pools (the pools are process-wide
    // singletons, so this can't safely share a process with unrelated
    // tests) - run explicitly with:
    // cargo test -p grimoire --lib -- --ignored --exact users::migrate_to_haruspex::tests::test_migrate_to_haruspex_full_flow_is_idempotent
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_migrate_to_haruspex_full_flow_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let data_dir = tmp.path();

        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        database::run_migrations().await.expect("run migrations");

        let pool = database::connect().await.expect("connect");

        let far_future = OffsetDateTime::now_utc().unix_timestamp() + 100_000;

        // user A: active, has an api key.
        sqlx::query(
            "INSERT INTO user_accountz (id, username, api_key, created_at, deleted_at, metadata)
             VALUES ('usera01', 'alice', 'apikey-a', 1000, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .expect("insert user a");

        // user B: soft-deleted, carries its own pre-existing metadata.
        sqlx::query(
            "INSERT INTO user_accountz (id, username, api_key, created_at, deleted_at, metadata)
             VALUES ('userb02', 'bob', NULL, 1100, 5000, '{\"foo\":\"bar\"}')",
        )
        .execute(&pool)
        .await
        .expect("insert user b");

        // one active credential, one soft-deleted credential.
        sqlx::query(
            "INSERT INTO user_credentialz (id, user_id, credential_id, credential_data, name, created_at, last_used_at, deleted_at)
             VALUES ('cred0001', 'usera01', ?, '{}', 'laptop', 1200, 1300, NULL)",
        )
        .bind(b"cred-a".to_vec())
        .execute(&pool)
        .await
        .expect("insert credential 1");

        sqlx::query(
            "INSERT INTO user_credentialz (id, user_id, credential_id, credential_data, name, created_at, last_used_at, deleted_at)
             VALUES ('cred0002', 'usera01', ?, '{}', NULL, 1250, NULL, 1400)",
        )
        .bind(b"cred-b".to_vec())
        .execute(&pool)
        .await
        .expect("insert credential 2");

        // one active device, one soft-deleted device with a NULL
        // last_seen_at (exercises the coalesce-to-created_at fallback).
        sqlx::query(
            "INSERT INTO user_peer_nodez (user_id, node_id, instance_name, created_at, last_seen_at, deleted_at)
             VALUES ('usera01', 'nodeaaa1', 'macbook', 1500, 1600, NULL)",
        )
        .execute(&pool)
        .await
        .expect("insert device 1");

        sqlx::query(
            "INSERT INTO user_peer_nodez (user_id, node_id, instance_name, created_at, last_seen_at, deleted_at)
             VALUES ('userb02', 'nodebbb2', NULL, 1700, NULL, 5000)",
        )
        .execute(&pool)
        .await
        .expect("insert device 2");

        // one pending knock, one already-resolved (rejected) knock.
        sqlx::query(
            "INSERT INTO knock_requestz (id, node_id, username, message, status, created_at, processed_at, processed_by)
             VALUES ('knock001', 'nodeknk1', 'carol', 'let me in', 'pending', 1800, NULL, NULL)",
        )
        .execute(&pool)
        .await
        .expect("insert knock 1");

        sqlx::query(
            "INSERT INTO knock_requestz (id, node_id, username, message, status, created_at, processed_at, processed_by)
             VALUES ('knock002', 'nodeknk2', 'dave', 'please', 'rejected', 1900, 2000, 'usera01')",
        )
        .execute(&pool)
        .await
        .expect("insert knock 2");

        // one active invite, one already-deactivated account-link invite.
        sqlx::query(
            "INSERT INTO invite_codez (id, code, code_type, grants_role, link_for_user_id, link_expires_at, created_at, used_at, used_by_id, is_active)
             VALUES ('invt0001', 'AAAA-BBBB-CCCC-DDDD', 'invite', 'member', NULL, NULL, 2100, NULL, NULL, 1)",
        )
        .execute(&pool)
        .await
        .expect("insert invite 1");

        sqlx::query(
            "INSERT INTO invite_codez (id, code, code_type, grants_role, link_for_user_id, link_expires_at, created_at, used_at, used_by_id, is_active)
             VALUES ('invt0002', 'EEEE-FFFF-GGGG-HHHH', 'account-link', 'viewer', 'usera01', 9999999999, 2200, NULL, NULL, 0)",
        )
        .execute(&pool)
        .await
        .expect("insert invite 2");

        // one live challenge, one already-expired challenge that must not
        // be migrated.
        sqlx::query(
            "INSERT INTO webauthn_challenges (nonce, kind, challenge_json, user_id, username, is_account_link, invite_code, created_at, expires_at)
             VALUES ('nonce-live', 'registration', '{}', NULL, 'erin', 0, NULL, 2300, ?)",
        )
        .bind(far_future)
        .execute(&pool)
        .await
        .expect("insert challenge 1");

        sqlx::query(
            "INSERT INTO webauthn_challenges (nonce, kind, challenge_json, user_id, username, is_account_link, invite_code, created_at, expires_at)
             VALUES ('nonce-dead', 'authentication', '{}', 'usera01', NULL, 0, NULL, 100, 200)",
        )
        .execute(&pool)
        .await
        .expect("insert challenge 2");

        // --- first run ---
        let report1 = migrate_to_haruspex().await.expect("first migration run");

        assert_eq!(report1.identities.examined, 2);
        assert_eq!(report1.identities.inserted, 2);
        assert_eq!(report1.identities.already_existed, 0);

        assert_eq!(report1.api_keys.examined, 1);
        assert_eq!(report1.api_keys.inserted, 1);

        assert_eq!(report1.credentials.examined, 2);
        assert_eq!(report1.credentials.inserted, 2);

        assert_eq!(report1.devices.examined, 2);
        assert_eq!(report1.devices.inserted, 2);

        assert_eq!(report1.knocks.examined, 2);
        assert_eq!(report1.knocks.inserted, 2);

        assert_eq!(report1.invites.examined, 2);
        assert_eq!(report1.invites.inserted, 2);

        assert_eq!(report1.challenges.examined, 2);
        assert_eq!(report1.challenges.inserted, 1);
        assert_eq!(report1.challenges.skipped, 1);

        assert!(report1.unresolved_user_refs.is_empty());
        assert!(report1.unexpected_knock_status.is_empty());
        assert!(report1.is_clean());

        let haruspex_pool = database::connect_haruspex().await.expect("haruspex pool");

        // bridge check + metadata merge spot check for user B.
        let expected_identity_id = haruspex_bridge::identity_id_for_existing_user("userb02");
        let (actual_id, metadata, deleted_at): (String, Option<String>, Option<i64>) =
            sqlx::query_as("SELECT id, metadata, deleted_at FROM identityz WHERE username = 'bob'")
                .fetch_one(&haruspex_pool)
                .await
                .expect("fetch identity b");
        assert_eq!(actual_id, expected_identity_id.to_string());
        assert_eq!(deleted_at, Some(5000));
        let metadata: serde_json::Value =
            serde_json::from_str(&metadata.expect("metadata present")).expect("valid json");
        assert_eq!(metadata["grimoire_user_id"], "userb02");
        assert_eq!(metadata["foo"], "bar");

        // device_nodez coalesce spot check.
        let last_seen_at: i64 =
            sqlx::query_scalar("SELECT last_seen_at FROM device_nodez WHERE node_id = 'nodebbb2'")
                .fetch_one(&haruspex_pool)
                .await
                .expect("fetch device 2");
        assert_eq!(last_seen_at, 1700, "coalesced from created_at");

        // knockz spot check: status mapping, scope, metadata, id format.
        let (id, status, scope_key, scope_json, metadata_json): (
            String,
            String,
            String,
            String,
            Option<String>,
        ) = sqlx::query_as(
            "SELECT id, status, scope_key, scope_json, metadata_json FROM knockz WHERE node_id = 'nodeknk2'",
        )
        .fetch_one(&haruspex_pool)
        .await
        .expect("fetch knock 2");
        assert_eq!(status, "denied", "rejected maps to denied");
        assert_eq!(scope_key, scope_json);
        let scope: KnockScope = serde_json::from_str(&scope_json).expect("valid scope json");
        assert_eq!(
            scope,
            KnockScope::Account {
                requested_username: Some("dave".to_string())
            }
        );
        assert!(
            uuid::Uuid::parse_str(&id).is_ok(),
            "knockz.id must be a valid uuid"
        );
        let metadata_json: serde_json::Value =
            serde_json::from_str(&metadata_json.expect("metadata_json present"))
                .expect("valid json");
        assert_eq!(metadata_json["grimoire_knock_id"], "knock002");

        // invite_codez spot check: id format + link_for_user_id bridge
        // resolution.
        let (invite_id, link_for_user_id): (String, Option<String>) = sqlx::query_as(
            "SELECT id, link_for_user_id FROM invite_codez WHERE code = 'EEEE-FFFF-GGGG-HHHH'",
        )
        .fetch_one(&haruspex_pool)
        .await
        .expect("fetch invite 2");
        assert!(
            uuid::Uuid::parse_str(&invite_id).is_ok(),
            "invite_codez.id must be a valid uuid"
        );
        assert_eq!(
            link_for_user_id,
            Some(haruspex_bridge::identity_id_for_existing_user("usera01").to_string())
        );

        // the expired challenge must not have been migrated.
        let dead_challenge_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM webauthn_challengez WHERE nonce = 'nonce-dead'",
        )
        .fetch_one(&haruspex_pool)
        .await
        .expect("count dead challenge");
        assert_eq!(dead_challenge_count, 0);

        // --- second run: must be a clean no-op, proving idempotence ---
        let report2 = migrate_to_haruspex().await.expect("second migration run");

        assert_eq!(report2.identities.inserted, 0);
        assert_eq!(report2.identities.already_existed, 2);
        assert_eq!(report2.api_keys.inserted, 0);
        assert_eq!(report2.api_keys.already_existed, 1);
        assert_eq!(report2.credentials.inserted, 0);
        assert_eq!(report2.credentials.already_existed, 2);
        assert_eq!(report2.devices.inserted, 0);
        assert_eq!(report2.devices.already_existed, 2);
        assert_eq!(report2.knocks.inserted, 0);
        assert_eq!(report2.knocks.already_existed, 2);
        assert_eq!(report2.invites.inserted, 0);
        assert_eq!(report2.invites.already_existed, 2);
        assert_eq!(report2.challenges.inserted, 0);
        assert_eq!(report2.challenges.already_existed, 1);
        assert_eq!(report2.challenges.skipped, 1);
        assert!(report2.is_clean());
    }
}
