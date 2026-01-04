# Database Migrations

This directory contains the database schema migrations for the WebAuthn authentication server.

## Directory Structure

```
migrations/
├── README.md                    # This file
├── 001_initial.sql             # Core authentication schema (users, invite codes, credentials)
├── 002_session_storage.sql     # Session storage for tower-sessions
├── 003_analytics.sql           # Request analytics and monitoring
└── 004_media_blobs.sql         # Media storage for WebSocket file sharing
```

## Migration Philosophy

These migrations have been **consolidated and modernized** to:

- ✅ Use modern PostgreSQL syntax (`CREATE INDEX IF NOT EXISTS`, etc.)
- ✅ Eliminate verbose idempotent wrapping where possible
- ✅ Group related tables into single migrations
- ✅ Maintain readability and safety

## Running Migrations

### Using sqlx-cli (Recommended)

1. Install sqlx-cli if you haven't already:

   ```bash
   cargo install sqlx-cli --features postgres
   ```

2. Set your database URL:

   ```bash
   export DATABASE_URL="postgresql://username:password@localhost:5432/webauthn_db"
   ```

3. Run migrations:
   ```bash
   sqlx migrate run
   ```

### Using the CLI tool

The project includes a CLI tool that automatically runs migrations:

```bash
cargo run --bin cli users stats  # Any command that connects to DB will run migrations
```

### Manual Migration

If you prefer to run migrations manually:

```bash
# Run each migration file in order
psql -d webauthn_db -f migrations/001_initial.sql
psql -d webauthn_db -f migrations/002_session_storage.sql
psql -d webauthn_db -f migrations/003_analytics.sql
psql -d webauthn_db -f migrations/004_media_blobs.sql
```

## Migration Files

### 001_initial.sql - Core Authentication Schema

Creates the foundational authentication tables:

- **`invite_codes`** - Invitation and account link codes (8-128 chars, supports word-based codes)
- **`users`** - User accounts with roles and invite tracking
- **`webauthn_credentials`** - WebAuthn/FIDO2 passkey storage

**Features included:**

- Account linking system (link new credentials to existing users)
- Flexible invite code lengths (supports both `ABC123` and `happy-llama-disco` styles)
- Comprehensive constraints and foreign keys
- Optimized indexes including hash index for code lookups

### 002_session_storage.sql - Session Management

Session storage for tower-sessions PostgreSQL backend:

- **`tower_sessions`** - Session data storage
- **`cleanup_expired_sessions()`** - Utility function for session cleanup
- Efficient indexes for session lookups and expiration management

### 003_analytics.sql - Request Analytics

HTTP request monitoring and analytics:

- **`request_analytics`** - Detailed request tracking
- Performance metrics (duration, response size)
- User attribution and error tracking
- Distributed tracing support (trace_id, span_id)

### 004_media_blobs.sql - Media Storage

WebSocket file sharing infrastructure:

- **`media_blobs`** - Binary data and metadata storage
- SHA256 deduplication support
- Flexible storage (inline BYTEA or external file paths)
- Automatic timestamp management

## Key Features

### Modern PostgreSQL Syntax

- Uses `CREATE INDEX IF NOT EXISTS` (PostgreSQL 9.5+)
- Cleaner constraint definitions
- Minimal verbose wrapping

### Invite Code System

- **Traditional codes**: `ABC123XYZ789` (8-128 characters)
- **Word-based codes**: `happy-llama-disco` (using wordlist)
- **Account linking**: Link new passkeys to existing accounts
- **Flexible validation**: Supports alphanumeric, hyphens, underscores

### Performance Optimizations

- Hash indexes for exact-match lookups (invite codes)
- Partial indexes for active records only
- Proper foreign key relationships
- Strategic indexing for common query patterns

## Database Queries

SQL queries are defined inline in the Rust application code using sqlx macros. This provides:

- Compile-time query validation
- Type safety
- Better maintainability
- IDE support with query analysis

## Best Practices

1. **Never modify existing migration files** - Always create new migrations for schema changes
2. **Test migrations** on a copy of your data before applying to production
3. **Backup your database** before running migrations
4. **Review constraint logic** - The consolidated migrations include complex business rules
5. **Monitor performance** - Use the analytics table to track query performance

## Starting Fresh

To completely reset your database:

1. Drop and recreate the database:

   ```sql
   DROP DATABASE IF EXISTS webauthn_db;
   CREATE DATABASE webauthn_db;
   ```

2. Run all migrations:

   ```bash
   sqlx migrate run
   ```

3. Generate a wordlist for invite codes:

   ```bash
   cargo run --bin cli wordlist generate
   ```

4. Create your first admin user:
   ```bash
   cargo run --bin cli users create-admin admin
   ```

## Troubleshooting

### Common Issues

**Migration fails with constraint violation:**

- Ensure you're starting with a clean database
- Check that existing data meets the new constraints

**sqlx compile-time errors:**

- Run `cargo sqlx prepare --workspace` after schema changes
- Ensure DATABASE_URL is set correctly

**Wordlist warnings on startup:**

- Run `cargo run --bin cli wordlist generate` to create wordlist
- Word-based invite codes require this file

### PostgreSQL Version Requirements

- **Minimum**: PostgreSQL 9.5+ (for `CREATE INDEX IF NOT EXISTS`)
- **Recommended**: PostgreSQL 12+ (for better constraint support)
- **Features**: All modern PostgreSQL features are supported

### Performance Monitoring

Use the analytics table to monitor:

```sql
-- Slow queries
SELECT path, AVG(duration_ms), COUNT(*)
FROM request_analytics
WHERE duration_ms > 1000
GROUP BY path;

-- Error rates
SELECT path, status_code, COUNT(*)
FROM request_analytics
WHERE status_code >= 400
GROUP BY path, status_code;
```
