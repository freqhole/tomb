# Music Search Features

Comprehensive full-text search system for songs, playlists, and music metadata with CLI and REST API interfaces.

## Overview

The music search system provides powerful, fast, and flexible search capabilities across your entire music library. Built on PostgreSQL's full-text search with custom enhancements for music-specific use cases.

## Key Features

### 🔍 **Full-Text Search**
- Search across song titles, artists, albums, genres, and playlist information
- Multiple search algorithms: websearch (natural language), plainto (simple), phrase (exact)
- Relevance scoring and intelligent ranking
- Case-insensitive matching with accent support

### 🎯 **Structured Search**
- Field-specific queries: `genre:jazz`, `artist:pink`, `album:blue`
- Precise filtering without false positives
- Combinable with text search and additional filters
- Perfect for advanced users and programmatic queries

### 💡 **Smart Suggestions**
- Real-time autocomplete with partial matching
- Word extraction from song titles for better coverage
- Category-based suggestions (artist, album, genre, title, playlist)
- Frequency-based ranking for popular terms

### 📊 **Advanced Filtering**
- Filter by artist, album, genre, year, rating
- Date range filtering (created_at, updated_at)
- Favorites-only filtering
- Combine multiple filters for precise results

### ⚡ **High Performance**
- Optimized PostgreSQL indexes for sub-10ms search responses
- Efficient JSONB metadata searches
- Paginated results for large datasets
- Smart query optimization

## Search Interfaces

### CLI Commands

```bash
# Basic search
cli music search "jazz piano"

# Structured search
cli music search --structured "genre:rap"

# Songs-only search
cli music search --songs-only "guitar solo"

# Get suggestions
cli music suggest "pian"
```

### REST API

```bash
# Unified search (songs + playlists)
GET /api/music/search?q=piano&search_type=websearch

# Songs-only search
GET /api/music/search/songs?q=jazz&rating_min=4

# Autocomplete suggestions
GET /api/music/search/suggestions?q=mil&limit=5
```

## Search Types Explained

### WebSearch (Default)
Natural language search with operator support:
- `love AND piano` - Both terms required
- `jazz OR blues` - Either term matches
- `rock NOT metal` - Exclude specific terms
- `"exact phrase"` - Phrase matching
- `(jazz OR blues) AND piano` - Complex grouping

**Best for**: Natural user queries, complex searches

### PlainText
Simple search where all terms are required:
- `miles davis` - Finds content with both "miles" AND "davis"
- No special operators, straightforward behavior

**Best for**: Simple searches, when you want all terms present

### Phrase
Exact phrase matching:
- `kind of blue` - Finds exact phrase "kind of blue"
- Maintains word order and spacing

**Best for**: Specific titles, exact quotes

## Structured Search

Search specific fields directly:

### Supported Fields

| Field | Description | Example |
|-------|-------------|---------|
| `genre` | Music genre | `genre:jazz` |
| `artist` | Artist name | `artist:radiohead` |
| `album` | Album name | `album:ok computer` |
| `title` | Song title | `title:paranoid android` |
| `album_artist` | Album artist | `album_artist:various` |

### Features
- **Case-insensitive**: `genre:JAZZ` = `genre:jazz`
- **Partial matching**: `artist:radio` matches "Radiohead"
- **No false positives**: `genre:jazz` only matches genre field
- **Combinable**: Use with filters and sorting

## Search Suggestions

Intelligent autocomplete system:

### Categories
- **Artist**: Artist names containing query
- **Album**: Album names containing query
- **Title**: Song titles containing query
- **Genre**: Genres containing query
- **Playlist**: Playlist titles containing query
- **Word**: Individual words extracted from titles

### Features
- **Partial matching**: "pian" → "piano", "Piano Collection"
- **Word extraction**: Extracts words from titles for better coverage
- **Smart filtering**: Excludes common stop words ("the", "and", etc.)
- **Frequency ranking**: Popular terms appear first

## Performance Characteristics

### Speed
- **Search queries**: 5-15ms typical response time
- **Suggestions**: 3-8ms typical response time
- **Database**: Optimized PostgreSQL full-text indexes
- **Scalability**: Handles thousands of songs efficiently

### Indexing
- **Search vectors**: Pre-computed for songs and playlists
- **JSONB indexes**: For metadata searching
- **Composite indexes**: For filtered queries
- **Automatic updates**: Indexes maintained on data changes

