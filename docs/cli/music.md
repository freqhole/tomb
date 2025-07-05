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

### `music play`

Interactive playlist selection and playback with keyboard navigation.

```bash
cli music play
cli music play --shuffle
```

**Options:**

- `--shuffle` - Randomize playback order

**Features:**

- Browse all playlists with song counts and durations
- Navigate with arrow keys and select with Enter
- Shows playlist title, song count, and total duration
- Escape or Ctrl+C to cancel selection
- Automatically starts playback of selected playlist

### `music play-song <song-id>`

Play a single song using the configured audio player.

```bash
cli music play-song 550e8400-e29b-41d4-a716-446655440000
cli music play-song 550e8400-e29b-41d4-a716-446655440000 --visualize
```

**Options:**

- `--visualize` - Show audio visualizer (requires `cava` to be installed)

### `music play-playlist <playlist>`

Play an entire playlist sequentially.

```bash
cli music play-playlist "My Favorites"
cli music play-playlist 550e8400-e29b-41d4-a716-446655440000 --shuffle
```

**Options:**

- `--shuffle` - Randomize playback order

**Behavior:**

- Plays songs sequentially using configured audio player
- Shows progress indicator with song titles and duration
- Handles missing files gracefully by skipping with warning
- Full keyboard controls available during playback

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

# Audio playback
cli music play                          # Interactive playlist picker
cli music play --shuffle                # Interactive with shuffle
cli music play-song 550e8400-e29b-41d4-a716-446655440000
cli music play-song 550e8400-e29b-41d4-a716-446655440000 --visualize
cli music play-playlist "Road Trip Mix" --shuffle
```

## Search Commands 🔍

### `music search <query>`

Search across songs and playlists using powerful full-text search.

```bash
cli music search "piano"                    # Search for "piano" in songs and playlists
cli music search "jazz piano"               # Multi-word search
cli music search "Miles Davis"              # Artist search
cli music search --songs-only "guitar"     # Search only songs (exclude playlists)
```

**Search Types:**

```bash
cli music search "love OR hate" --search-type websearch    # Natural language (default)
cli music search "love hate" --search-type plainto         # Simple AND search
cli music search "exact phrase" --search-type phrase       # Exact phrase matching
```

**Options:**

- `--structured` - Use structured field-based search (see below)
- `--search-type <type>` - Search algorithm: `websearch`, `plainto`, `phrase` (default: `websearch`)
- `--limit <num>` - Maximum number of results (default: 20)
- `--page <num>` - Page number for pagination (default: 1)
- `--verbose` - Show detailed song information
- `--songs-only` - Search only songs, exclude playlists

### `music search --structured <field:value>`

Search using structured field-based queries for precise filtering.

```bash
cli music search --structured "genre:rap"          # Find rap songs
cli music search --structured "artist:pink"        # Songs by artists containing "pink"
cli music search --structured "album:blue"         # Albums containing "blue"
cli music search --structured "title:piano"        # Song titles containing "piano"
cli music search --structured "album_artist:various"  # Various artist compilations
```

**Structured Search Fields:**

- `genre:value` - Search by genre (case-insensitive)
- `artist:value` - Search by artist name (partial match)
- `album:value` - Search by album name (partial match)
- `title:value` - Search by song title (partial match)
- `album_artist:value` - Search by album artist (partial match)

**Advanced Examples:**

```bash
# Combine structured search with limits
cli music search --structured "genre:jazz" --limit 10

# Use different search types with structured queries
cli music search --structured "artist:Miles Davis" --search-type phrase

