# Grimoire CLI Testing Guide

This document contains all the CLI commands to test the complete functionality in grimoire, including playlists, users, wordlists, and more.

## Prerequisites

Set environment variables for clean testing:

```bash
cd grimoire
export RUSTFLAGS="-A warnings"
export DATABASE_URL="sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db"
```

**Note**: Favorites and ratings commands require existing songs, artists, or albums in the database. If you don't have any music data imported yet, the favorites/ratings commands will work but operate on non-existent targets. Import some music files first using the music scanner for full testing.

## User System Testing

### 1. Generate Invite Codes

```bash
# Generate 3 invite codes with 3 words each
cargo run -- users generate-invites --count 3 --word-count 3

# Generate account link code with expiration
cargo run -- users generate-invites --count 1 --word-count 4 --code-type account-link --expires-hours 24
```

### 2. Create Users

```bash
# Create first admin user (bootstrap - no invite code needed)
cargo run -- users create --username superadmin --role admin --bootstrap

# Create regular user with invite code
cargo run -- users create --username testuser --role member --invite-code grape-rat-quail

# Create admin user with invite code
cargo run -- users create --username admin --role admin --invite-code rat-kazoo-koala
```

### 3. List Users

```bash
# List all users
cargo run -- users list

# Filter by role
cargo run -- users list --role admin
cargo run -- users list --role member

# Include deleted users
cargo run -- users list --include-deleted

# Pagination
cargo run -- users list --limit 10 --offset 0
```

### 4. Update Users

```bash
# Promote user to admin
cargo run -- users update --user-id a4171acc168d10a5 --role admin

# Demote admin to member
cargo run -- users update --user-id 719a3b2cfe3e6cc4 --role member
```

### 5. Delete Users

```bash
# Soft delete a user
cargo run -- users delete --user-id a4171acc168d10a5
```

### 6. Manage Invite Codes

```bash
# List all invite codes
cargo run -- users list-invites

# List only active codes
cargo run -- users list-invites --active-only

# Deactivate an invite code
cargo run -- users deactivate-invite jam-enchilada-bagel
```

### 7. Favorites Management

```bash
# Set favorites for a user (requires existing songs/artists/albums)
cargo run -- users set-favorite --user-id d9b6f884b91daebf --target-type song --target-id some-song-id
cargo run -- users set-favorite --user-id d9b6f884b91daebf --target-type artist --target-id some-artist-id
cargo run -- users set-favorite --user-id d9b6f884b91daebf --target-type album --target-id some-album-id

# Remove favorites
cargo run -- users remove-favorite --user-id d9b6f884b91daebf --target-type song --target-id some-song-id

# List all favorites for a user
cargo run -- users list-favorites --user-id d9b6f884b91daebf

# List favorites by type
cargo run -- users list-favorites --user-id d9b6f884b91daebf --target-type song
cargo run -- users list-favorites --user-id d9b6f884b91daebf --target-type artist --limit 10
```

### 8. Ratings Management

```bash
# Set ratings (1-5 stars)
cargo run -- users set-rating --user-id d9b6f884b91daebf --target-type song --target-id some-song-id --rating 5
cargo run -- users set-rating --user-id d9b6f884b91daebf --target-type artist --target-id some-artist-id --rating 4
cargo run -- users set-rating --user-id d9b6f884b91daebf --target-type album --target-id some-album-id --rating 3

# Remove ratings
cargo run -- users remove-rating --user-id d9b6f884b91daebf --target-type song --target-id some-song-id

# Get rating statistics for an item
cargo run -- users rating-stats --target-type song --target-id some-song-id
cargo run -- users rating-stats --target-type artist --target-id some-artist-id

# Get top-rated items
cargo run -- users top-rated --target-type song --min-ratings 2 --limit 10
cargo run -- users top-rated --target-type artist --min-ratings 1 --limit 5
cargo run -- users top-rated --target-type album --min-ratings 3 --limit 20
```

## Wordlist Testing

### 1. Generate Wordlists

```bash
# Generate with all categories
cargo run -- wordlist generate --count 100 --include-silly --include-animals --include-food --mixed

# Save to file
cargo run -- wordlist generate --count 50 --include-animals --mixed --output /tmp/test-wordlist.txt

# Generate specific categories only
cargo run -- wordlist generate --count 25 --include-silly --mixed
```

### 2. Validate Wordlists

```bash
# Validate existing wordlist file
cargo run -- wordlist validate assets/config/wordlist.txt

# Validate generated file
cargo run -- wordlist validate /tmp/test-wordlist.txt
```

### 3. Get Wordlist Statistics

```bash
# Get stats for default wordlist
cargo run -- wordlist stats assets/config/wordlist.txt

# Get stats for generated file
cargo run -- wordlist stats /tmp/test-wordlist.txt
```

### 4. Generate Word Codes

```bash
# Generate codes using default wordlist
cargo run -- wordlist generate-code --word-count 3 --count 5 --wordlist-file assets/config/wordlist.txt

# Single word code
cargo run -- wordlist generate-code --word-count 2 --count 1 --wordlist-file assets/config/wordlist.txt
```

## Playlist Testing

### 1. Create Playlists

### Create Public Playlist

```bash
cargo run -- music create-playlist --title "Test All Features" --description "Testing all playlist CRUD operations" --public
```

### Create Private Playlist

