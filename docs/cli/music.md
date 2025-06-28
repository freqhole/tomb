# Music CLI Commands

Command-line interface for music library management, scanning, and playlist operations.

## Scanning Commands

### `music scan <path>`

Scan a directory for music files and add them to the database.

```bash
cli music scan ~/Music
cli music scan /media/music --depth 3 --batch-size 50
```

**Options:**
- `--name <name>` - Name for the scan session
- `--depth <depth>` - Maximum directory depth (default: 10)
- `--batch-size <size>` - Files to process per batch (default: 100)
- `--extensions <list>` - File extensions to scan (default: mp3,flac,ogg,m4a)
- `--max-size-mb <size>` - Maximum file size in MB (default: 100)

### `music resume <session-id>`

Resume a previously interrupted scan session.

```bash
cli music resume 550e8400-e29b-41d4-a716-446655440000
```

### `music status`

Show status of all scan sessions.

```bash
cli music status --active      # Show only active sessions
cli music status --verbose     # Show detailed information
```

### `music cancel <session-id>`

Cancel a running scan session.

```bash
cli music cancel 550e8400-e29b-41d4-a716-446655440000
```

### `music cleanup`

Clean up old completed scan sessions.

```bash
cli music cleanup --days 7     # Keep sessions from last 7 days
```

## Song Commands

### `music songs`

List all songs in the database.

```bash
cli music songs --favorites            # Show only favorited songs
cli music songs --artist "Pink Floyd"  # Filter by artist
cli music songs --album "Dark Side"    # Filter by album
cli music songs --limit 50 --offset 100  # Pagination
```

**Options:**
- `--favorites` - Show only favorited songs
- `--artist <name>` - Filter by artist name
- `--album <name>` - Filter by album name
- `--limit <num>` - Maximum number of results (default: 20)
- `--offset <num>` - Number of results to skip (default: 0)

## Playlist Commands

### `music playlists`

List all playlists.

```bash
cli music playlists --public     # Show only public playlists
cli music playlists --verbose    # Show detailed information
```

### `music create-playlist <title>`

Create a new playlist.

```bash
cli music create-playlist "My Favorites"
cli music create-playlist "Road Trip" --description "Songs for driving" --public
```

**Options:**
- `--description <text>` - Playlist description
- `--public` - Make playlist public
- `--songs <ids>` - Comma-separated song IDs to add

### `music add-to-playlist <playlist> <songs>`

Add songs to an existing playlist (by ID or title).

```bash
cli music add-to-playlist "My Favorites" "song1,song2,song3"
cli music add-to-playlist 550e8400-e29b-41d4-a716-446655440000 "song1,song2"
```

### `music add-to-playlist-by-title <title> <songs>`

Add songs to playlist by title. Creates playlist if it doesn't exist.

```bash
cli music add-to-playlist-by-title "New Playlist" "song1,song2,song3"
cli music add-to-playlist-by-title "Existing" "song4" --description "Auto-created" --public
```

**Options:**
- `--description <text>` - Description for new playlist (if created)
- `--public` - Make new playlist public (if created)

**Behavior:**
- If title matches exactly 1 playlist: adds songs to that playlist
- If title matches multiple playlists: shows error with playlist list
- If title matches no playlists: creates new playlist with that title
- Processes each song individually, skipping duplicates and invalid IDs

### `music remove-from-playlist <playlist> <songs>`

Remove songs from a playlist.

```bash
cli music remove-from-playlist "My Playlist" "song1,song2"
```

### `music show-playlist <playlist>`

Show songs in a playlist.

```bash
cli music show-playlist "My Favorites"
cli music show-playlist 550e8400-e29b-41d4-a716-446655440000 --verbose
```

**Options:**
- `--verbose` - Show detailed song information

### `music delete-playlist <playlist>`

Delete a playlist.

```bash
cli music delete-playlist "Old Playlist"
cli music delete-playlist 550e8400-e29b-41d4-a716-446655440000 --force
```

**Options:**
- `--force` - Skip confirmation prompt

### `music move-song <playlist> <song-id> <position>`

Move a song to a different position in a playlist.

```bash
cli music move-song "My Playlist" 550e8400-e29b-41d4-a716-446655440000 1
```

### `music reorder-playlist <playlist> <song-ids>`

Reorder entire playlist by providing song IDs in new order.

```bash
cli music reorder-playlist "My Playlist" "song3,song1,song2"
```

## Album Commands

### `music albums`

Show album summaries.

```bash
cli music albums --limit 50
```

### `music album-tracks <album>`

Show tracks in an album.

```bash
cli music album-tracks "Dark Side of the Moon"
cli music album-tracks "Wish You Were Here" --artist "Pink Floyd"
```

### `music artist-albums <artist>`

Show albums by an artist.

```bash
cli music artist-albums "Pink Floyd" --limit 10
```

### `music playlist-from-album <album>`

Create a playlist from an album.

```bash
cli music playlist-from-album "Dark Side of the Moon"
cli music playlist-from-album "The Wall" --artist "Pink Floyd" --title "Pink Floyd - The Wall" --public
```

**Options:**
- `--artist <name>` - Filter by artist
- `--title <title>` - Custom playlist title (defaults to album name)
- `--public` - Make playlist public

## Utility Commands

### `music playlist-summaries`

Show playlist summaries with song counts.

```bash
cli music playlist-summaries --limit 20
```

### `music test`

Test database connectivity and show record counts.

```bash
cli music test
```

## Examples

```bash
# Initial music library setup
cli music scan ~/Music --name "Initial Import" --batch-size 50

# Create and populate a playlist
cli music create-playlist "Chill Mix" --description "Relaxing songs"
cli music add-to-playlist-by-title "Chill Mix" "song1,song2,song3"

# Find and create album playlist
cli music album-tracks "OK Computer" --artist "Radiohead"
cli music playlist-from-album "OK Computer" --artist "Radiohead" --public

# Manage existing playlists
cli music show-playlist "Chill Mix" --verbose
cli music move-song "Chill Mix" song2 1
```

## Notes

- Song IDs can be found using `cli music songs`
- Playlist names are case-sensitive for exact matches
- Partial title matching is supported when no exact match is found
- Duplicate songs in playlists are automatically skipped
- All operations preserve existing playlist order when adding songs