## Integration Examples

### CLI Usage
```bash
# Discovery workflow
cli music suggest "prog"          # Get suggestions
cli music search "progressive"    # Basic search
cli music search --structured "genre:progressive rock"  # Precise search
cli music search --songs-only "progressive" --rating_min=4  # Filtered search
```

### API Integration
```javascript
// Search workflow
const suggestions = await searchAPI.suggest("prog");
const results = await searchAPI.search("progressive rock");
const filtered = await searchAPI.search("prog", {
  structured: false,
  genre: "rock",
  rating_min: 4
});
```

## Use Cases

### Discovery
- **Mood-based search**: "chill ambient electronic"
- **Genre exploration**: `genre:jazz` → discover jazz sub-genres
- **Artist exploration**: `artist:radiohead` → find all Radiohead content

### Organization
- **Playlist creation**: Search for similar songs to add
- **Library management**: Find duplicates, incomplete metadata
- **Quality control**: `rating_min:4` for high-quality content

### Integration
- **Autocomplete**: Real-time search suggestions in UI
- **Smart playlists**: Automated playlist generation based on criteria
- **Recommendation**: "More like this" functionality

## Database Architecture

### Full-Text Search
```sql
-- Search vector generation
UPDATE songs SET search_vector =
  to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(artist, '') || ' ' ||
    coalesce(album, '') || ' ' ||
    coalesce(genre, '')
  );
```

### Structured Search
```sql
-- Field-specific search
SELECT * FROM songs
WHERE genre ILIKE '%jazz%'
  AND artist ILIKE '%miles%';
```

### Suggestion Generation
```sql
-- Word extraction for suggestions
SELECT unnest(string_to_array(lower(title), ' ')) as word
FROM songs
WHERE word ILIKE 'pian%'
  AND length(word) >= 3;
```

## Authentication & Security

### API Security
- **Authentication required**: All API endpoints require user session
- **Rate limiting**: Prevents abuse of search endpoints
- **Input validation**: SQL injection prevention
- **Error handling**: Secure error messages

### Data Privacy
- **User isolation**: Search results respect user permissions
- **Audit logging**: Search activities can be logged
- **Secure sessions**: Session-based authentication

## Configuration

### Database Settings
```sql
-- Full-text search configuration
SET default_text_search_config = 'english';

-- Performance tuning
SET work_mem = '256MB';
SET effective_cache_size = '4GB';
```

### Application Settings
```json
{
  "search": {
    "default_page_size": 20,
    "max_page_size": 100,
    "suggestion_limit": 10,
    "cache_duration": 300
  }
}
```

## Future Enhancements

### Planned Features
- **Faceted search**: Filter counts by category
- **Search analytics**: Query performance and usage metrics
- **Result caching**: Redis-based result caching
- **Fuzzy search**: Typo tolerance and spell correction
- **Highlighting**: Search term highlighting in results

### Advanced Features
- **Machine learning**: Personalized search ranking
- **Audio analysis**: Search by audio characteristics (BPM, key, etc.)
- **Semantic search**: Meaning-based rather than keyword-based
- **Voice search**: Speech-to-text search interface

## Troubleshooting

### Common Issues

**Slow search performance**:
- Check database indexes: `EXPLAIN ANALYZE SELECT ...`
- Verify search_vector is populated
- Consider increasing work_mem

**No results for expected query**:
- Try different search types (websearch vs plainto)
- Use structured search for precise field matching
- Check for typos in field names

**Suggestions not working**:
- Verify partial matching is working: test with longer prefixes
- Check if data exists in expected fields
- Confirm stop words aren't being filtered

### Debugging
```bash
# Check search performance
cli music search "test" --verbose

# Test suggestions
cli music suggest "a" --limit=1

# Database query analysis
psql -c "EXPLAIN ANALYZE SELECT * FROM search_songs('test', 'websearch', NULL, ...)"
```

## Migration Notes

### From Legacy Search
- Old `query_songs` function replaced with `search_songs`
- Enhanced with structured search and suggestions
- Backward compatible parameter structure
- Performance improvements with better indexing

### Database Updates
- Migration 032: FTS indexes
- Migration 033: Enhanced search functions
- Migration 034: Unified music search
- All migrations are consolidated and optimized