```bash
cargo run -- music create-playlist --title "Private Test" --description "Private playlist"
```

## 2. Query Playlists

### List All Playlists

```bash
cargo run -- music query-playlists
```

### Search Playlists by Title

```bash
cargo run -- music query-playlists --search "Test"
```

### Filter Public Playlists Only

```bash
cargo run -- music query-playlists --is-public true
```

### Filter Private Playlists Only

```bash
cargo run -- music query-playlists --is-public false
```

### Sort Playlists by Title (Descending)

```bash
cargo run -- music query-playlists --sort-by title --sort-direction desc
```

## 3. Add Songs to Playlists

### Get Some Song IDs for Testing

```bash
sqlite3 data/grimoire.db "SELECT id, title FROM songz LIMIT 5;"
```

### Add Songs to Playlist (Auto-append)

```bash
# Replace playlist-id and song-ids with actual values
cargo run -- music add-songs-to-playlist --playlist-id "91d57dd455f087ba" --song-ids "00eabe6d96f74562,04870990498d0520,066178bd934fc774"
```

## 4. Query Playlist Songs

### View Songs in Playlist (Position-ordered)

```bash
cargo run -- music query-playlist-songs --playlist-id "91d57dd455f087ba"
```

### Search Within Playlist

```bash
cargo run -- music query-playlist-songs --playlist-id "91d57dd455f087ba" --search "artist_name"
```

### Check Positions in Database

```bash
sqlite3 data/grimoire.db "SELECT ps.position, s.title FROM playlist_songz ps JOIN songz s ON ps.song_rowid = s.rowid WHERE ps.playlist_rowid = (SELECT rowid FROM playlistz WHERE id = 'PLAYLIST_ID') ORDER BY ps.position;"
```

## 5. Position Reordering

### Single Song Position Update

```bash
# Move first song to position 3
cargo run -- music update-song-position --playlist-id "91d57dd455f087ba" --song-ids "00eabe6d96f74562" --new-position 3
```

### Multiple Song Position Update

```bash
# Move two songs to position 1 (they become positions 1 and 2)
cargo run -- music update-song-position --playlist-id "91d57dd455f087ba" --song-ids "04870990498d0520,066178bd934fc774" --new-position 1
```

## 6. Test Triggers

### Test Gap Closure (Delete Song)

```bash
# Delete a song from middle position - remaining songs should shift down
sqlite3 data/grimoire.db "DELETE FROM playlist_songz WHERE playlist_rowid = (SELECT rowid FROM playlistz WHERE id = 'PLAYLIST_ID') AND position = 2;"

# Verify gap was closed
sqlite3 data/grimoire.db "SELECT ps.position, s.title FROM playlist_songz ps JOIN songz s ON ps.song_rowid = s.rowid WHERE ps.playlist_rowid = (SELECT rowid FROM playlistz WHERE id = 'PLAYLIST_ID') ORDER BY ps.position;"
```

### Test Auto-append (Add More Songs)

```bash
# Add another song - should auto-append to end
cargo run -- music add-songs-to-playlist --playlist-id "91d57dd455f087ba" --song-ids "ANOTHER_SONG_ID"

# Verify it was added at the end
cargo run -- music query-playlist-songs --playlist-id "91d57dd455f087ba"
```

## 7. Delete Playlist

### Delete a Playlist

```bash
cargo run -- music delete-playlist --playlist-id "a2deeeeffd286cac"
```

### Verify Deletion

```bash
cargo run -- music query-playlists
```

## 8. Update Playlist Metadata

### Update Playlist Title and Description

```bash
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --title "Updated Title" --description "New description"
```

### Update Multiple Fields at Once

```bash
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --title "Final Title" --description "Complete description" --public
```

### Set Playlist Thumbnail (From File)

```bash
# Using test images from /Users/edward/Desktop/albumartz
# Automatically converts to WebP format for optimal compression
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --thumbnail-path "/Users/edward/Desktop/albumartz/23minoverbrussels.jpg"
```

### Test WebP Conversion and Deduplication

```bash
# First upload - creates new WebP blob
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --title "WebP Test" --thumbnail-path "/Users/edward/Desktop/albumartz/23minoverbrussels.jpg"

# Second upload of same image - should reuse existing blob (same blob ID)
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --thumbnail-path "/Users/edward/Desktop/albumartz/23minoverbrussels.jpg"

# Verify WebP conversion worked
sqlite3 data/grimoire.db "SELECT id, mime, blob_type, size, metadata FROM media_blobz WHERE id = (SELECT thumbnail_blob_id FROM playlistz WHERE id = 'PLAYLIST_ID');"
```

### Set Playlist Thumbnail (Existing Media Blob)

```bash
# Using an existing media blob ID as thumbnail
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --thumbnail-blob-id "some-media-blob-id"
```

### Update Title Only

```bash
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --title "New Title Only"
```

### Update Description Only

```bash
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --description "New description only"
```

### Make Playlist Private

```bash
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --private
```

### Make Playlist Public

```bash
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --public
```

### Remove Playlist Thumbnail

```bash
# Remove thumbnail without deleting the media blob
cargo run -- music remove-playlist-thumbnail --playlist-id "91d57dd455f087ba"

# Remove thumbnail AND delete the media blob if no other references exist
cargo run -- music remove-playlist-thumbnail --playlist-id "91d57dd455f087ba" --cleanup-blob
```