# Songs-only structured search
cli music search --structured "genre:electronic" --songs-only --verbose
```

### `music suggest <partial>`

Get smart search suggestions for autocomplete functionality.

```bash
cli music suggest "pian"                    # Returns: "piano", "Piano Collection", etc.
cli music suggest "ja"                      # Returns: genre "Jazz", artist suggestions
cli music suggest "mil"                     # Returns: "Miles Davis", etc.
```

**Features:**

- **Partial matching** - Finds matches anywhere in titles, not just at the beginning
- **Word extraction** - Extracts individual words from song titles for better suggestions
- **Multiple categories** - Returns suggestions for artists, albums, genres, titles, playlists
- **Frequency ranking** - More popular terms appear first
- **Smart filtering** - Excludes common stop words

**Suggestion Categories:**

- `artist` - Artist names containing the query
- `album` - Album names containing the query
- `title` - Song titles containing the query
- `genre` - Genres containing the query
- `playlist` - Playlist titles containing the query
- `word` - Individual words from song titles

**Options:**

- `--limit <num>` - Maximum number of suggestions (default: 10)

## Search Examples

```bash
# Basic searches
cli music search "jazz"                     # Find all jazz-related content
cli music search "piano riff"               # Multi-word search
cli music search "Bohemian Rhapsody"        # Specific song search

# Structured searches for precision
cli music search --structured "genre:rap" --limit 5
cli music search --structured "artist:radiohead" --verbose
cli music search --structured "album:ok computer"

# Search types comparison
cli music search "love me tender" --search-type websearch   # Natural language
cli music search "love me tender" --search-type plainto     # All words required
cli music search "love me tender" --search-type phrase      # Exact phrase

# Songs-only searches
cli music search --songs-only "guitar solo" --limit 15
cli music search --songs-only --structured "genre:rock"

# Getting suggestions for autocomplete
cli music suggest "bea"                     # Beatles, Beastie Boys, etc.
cli music suggest "cla"                     # Classical, Clapton, etc.
cli music suggest "prog"                    # Progressive rock suggestions

# Pagination for large result sets
cli music search "rock" --page 1 --limit 20
cli music search "rock" --page 2 --limit 20

# Verbose output for detailed information
cli music search "Miles Davis" --verbose --limit 5
```

## Search Features

**🔍 Full-Text Search:**

- Searches across song titles, artists, albums, genres
- Includes playlist titles and descriptions
- Smart ranking by relevance
- Multiple search algorithms for different use cases

**🎯 Structured Search:**

- Field-specific queries: `genre:jazz`, `artist:pink`
- Case-insensitive matching
- Partial word matching
- Precise filtering capabilities

**💡 Smart Suggestions:**

- Real-time autocomplete support
- Partial matching anywhere in text ("pian" → "piano")
- Word extraction from song titles
- Category-based grouping
- Frequency-based ranking

**📊 Search Results:**

- Unified results (songs + playlists) or songs-only
- Relevance scoring and ranking
- Pagination support
- Detailed or compact display modes
- Performance timing information

**⚡ Performance:**

- PostgreSQL full-text search indexes
- Fast search responses (typically < 10ms)
- Efficient suggestions with word extraction
- Optimized database queries

## Audio Playback

Playback commands use the audio player configured in `media.playback` section:

**Default Configuration:**

- Player: `ffplay` (part of FFmpeg)
- Arguments: `-nodisp -autoexit`

**Common Players:**

- `mpv` - Modern media player with excellent keyboard controls (recommended)
- `ffplay` - Part of FFmpeg, widely available
- `afplay` - macOS built-in player

**Keyboard Controls (mpv):**

- `Space` - Pause/play
- `q` or `n` - Skip to next song
- `←/→` - Seek backward/forward 10 seconds
- `↑/↓` - Seek forward/backward 60 seconds
- `9/0` - Volume down/up
- `Ctrl+C` - Stop playlist completely

**Visualizer Support:**

- Requires `cava` to be installed (`brew install cava`)
- Shows real-time audio spectrum in terminal
- Works alongside any configured audio player

## Notes

- Song IDs can be found using `cli music songs`
- Playlist names are case-sensitive for exact matches
- Partial title matching is supported when no exact match is found
- Duplicate songs in playlists are automatically skipped
- All operations preserve existing playlist order when adding songs
- Playback requires `local_path` to be set on media blobs
- Audio player configuration can be customized in config file
