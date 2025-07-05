# SQLite Schema Port

This directory contains a SQLite port of the original PostgreSQL schema from the `migrations/` directory. The schema has been simplified and adapted to work with SQLite's capabilities and limitations.

## Files Overview

- `01_auth.sql` - Authentication tables (users, invite codes, WebAuthn credentials, sessions)
- `02_media.sql` - Media storage and processing (blobs, thumbnails, analytics)
- `03_music.sql` - Music domain (songs, playlists, music jobs)
- `04_photos.sql` - Photos domain (photos, galleries, image metadata)
- `05_videos.sql` - Videos domain (videos, video playlists, chapters)

## Key Changes from PostgreSQL

### Data Types
- `UUID` → `TEXT` with `lower(hex(randomblob(16)))` for ID generation
- `TIMESTAMPTZ` → `DATETIME` (no timezone support)
- `JSONB` → `TEXT` (storing JSON as text)
- `BYTEA` → `BLOB`
- `INTERVAL` → `INTEGER` (storing seconds/milliseconds)
- `DECIMAL` → `REAL`
- `TEXT[]` → `TEXT` (storing arrays as JSON strings)

### Removed Features
- **PostgreSQL NOTIFY/LISTEN system** - No SQLite equivalent
- **Stored procedures/functions** - Converted to views where possible
- **PL/pgSQL triggers** - Simplified to basic SQLite triggers
- **Complex CHECK constraints** - Simplified where needed
- **Hash indexes** - SQLite doesn't support hash indexes
- **GIN indexes** - No SQLite equivalent for JSON/array indexing
- **Comments** - Removed for simplicity

### Simplified Features
- **Partial indexes** - Kept where SQLite supports them
- **Triggers** - Only basic update timestamp triggers
- **Views** - Kept simple views, removed complex aggregations
- **Constraints** - Simplified complex multi-column checks

### ID Generation
SQLite doesn't have built-in UUID generation, so we use:
```sql
DEFAULT (lower(hex(randomblob(16))))
```
This generates a 32-character hex string similar to UUID format.

### JSON Handling
- PostgreSQL's `JSONB` operations are replaced with text storage
- JSON functions would need to be handled in application code
- Arrays are stored as JSON text strings

### Triggers
Only basic triggers are included:
- `updated_at` timestamp updates
- Simple position maintenance for playlists/galleries

## Missing Functionality

### Real-time Notifications
The original schema heavily relied on PostgreSQL's NOTIFY/LISTEN for real-time updates. In SQLite, you would need to implement this through:
- WebSocket connections
- Polling mechanisms
- External message queues (Redis, etc.)

### Complex Queries
Many of the original stored procedures and complex aggregations would need to be implemented in application code:
- Playlist management functions
- Complex media queries with aggregations
- Advanced search functionality

### Advanced Indexing
SQLite doesn't support:
- Hash indexes
- GIN indexes for JSON/array data
- Some partial index expressions

## Usage

To create the SQLite database:

```bash
sqlite3 app.db < 01_auth.sql
sqlite3 app.db < 02_media.sql
sqlite3 app.db < 03_music.sql
sqlite3 app.db < 04_photos.sql
sqlite3 app.db < 05_videos.sql
```

Or run all at once:
```bash
cat *.sql | sqlite3 app.db
```

## Application Changes Required

If migrating from PostgreSQL to SQLite, the application would need significant changes:

1. **Replace notification system** - Implement WebSocket/polling for real-time updates
2. **Move stored procedures to application code** - All the PostgreSQL functions need to be reimplemented
3. **Handle JSON differently** - Parse/stringify JSON in application code
4. **Update query patterns** - Some complex queries may need restructuring
5. **ID generation** - Handle UUID generation in application code if needed
6. **Timezone handling** - Handle timezone conversions in application code

## Performance Considerations

- SQLite performs well for read-heavy workloads but may struggle with high-concurrency writes
- The simplified schema should be faster for basic operations
- Missing indexes for JSON/array data may impact search performance
- Consider using SQLite's FTS (Full-Text Search) for text search functionality

## Recommendations

This SQLite port is suitable for:
- Development/testing environments
- Single-user applications
- Applications with moderate concurrency requirements
- Embedded applications

For production use with high concurrency or complex real-time requirements, PostgreSQL remains the better choice.