### Check Media Blob References

```bash
# Check what's referencing a specific media blob before deletion
cargo run -- music check-blob-references --blob-id "dc7b06f3860c9cff"
```

### Set Thumbnail to Empty (Alternative Method)

```bash
# Alternative: set to empty string (but doesn't clean up blob)
cargo run -- music update-playlist --playlist-id "91d57dd455f087ba" --thumbnail-blob-id ""
```

### Verify Updates

```bash
# Check the updated playlist
cargo run -- music query-playlists --search "Final Title"

# Or query all playlists to see changes
cargo run -- music query-playlists
```

## Complete User System Test Sequence

Here's a complete test sequence for the user system:

```bash
# 1. Create first admin user (bootstrap)
cargo run -- users create --username admin --role admin --bootstrap

# 2. Generate invite codes
cargo run -- users generate-invites --count 5 --word-count 3

# 3. Create regular users with invite codes
cargo run -- users create --username alice --role member --invite-code [CODE1]
cargo run -- users create --username bob --role member --invite-code [CODE2]

# 4. List all users
cargo run -- users list

# 5. Promote a user to admin
cargo run -- users update --user-id [USER_ID] --role admin

# 6. Check invite code status
cargo run -- users list-invites

# 7. Deactivate unused codes
cargo run -- users deactivate-invite [UNUSED_CODE]

# 8. Test favorites (requires existing songs/artists/albums)
cargo run -- users set-favorite --user-id [USER_ID] --target-type song --target-id [SONG_ID]
cargo run -- users set-favorite --user-id [USER_ID] --target-type artist --target-id [ARTIST_ID]
cargo run -- users list-favorites --user-id [USER_ID]

# 9. Test ratings (requires existing songs/artists/albums)
cargo run -- users set-rating --user-id [USER_ID] --target-type song --target-id [SONG_ID] --rating 5
cargo run -- users set-rating --user-id [USER_ID] --target-type artist --target-id [ARTIST_ID] --rating 4
cargo run -- users rating-stats --target-type song --target-id [SONG_ID]
cargo run -- users top-rated --target-type song --min-ratings 1 --limit 10

# 10. Test user deletion
cargo run -- users delete --user-id [USER_ID]

# 11. Verify deletion
cargo run -- users list --include-deleted
```

## User System Expected Results

After each user test, verify:

1. **Bootstrap works**: First admin can be created without invite code
2. **Invite validation**: Users can only be created with valid, unused invite codes
3. **Role management**: User roles can be updated by admins
4. **Invite tracking**: Codes show USED status after being consumed
5. **User listing**: Filters work correctly for role and deletion status
6. **Favorites work**: Users can favorite items and list their favorites
7. **Ratings work**: Users can rate items (1-5 stars) and view statistics
8. **Top-rated queries**: Can retrieve top-rated items with minimum rating thresholds
9. **Soft deletion**: Deleted users are hidden by default but can be shown
10. **Permission enforcement**: Only admins can manage users (in service layer)

## Complete Test Sequence

Here's a complete test sequence that exercises all functionality:

```bash
# 1. Create test playlists
cargo run -- music create-playlist --title "Complete Test" --description "Testing everything" --public

# 2. Add songs
cargo run -- music add-songs-to-playlist --playlist-id "PLAYLIST_ID" --song-ids "ID1,ID2,ID3,ID4"

# 3. Test reordering
cargo run -- music update-song-position --playlist-id "PLAYLIST_ID" --song-ids "ID1" --new-position 4
cargo run -- music update-song-position --playlist-id "PLAYLIST_ID" --song-ids "ID2,ID3" --new-position 1

# 4. Test metadata updates with WebP thumbnail
cargo run -- music update-playlist --playlist-id "PLAYLIST_ID" --title "Final Title" --description "Updated description" --public --thumbnail-path "/Users/edward/Desktop/albumartz/23minoverbrussels.jpg"

# 5. Test filtering
cargo run -- music query-playlists --is-public true
cargo run -- music query-playlists --search "Final"

# 6. Clean up
cargo run -- music delete-playlist --playlist-id "PLAYLIST_ID"
```

## Expected Results

After each test, verify:

1. **Positions are sequential**: Always 1, 2, 3, 4... (no gaps)
2. **Auto-append works**: New songs go to end of playlist
3. **Reordering works**: Both single and multiple song moves
4. **Filtering works**: Public/private and search filters return correct results
5. **Metadata updates**: Title, description, visibility, thumbnail changes persist
6. **Gap closure**: Deleting songs closes position gaps automatically
7. **Thumbnail handling**: File uploads create WebP media blobs correctly
8. **WebP conversion**: All thumbnail images converted to WebP format automatically
9. **Deduplication**: Same image uploaded multiple times reuses existing blob (same SHA256)
10. **Thumbnail removal**: Can remove thumbnails with or without media blob cleanup
11. **Reference checking**: Can verify what's using a media blob before deletion
12. **Safe cleanup**: Media blobs only deleted when no references exist
13. **Orphaned blob detection**: Finds media blobs with zero references across all tables
14. **Maintenance operations**: Both dry-run and actual deletion modes work correctly
15. **Retention policies**: Configurable retention periods for hard deletion

## Troubleshooting

### If position reordering fails:

- Check that all song IDs exist in the playlist
- Verify playlist ID is correct
- Check for any constraint violations in the logs

### If filtering doesn't work:

- Ensure playlist has the expected is_public value
- Check that search terms match title/description content

### If auto-append doesn't work:

- Verify the auto-append trigger exists: `sqlite3 data/grimoire.db ".schema playlist_songz"`
- Check that songs were added with position = -1 initially

### If thumbnail upload fails:

- Check that the file exists and is readable
- Verify the file is an image format (jpg, png, gif, webp)
- Ensure the file is under 10MB in size
- Check that media blob was created: `sqlite3 data/grimoire.db "SELECT id, mime, blob_type, size FROM media_blobz ORDER BY created_at DESC LIMIT 5;"`
- Verify WebP conversion: `sqlite3 data/grimoire.db "SELECT mime FROM media_blobz WHERE id = 'BLOB_ID';"` should show `image/webp`
- Check deduplication: uploading the same image twice should return the same blob ID

## 9. Maintenance Operations

### Check Media Blob References

```bash
# See what's using a specific media blob
cargo run -- music check-blob-references --blob-id "dc7b06f3860c9cff"
```

### Clean Up Orphaned Media Blobs

```bash
# Dry run to see what would be deleted
cargo run -- music cleanup-orphaned-blobs --dry-run

# Actually delete orphaned blobs
cargo run -- music cleanup-orphaned-blobs

# Only delete orphaned blobs older than 7 days
cargo run -- music cleanup-orphaned-blobs --min-age-days 7.0 --dry-run
cargo run -- music cleanup-orphaned-blobs --min-age-days 7.0
```

### Hard Delete Old Soft-Deleted Records

```bash
# Dry run to see what would be permanently deleted (30 day retention)
cargo run -- music hard-delete-old-records --dry-run

# Actually hard delete old records (30 day retention)
cargo run -- music hard-delete-old-records

# Custom retention period (90 days)
cargo run -- music hard-delete-old-records --retention-days 90 --dry-run

# Don't delete blob_data (keep binary data)
cargo run -- music hard-delete-old-records --keep-blob-data
```

### Run Full Maintenance

```bash
# Complete maintenance: orphaned blobs + hard delete old records
cargo run -- music run-maintenance --dry-run

# Actually run full maintenance
cargo run -- music run-maintenance

# Custom retention period for full maintenance
cargo run -- music run-maintenance --retention-days 60
```

### Verify Maintenance Results

```bash
# Check total media blob count before/after
sqlite3 data/grimoire.db "SELECT COUNT(*) as total, COUNT(deleted_at) as deleted FROM media_blobz;"

# Check soft-deleted records older than 30 days
sqlite3 data/grimoire.db "SELECT
    'Songs' as table_name, COUNT(*) as old_deleted
    FROM songz
    WHERE deleted_at IS NOT NULL AND deleted_at < unixepoch() - (30 * 24 * 60 * 60)
UNION ALL SELECT
    'Playlists', COUNT(*)
    FROM playlistz
    WHERE deleted_at IS NOT NULL AND deleted_at < unixepoch() - (30 * 24 * 60 * 60)
UNION ALL SELECT
    'Media Blobs', COUNT(*)
    FROM media_blobz
    WHERE deleted_at IS NOT NULL AND deleted_at < unixepoch() - (30 * 24 * 60 * 60);"
```

## Song Update Testing

### 1. Query Songs to Get IDs

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music query-songs --limit 5
```

Get song IDs from the database:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT id, title FROM songz LIMIT 5"
```

### 2. Update Single Song Fields

Update title and year:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids 82025d33b858cc60 \
  --title "Guillotine (Updated)" \
  --year 2011
```

Update BPM and key signature:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids c76a032c21c31ad1 \
  --bpm 140 \
  --key-signature "F# minor"
```

Verify the updates:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT title, year, bpm, key_signature FROM songz WHERE id IN ('82025d33b858cc60', 'c76a032c21c31ad1')"
```

### 3. Update Relationships (Artist, Album, Genre)

Set artist and album for multiple songs:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60,c76a032c21c31ad1" \
  --artist "Death Grips" \
  --album "Exmilitary"
```

Verify relationships:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT s.title, ar.name as artist, al.title as album FROM songz s LEFT JOIN artist_songz ars ON s.id = ars.song_id LEFT JOIN artistz ar ON ars.artist_id = ar.id LEFT JOIN album_songz als ON s.id = als.song_id LEFT JOIN albumz al ON als.album_id = al.id WHERE s.id IN ('82025d33b858cc60', 'c76a032c21c31ad1')"
```

Set genre:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --genre "Experimental Hip Hop"
```

Set genre with sub-genre:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --genre "Hip Hop" \
  --sub-genre "Industrial Hip Hop"
```

Verify sub-genre was created and linked:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT sg.name as sub_genre, g.name as parent_genre FROM sub_genrez sg LEFT JOIN genrez g ON sg.parent_genre_id = g.id WHERE sg.name = 'Industrial Hip Hop'"
```

### 4. Update Album Metadata

Update album with additional metadata:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --album "Exmilitary" \
  --album-type "album" \
  --release-date "2011-04-25" \
  --label "Third Worlds"
```

### 5. Manage Tags (Album-Level)

Add tags to album:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --album "Exmilitary" \
  --add-tags "experimental,hip-hop,industrial"
```

Verify tags were created and linked:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT t.name FROM tagz t INNER JOIN album_tagz at ON t.id = at.tag_id INNER JOIN albumz a ON at.album_id = a.id WHERE a.title = 'Exmilitary'"
```

Remove tags from album:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --album "Exmilitary" \
  --remove-tags "industrial"
```

Replace all tags on album:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --album "Exmilitary" \
  --replace-tags "noise,experimental,hip-hop"
```

### 6. User Favorites

Get a user ID:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT id, username FROM user_accountz LIMIT 1"
```

Set song as favorite:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --user-id "9c4d48c5c9507aa6" \
  --favorite-song true
```

Set artist as favorite:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --user-id "9c4d48c5c9507aa6" \
  --favorite-artist true
```

Set album as favorite:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --user-id "9c4d48c5c9507aa6" \
  --favorite-album true
```

Remove favorite:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --user-id "9c4d48c5c9507aa6" \
  --favorite-song false
```

Verify favorites:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT user_id, target_type, target_id FROM user_favoritez WHERE user_id = '9c4d48c5c9507aa6'"
```

### 7. User Ratings

Rate a song (1-5):

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --user-id "9c4d48c5c9507aa6" \
  --rate-song 5
```

Rate an artist:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --user-id "9c4d48c5c9507aa6" \
  --rate-artist 4
```

Rate an album:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --user-id "9c4d48c5c9507aa6" \
  --rate-album 5
```

Verify ratings:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT user_id, target_type, target_id, rating FROM user_ratingz WHERE user_id = '9c4d48c5c9507aa6'"
```

### 8. Bulk Updates

Update multiple songs with same values:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60,c76a032c21c31ad1,f19633242cc89ed6" \
  --artist "Death Grips" \
  --album "Exmilitary" \
  --year 2011
```

Bulk update with tags and ratings:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60,c76a032c21c31ad1,f19633242cc89ed6" \
  --artist "Death Grips" \
  --album "Exmilitary" \
  --add-tags "experimental,hip-hop" \
  --user-id "9c4d48c5c9507aa6" \
  --rate-album 5
```

Verify bulk updates:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT s.title, s.year, ar.name, al.title FROM songz s LEFT JOIN artist_songz ars ON s.id = ars.song_id LEFT JOIN artistz ar ON ars.artist_id = ar.id LEFT JOIN album_songz als ON s.id = als.song_id LEFT JOIN albumz al ON als.album_id = al.id WHERE s.id IN ('82025d33b858cc60', 'c76a032c21c31ad1', 'f19633242cc89ed6')"
```

### 9. Set Thumbnail from File

Update song with thumbnail from image file (automatically converts to WebP):

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --thumbnail-file "/Users/edward/Desktop/albumartz/23minoverbrussels.jpg"
```

Verify thumbnail was created:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
sqlite3 ../data/grimoire.db "SELECT s.title, s.thumbnail_blob_id, m.blob_type, m.mime, m.size FROM songz s LEFT JOIN media_blobz m ON s.thumbnail_blob_id = m.id WHERE s.id = '82025d33b858cc60'"
```

Or use an existing blob ID:

```bash
DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db \
RUSTFLAGS="-A warnings" \
cargo run --bin grimoire -- music update-songs \
  --song-ids "82025d33b858cc60" \
  --thumbnail-blob-id "EXISTING_BLOB_ID"
```

## MusicBrainz Integration Testing

### Prerequisites

MusicBrainz integration requires an internet connection and respects rate limiting (1 second between requests).

```bash
cd grimoire
export RUSTFLAGS="-A warnings"
export DATABASE_URL="sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db"
```

### 1. Test Configuration

```bash
# Test MusicBrainz configuration and rate limiter
cargo run -- music music-brainz test-config
```

### 2. Search for Songs/Recordings

```bash
# Search by title only
cargo run -- music music-brainz search-song --title "Pyramid Song"

# Search with artist
cargo run -- music music-brainz search-song \
  --title "Pyramid Song" \
  --artist "Radiohead"

# Search with artist and album
cargo run -- music music-brainz search-song \
  --title "Karma Police" \
  --artist "Radiohead" \
  --album "OK Computer"

# Limit results
cargo run -- music music-brainz search-song \
  --title "Let Down" \
  --artist "Radiohead" \
  --limit 5

# Show full JSON response
cargo run -- music music-brainz search-song \
  --title "Everything In Its Right Place" \
  --artist "Radiohead" \
  --json
```

### 3. Search for Albums/Releases

```bash
# Basic album search
cargo run -- music music-brainz search-album \
  --artist "Radiohead" \
  --album "Kid A"

# Shows cover art availability!
cargo run -- music music-brainz search-album \
  --artist "Radiohead" \
  --album "OK Computer"

# Limit results
cargo run -- music music-brainz search-album \
  --artist "Radiohead" \
  --album "In Rainbows" \
  --limit 5

# Show full JSON response
cargo run -- music music-brainz search-album \
  --artist "Radiohead" \
  --album "The Bends" \
  --json
```

### 4. Get Specific Recording by MusicBrainz ID

```bash
# Get full recording details (includes releases, tags, etc.)
cargo run -- music music-brainz get-recording \
  6b9e9b5d-9a5e-4e5e-9e5e-9e5e9e5e9e5e

# Example: Get "Pyramid Song" details
cargo run -- music music-brainz get-recording \
  539d01c7-9fc0-44a5-b8a6-61707e6c3f8e
```

### 5. Get Specific Release by MusicBrainz ID

```bash
# Get full release details (includes tracks, media, artist credits)
cargo run -- music music-brainz get-release \
  a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Example: Get "OK Computer" details
cargo run -- music music-brainz get-release \
  3c8d0d37-18e4-4ab6-b67e-e8e5d19e2de6
```

### 6. Get Cover Art for a Release

```bash
# Fetch all cover art images for a release
cargo run -- music music-brainz get-cover-art \
  3c8d0d37-18e4-4ab6-b67e-e8e5d19e2de6

# Shows:
# - Image IDs
# - Types (Front, Back, Booklet, etc.)
# - Full image URLs
# - Thumbnail URLs (250px, 500px, 1200px)
# - Which images are approved
# - Comments
```

### Real-World Album Art Search Workflow

This is the improved workflow for finding album art:

```bash
# Step 1: Search for the album
cargo run -- music music-brainz search-album \
  --artist "Radiohead" \
  --album "OK Computer"

# Output shows:
# [1] Radiohead - OK Computer
#     ID: 3c8d0d37-18e4-4ab6-b67e-e8e5d19e2de6
#     Date: 1997-05-21
#     Country: XE
#     Cover Art: ✓ (3 images available)  <- Know upfront!
#     Front Cover: ✓

# Step 2: Get the cover art
cargo run -- music music-brainz get-cover-art \
  3c8d0d37-18e4-4ab6-b67e-e8e5d19e2de6

# Output shows all available images with:
# - Thumbnail URLs for preview
# - Large thumbnail URLs for high quality
# - Full image URLs
# - Whether each is front/back/etc.

# Step 3: Web UI will download and apply selected image
# (Using existing blob system and update_songs API)
```

### Expected Behavior

- **Rate Limiting**: 1 second wait between MusicBrainz API requests
- **Cover Art**: No rate limiting (different service)
- **Search Results**: Show confidence scores (MusicBrainz relevance)
- **Album Search**: Shows cover art availability upfront
- **Cover Art URLs**: Multiple sizes available for preview/download

### Notes

- All MusicBrainz operations are **search/retrieval only**
- No automated metadata application
- Web UI will handle applying selected metadata
- Cover art info is shown in search results (no extra call needed!)
- Multiple thumbnail sizes available (250px, 500px, 1200px)

---

### Expected Results for Song Updates

After running the update tests:

- Song fields (title, year, bpm, key_signature) should be updated
- Artist/album/genre relationships should be created or referenced
- Tags should be linked to albums
- User favorites should be recorded in user_favoritez table
- User ratings should be recorded in user_ratingz table
- Bulk updates should affect all specified songs
- Deduplication should work (same artist/album name reuses existing records)
- Sub-genres should be created linked to parent genres
- Thumbnails from files should be converted to WebP and stored as 'original' blob type

## Analytics Testing

### Prerequisites

Analytics requires existing music in the database. Import some songs first using the job processor:

```bash
# Process a music file (will record 'add' event automatically)
cargo run -- jobs process-file /path/to/your/music/file.mp3

# Or scan a directory
cargo run -- jobs scan /path/to/music/directory --recursive
cargo run -- jobs run-processor --once
```

### 1. Record Play Events Manually

```bash
# Get a song ID first
cargo run -- music query-songs --limit 1

# Record a basic play event
cargo run -- analytics record-play <SONG_ID> <USER_ID>

# Record play event with session and position
cargo run -- analytics record-play <SONG_ID> <USER_ID> \
  --session-id my-session-123 \
  --position 45000

# Record play from a playlist
cargo run -- analytics record-play <SONG_ID> <USER_ID> \
  --playlist-id <PLAYLIST_ID> \
  --session-id session-456 \
  --position 30000
```

### 2. View Song Play Statistics

```bash
# Get comprehensive analytics for a song
cargo run -- analytics song-stats <SONG_ID>

# Expected output:
# - Total plays
# - Unique users
# - Unique sessions
# - First/last played timestamps
# - Completion rate
# - Average play time
```

### 3. View User Listening History

```bash
# Get recent listening history for a user
cargo run -- analytics user-history <USER_ID>

# With pagination
cargo run -- analytics user-history <USER_ID> --limit 10 --offset 0

# Next page
cargo run -- analytics user-history <USER_ID> --limit 10 --offset 10
```

### 4. View Session Summary

```bash
# Get details about a listening session
cargo run -- analytics session <SESSION_ID>

# Expected output:
# - Session metadata (user, duration, start/end times)
# - List of all songs played in the session
# - Song details (title, artist, album)
```

### 5. Get Play Counts

```bash
# Get play count for a song
cargo run -- analytics counts song <SONG_ID>

# Get total plays for all songs in an album
cargo run -- analytics counts album <ALBUM_ID>

# Get total plays for all songs by an artist
cargo run -- analytics counts artist <ARTIST_ID>
```

### Complete Analytics Test Workflow

```bash
# 1. Import some music (analytics events recorded automatically)
cargo run -- jobs process-file /path/to/song1.mp3
cargo run -- jobs process-file /path/to/song2.mp3

# 2. Get song and user IDs
SONG_ID=$(cargo run -- music query-songs --limit 1 | grep "ID:" | head -1 | awk '{print $2}')
USER_ID=$(cargo run -- users list --limit 1 | grep "ID:" | head -1 | awk '{print $2}')

# 3. Record some play events
cargo run -- analytics record-play $SONG_ID $USER_ID --session-id test-session-1
cargo run -- analytics record-play $SONG_ID $USER_ID --session-id test-session-1 --position 120000
cargo run -- analytics record-play $SONG_ID $USER_ID --session-id test-session-2

# 4. View the statistics
cargo run -- analytics song-stats $SONG_ID
cargo run -- analytics user-history $USER_ID --limit 5
cargo run -- analytics session test-session-1
cargo run -- analytics counts song $SONG_ID
```

### Verify Analytics in Database

```bash
# Check media_eventz table
sqlite3 $DATABASE_URL "SELECT event_type, COUNT(*) FROM media_eventz GROUP BY event_type;"

# Check music_play_eventz table
sqlite3 $DATABASE_URL "SELECT COUNT(*) FROM music_play_eventz;"

# View recent events
sqlite3 $DATABASE_URL "SELECT id, song_id, session_id, created_at FROM music_play_eventz ORDER BY created_at DESC LIMIT 5;"
```

### Expected Results

- **Record Play**: Should return event IDs and confirm the play was recorded
- **Song Stats**: Should show accurate play counts and completion rates
- **User History**: Should list plays in reverse chronological order with song metadata
- **Session Summary**: Should group all plays by session ID and show chronological song list
- **Play Counts**: Should aggregate correctly across songs, albums, and artists
- **Auto Events**: Import jobs should automatically record 'add' events in media_eventz

### Notes

- Analytics events are recorded best-effort and won't fail the main operation if they error
- Session IDs are auto-generated by the database if not provided by the client
- User ID can be nullable in the schema but CLI commands require it
- Event data is stored as JSON and can include arbitrary metadata (position, playlist_id, etc.)
- The system tracks both state (favorites, ratings in separate tables) and activity (events in media_eventz)

## Feed Testing

The feed system provides unified activity streams combining recent listens, favorites, and album additions.

### 1. Recent Listens Feed

```bash
# View recent listening activity (grouped by song)
cargo run -- analytics recent-listens --limit 10

# With pagination
cargo run -- analytics recent-listens --limit 5 --offset 0
cargo run -- analytics recent-listens --limit 5 --offset 5
```

**Expected output:**

- Shows songs that were recently played
- Groups multiple plays of the same song
- Displays play count and last played timestamp
- Includes user information if available

### 2. Recent Favorites Feed

```bash
# View recently favorited songs
cargo run -- analytics recent-favorites --limit 10

# With pagination
cargo run -- analytics recent-favorites --limit 5 --offset 0
```

**Expected output:**

- Shows songs that were recently favorited
- Ordered by most recent first
- Includes username and favorite timestamp

### 3. Recent Albums Feed

```bash
# View recently added albums
cargo run -- analytics recent-albums --limit 10

# With pagination
cargo run -- analytics recent-albums --limit 5 --offset 0
```

**Expected output:**

- Shows albums recently added to the library
- Includes artist name and creation timestamp
- Displays album thumbnails if available

### 4. Combined Activity Feed

```bash
# View unified feed of all activity types
cargo run -- analytics feed --limit 20

# With pagination
cargo run -- analytics feed --limit 10 --offset 0
cargo run -- analytics feed --limit 10 --offset 10
```

**Expected output:**

- Unified feed mixing listens (🎵), favorites (⭐), and albums (💿)
- Ordered by timestamp (most recent first)
- Shows appropriate icon and action for each item type
- Includes all relevant metadata (play counts, usernames, etc.)

### Complete Feed Test Workflow

```bash
# 1. Generate some activity first
# Record some plays
cargo run -- analytics record-play <SONG_ID_1> <USER_ID>
cargo run -- analytics record-play <SONG_ID_2> <USER_ID>

# Add some favorites
cargo run -- users set-favorite --user-id <USER_ID> --target-type song --target-id <SONG_ID_3>

# Import some music (creates albums)
cargo run -- jobs process-file /path/to/song.mp3

# 2. View individual feeds
cargo run -- analytics recent-listens --limit 5
cargo run -- analytics recent-favorites --limit 5
cargo run -- analytics recent-albums --limit 5

# 3. View combined feed
cargo run -- analytics feed --limit 15
```

### Expected Feed Results

- **Recent Listens**: Groups plays by song, shows play count and last played time
- **Recent Favorites**: Shows individual favorite actions with username
- **Recent Albums**: Shows albums ordered by creation date
- **Combined Feed**: Merges all three types in chronological order with appropriate icons
- All feeds support pagination with limit/offset parameters
- Total count returned for pagination UI

### Verify Feed Data in Database

```bash
# Check recent plays
sqlite3 $DATABASE_URL "SELECT song_id, COUNT(*) as plays, MAX(created_at) as last_play FROM music_play_eventz GROUP BY song_id ORDER BY last_play DESC LIMIT 5;"

# Check recent favorites
sqlite3 $DATABASE_URL "SELECT target_id, created_at FROM user_favoritez WHERE target_type='song' ORDER BY created_at DESC LIMIT 5;"

# Check recent albums
sqlite3 $DATABASE_URL "SELECT id, title, created_at FROM albumz WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5;"
```

### Notes

- Feed items include thumbnail_blob_id for UI display
- Album thumbnails come from album_imagez table (primary images)
- Combined feed uses SQL UNION for efficient querying
- All feeds return (items, total_count) for pagination
- Feed types are: RecentListen, RecentFavorite, RecentAlbum

## Admin Dashboard Testing

The admin dashboard provides system-wide statistics and insights for administrators.

### 1. System Overview

```bash
# View high-level system statistics
cargo run -- analytics admin-overview
```

**Expected output:**

- Total counts for songs, albums, artists, users
- Total library duration in hours
- Activity statistics (plays, sessions, favorites)

### 2. Top Songs

```bash
# View most played songs
cargo run -- analytics top-songs --limit 10

# Top 5
cargo run -- analytics top-songs --limit 5
```

**Expected output:**

- Songs ranked by total play count
- Includes artist name, album title
- Shows unique user count and last played timestamp
- Play count and engagement metrics

### 3. Top Albums

```bash
# View most played albums (aggregated from song plays)
cargo run -- analytics top-albums --limit 10

# Top 5
cargo run -- analytics top-albums --limit 5
```

**Expected output:**

- Albums ranked by total plays across all songs
- Shows artist name and song count
- Includes unique user count
- Aggregated play statistics

### 4. Top Artists

```bash
# View most played artists (aggregated from song plays)
cargo run -- analytics top-artists --limit 10

# Top 5
cargo run -- analytics top-artists --limit 5
```

**Expected output:**

- Artists ranked by total plays across all songs
- Shows song count and album count
- Includes unique user count
- Comprehensive artist statistics

### 5. User Statistics

```bash
# Get statistics for a specific user
cargo run -- analytics user-stats <USER_ID>

# Get stats for all users (ranked by activity)
cargo run -- analytics all-user-stats --limit 10
```

**Expected output:**

- Per-user activity metrics (plays, unique songs, sessions)
- Favorite counts
- First and last activity timestamps
- Ranked by play count when viewing all users

### Complete Admin Dashboard Test

```bash
# 1. View system overview
cargo run -- analytics admin-overview

# 2. Check top content
cargo run -- analytics top-songs --limit 5
cargo run -- analytics top-albums --limit 5
cargo run -- analytics top-artists --limit 5

# 3. View user activity
cargo run -- analytics all-user-stats --limit 10

# 4. Get detailed stats for a specific user
USER_ID=$(cargo run -- users list --limit 1 | grep "ID:" | head -1 | awk '{print $2}')
cargo run -- analytics user-stats $USER_ID
```

### Expected Admin Results

- **Overview**: Shows accurate totals across all entities
- **Top Songs**: Ranked by play count with engagement metrics
- **Top Albums**: Aggregates plays from all songs in the album
- **Top Artists**: Aggregates plays from all songs by the artist
- **User Stats**: Shows individual and collective user activity
- All admin queries support configurable limits
- Statistics reflect real-time data from analytics tables

### Verify Admin Data

```bash
# Check total counts
sqlite3 $DATABASE_URL "SELECT COUNT(*) FROM songz WHERE deleted_at IS NULL;"
sqlite3 $DATABASE_URL "SELECT COUNT(*) FROM music_play_eventz;"

# Check top songs
sqlite3 $DATABASE_URL "SELECT s.title, COUNT(*) as plays FROM music_play_eventz mpe JOIN songz s ON s.id = mpe.song_id GROUP BY mpe.song_id ORDER BY plays DESC LIMIT 5;"

# Check user stats
sqlite3 $DATABASE_URL "SELECT u.username, COUNT(*) as plays FROM music_play_eventz mpe JOIN user_accountz u ON u.id = mpe.user_id GROUP BY mpe.user_id ORDER BY plays DESC;"
```

### Notes

- Admin functions aggregate data across entire system
- Top queries rank by play count (most played first)
- User stats show both individual and system-wide activity
- All statistics are computed in real-time from analytics events
- Duration calculations convert milliseconds to hours/seconds
- Deleted entities are excluded from all admin statistics

## Complete Test Sequence

### 7. Search for Album WITH Cover Art (One-Step!)

This is the **easiest way** to find album art - it searches and fetches cover art in one command:

```bash
# Free-form search (easiest!)
cargo run -- music music-brainz search-album-with-art --query "Radiohead Kid A"

cargo run -- music music-brainz search-album-with-art --query "Beatles Abbey Road"

# Or use explicit artist/album
cargo run -- music music-brainz search-album-with-art \
  --artist "Radiohead" \
  --album "In Rainbows"

# Limit results
cargo run -- music music-brainz search-album-with-art \
  --query "Radiohead OK Computer" \
  --limit 3
```

**What you get:**

- Searches for releases
- Automatically fetches cover art for each result
- Shows thumbnail URLs and full image URLs right away
- Shows which releases have front covers
- One command, complete results!

**Output shows:**

```
[1] Radiohead - Radiohead
    ID: ca1306a2-1064-4998-a919-ee123fffd7e2
    Date: 1991
    Country: GB
    Cover Art: ✓ (2 images)
    Front Cover:
      Thumbnail: http://coverartarchive.org/.../38028949437-250.jpg
      Full Size: http://coverartarchive.org/.../38028949437.jpg
    Back Covers: 1
```
