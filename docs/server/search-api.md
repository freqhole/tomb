# Music Search API Documentation

RESTful API endpoints for searching songs, playlists, and getting autocomplete suggestions.

## 🔐 Authentication

All search API endpoints require user authentication via session cookies. Unauthenticated requests will receive `401 Unauthorized`.

```bash
# Example of unauthenticated request
curl "http://localhost:8080/api/music/search?q=piano"
# Returns: 401 Unauthorized

# Authentication must be handled through the web interface or login API
```

## Base URL

All search endpoints are prefixed with `/api/music/`.

## Endpoints Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/music/search` | GET | Search across songs and playlists |
| `/api/music/search/songs` | GET | Search only songs (exclude playlists) |
| `/api/music/search/suggestions` | GET | Get autocomplete suggestions |

## Search Endpoints

### `GET /api/music/search`

Search across both songs and playlists with unified results.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query or structured query |
| `structured` | boolean | No | `false` | Interpret query as structured search |
| `search_type` | string | No | `"websearch"` | Search algorithm: `websearch`, `plainto`, `phrase` |
| `page` | integer | No | `1` | Page number (1-based) |
| `page_size` | integer | No | `20` | Results per page (max: 100) |
| `sort_by` | string | No | `"relevance"` | Sort field: `relevance`, `title`, `artist`, `album`, `created_at`, `rating` |
| `sort_direction` | string | No | `"desc"` | Sort direction: `asc`, `desc` |
| `artist` | string | No | - | Filter by artist name |
| `album` | string | No | - | Filter by album name |
| `genre` | string | No | - | Filter by genre |
| `year` | integer | No | - | Filter by year |
| `rating_min` | integer | No | - | Minimum rating (1-5) |
| `rating_max` | integer | No | - | Maximum rating (1-5) |
| `favorites_only` | boolean | No | `false` | Show only favorited songs |

**Examples:**

```bash
# Basic text search
GET /api/music/search?q=piano

# Structured search for rap songs
GET /api/music/search?q=genre:rap&structured=true&page_size=10

# Advanced filtering
GET /api/music/search?q=jazz&artist=Miles&rating_min=4&sort_by=rating

# Different search types
GET /api/music/search?q=love%20me%20tender&search_type=phrase
GET /api/music/search?q=love%20hate&search_type=plainto
```

**Response:**

```json
{
  "total_count": 25,
  "page": 1,
  "page_size": 20,
  "total_pages": 2,
  "query_time_ms": 8,
  "results": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "result_type": "song",
      "title": "Piano Sonata No. 14",
      "subtitle": "Ludwig van Beethoven - Classical Collection",
      "description": "Classical",
      "thumbnail_blob_id": "abc123",
      "media_blob_id": "def456",
      "relevance_score": 0.89,
      "metadata": {
        "duration_seconds": 1680,
        "audio_properties": {
          "bitrate": 320,
          "sample_rate": 44100
        }
      },
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": "750e8400-e29b-41d4-a716-446655440001",
      "result_type": "playlist",
      "title": "Piano Collection",
      "subtitle": "A collection of beautiful piano pieces",
      "description": "Playlist",
      "thumbnail_blob_id": null,
      "media_blob_id": null,
      "relevance_score": 0.67,
      "metadata": {},
      "created_at": "2024-01-10T15:20:00Z",
      "updated_at": "2024-01-12T09:45:00Z"
    }
  ],
  "suggestions": [
    {
      "text": "piano",
      "category": "word",
      "frequency": 15
    },
    {
      "text": "Piano Collection",
      "category": "playlist",
      "frequency": 1
    }
  ]
}
```

### `GET /api/music/search/songs`

Search only songs, excluding playlists from results.

**Parameters:**

Same as `/api/music/search` but results will only contain songs.

**Examples:**

```bash
# Songs-only search
GET /api/music/search/songs?q=guitar&page_size=15

# Structured search for electronic songs
GET /api/music/search/songs?q=genre:electronic&structured=true

# Filter by multiple criteria
GET /api/music/search/songs?q=rock&year=1975&rating_min=4
```

**Response:**

```json
{
  "total_count": 12,
  "page": 1,
  "page_size": 20,
  "query_time_ms": 5,
  "songs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "media_blob_id": "abc123",
      "thumbnail_blob_id": "def456",
      "waveform_blob_id": "ghi789",
      "title": "Guitar Solo Masterpiece",
      "artist": "Eric Clapton",
      "album": "Unplugged",
      "album_artist": "Eric Clapton",
      "track_number": 3,
      "disc_number": 1,
      "genre": "Blues Rock",
      "year": 1992,
      "bpm": 120,
      "key_signature": "G major",
      "rating": 5,
      "is_favorite": true,
      "tags": ["live", "acoustic", "classic"],
      "search_rank": 0.95,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### `GET /api/music/search/suggestions`

Get search suggestions for autocomplete functionality.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Partial query to get suggestions for |
| `limit` | integer | No | `10` | Maximum number of suggestions |

**Examples:**

```bash
# Get suggestions for "pian"
GET /api/music/search/suggestions?q=pian&limit=5

# Get suggestions for "ja"
GET /api/music/search/suggestions?q=ja&limit=8
```

**Response:**

```json
{
  "suggestions": [
    {
      "text": "piano",
      "category": "word",
      "frequency": 15
    },
    {
      "text": "Piano Collection",
      "category": "playlist",
      "frequency": 1
    },
    {
      "text": "lil piano riff",
      "category": "title",
      "frequency": 1
    },
    {
      "text": "Nils Frahm",
      "category": "artist",
      "frequency": 8
    }
  ],
  "count": 4
}
```

## Search Types

### WebSearch (`websearch`)

**Default and recommended search type** that supports natural language queries with operators.

- Supports AND, OR, NOT operators
- Phrase queries with quotes
- Parentheses for grouping
- Most user-friendly for complex queries

```bash
# Examples
GET /api/music/search?q=jazz%20AND%20piano&search_type=websearch
GET /api/music/search?q=%22blue%20note%22%20OR%20%22hard%20bop%22&search_type=websearch
GET /api/music/search?q=rock%20NOT%20metal&search_type=websearch
```

### Plain Text (`plainto`)

Simple text search that treats all terms as required (implicit AND).

- All search terms must be present
- No special operators
- Good for simple, precise searches

```bash
# Example: finds songs containing both "miles" AND "davis"
GET /api/music/search?q=miles%20davis&search_type=plainto
```

### Phrase (`phrase`)

Exact phrase matching for precise searches.

- Searches for exact word sequences
- Maintains word order
- Case-insensitive

```bash
# Example: finds exact phrase "kind of blue"
GET /api/music/search?q=kind%20of%20blue&search_type=phrase
```

## Structured Search

Use structured search to query specific fields directly:

### Syntax

```
field:value
```

### Supported Fields

| Field | Description | Example |
|-------|-------------|---------|
| `genre` | Song genre | `genre:jazz` |
| `artist` | Artist name | `artist:miles` |
| `album` | Album name | `album:blue` |
| `title` | Song title | `title:piano` |
| `album_artist` | Album artist | `album_artist:various` |

### Examples

```bash
# Find jazz songs
GET /api/music/search?q=genre:jazz&structured=true

# Find songs by artists containing "pink"
GET /api/music/search?q=artist:pink&structured=true

# Find albums containing "blue"
GET /api/music/search?q=album:blue&structured=true
```

**Features:**

- Case-insensitive matching
- Partial word matching
- Works with all search types
- Can be combined with regular filters

## Filtering

Additional filters can be applied to any search:

```bash
# Combine text search with filters
GET /api/music/search?q=rock&year=1975&rating_min=4&genre=Progressive

# Filter favorites only
GET /api/music/search?q=piano&favorites_only=true

# Date range filtering
GET /api/music/search?q=jazz&year=1959
```

## Sorting

Results can be sorted by multiple fields:

| Sort Field | Description |
|------------|-------------|
| `relevance` | Search relevance score (default) |
| `title` | Song/playlist title |
| `artist` | Artist name |
| `album` | Album name |
| `created_at` | Creation date |
| `rating` | User rating |

```bash
# Sort by rating (highest first)
GET /api/music/search?q=jazz&sort_by=rating&sort_direction=desc

# Sort by title (alphabetical)
GET /api/music/search?q=piano&sort_by=title&sort_direction=asc
```

## Pagination

All search endpoints support pagination:

```bash
# First page (default)
GET /api/music/search?q=rock&page=1&page_size=20

# Second page
GET /api/music/search?q=rock&page=2&page_size=20

# Larger page size
GET /api/music/search?q=jazz&page_size=50
```

**Limits:**

- Maximum `page_size`: 100
- Minimum `page_size`: 1
- Page numbers start at 1

## Response Fields

### Search Result Item

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `result_type` | string | "song" or "playlist" |
| `title` | string | Primary title |
| `subtitle` | string | Secondary information |
| `description` | string | Additional details |
| `thumbnail_blob_id` | string\|null | Thumbnail image ID |
| `media_blob_id` | string\|null | Media file ID |
| `relevance_score` | number | Search relevance (0.0-1.0) |
| `metadata` | object | Additional metadata |
| `created_at` | string | ISO 8601 timestamp |
| `updated_at` | string | ISO 8601 timestamp |

### Song Result (songs-only endpoint)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Song identifier |
| `media_blob_id` | string | Media file ID |
| `thumbnail_blob_id` | string\|null | Thumbnail image ID |
| `waveform_blob_id` | string\|null | Waveform data ID |
| `title` | string | Song title |
| `artist` | string\|null | Artist name |
| `album` | string\|null | Album name |
| `album_artist` | string\|null | Album artist |
| `track_number` | integer\|null | Track number |
| `disc_number` | integer\|null | Disc number |
| `genre` | string\|null | Genre |
| `year` | integer\|null | Release year |
| `bpm` | integer\|null | Beats per minute |
| `key_signature` | string\|null | Musical key |
| `rating` | integer\|null | User rating (1-5) |
| `is_favorite` | boolean | Favorite status |
| `tags` | array | Tags array |
| `search_rank` | number | Search relevance |
| `created_at` | string | ISO 8601 timestamp |
| `updated_at` | string | ISO 8601 timestamp |

### Suggestion Item

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Suggested text |
| `category` | string | Suggestion category |
| `frequency` | integer | Popularity/frequency |

**Suggestion Categories:**

- `artist` - Artist names
- `album` - Album names
- `title` - Song titles
- `genre` - Genres
- `playlist` - Playlist titles
- `word` - Individual words from titles

## Error Responses

### 400 Bad Request

Missing or invalid parameters:

```json
{
  "error": "Bad Request",
  "message": "Query parameter 'q' is required"
}
```

### 401 Unauthorized

Authentication required:

```json
{
  "error": "Unauthorized",
  "message": "Authentication required"
}
```

### 500 Internal Server Error

Server-side error:

```json
{
  "error": "Internal Server Error",
  "message": "Search service temporarily unavailable"
}
```

## Performance

- **Typical response time**: 5-15ms for most queries
- **Database**: PostgreSQL with full-text search indexes
- **Caching**: Results may be cached for performance
- **Rate limiting**: May be applied to prevent abuse

## Best Practices

### For UI Development

1. **Use suggestions for autocomplete**:
   ```javascript
   // Debounce user input and call suggestions endpoint
   const suggestions = await fetch(`/api/music/search/suggestions?q=${query}`);
   ```

2. **Implement pagination**:
   ```javascript
   // Load more results
   const nextPage = await fetch(`/api/music/search?q=${query}&page=${currentPage + 1}`);
   ```

3. **Provide search type options**:
   ```javascript
   // Let users choose search behavior
   const searchType = userPreference || 'websearch';
   ```

### For Performance

1. **Use appropriate page sizes** (20-50 items typical)
2. **Debounce autocomplete requests** (300-500ms)
3. **Cache results** for repeated queries
4. **Use structured search** for precise filtering

### For User Experience

1. **Default to websearch** for natural language
2. **Show suggestion categories** in autocomplete UI
3. **Highlight search terms** in results
4. **Provide search tips** for advanced users

## Integration Examples

### JavaScript/TypeScript

```typescript
// Basic search client
class MusicSearchClient {
  async search(query: string, options: SearchOptions = {}) {
    const params = new URLSearchParams({
      q: query,
      ...options
    });

    const response = await fetch(`/api/music/search?${params}`, {
      credentials: 'include' // Include session cookies
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    return response.json();
  }

  async suggest(query: string, limit = 10) {
    const response = await fetch(
      `/api/music/search/suggestions?q=${encodeURIComponent(query)}&limit=${limit}`,
      { credentials: 'include' }
    );

    return response.json();
  }
}
```

### React Hook

```typescript
import { useState, useEffect } from 'react';

function useSearchSuggestions(query: string, delay = 300) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/music/search/suggestions?q=${encodeURIComponent(query)}`,
          { credentials: 'include' }
        );
        const data = await response.json();
        setSuggestions(data.suggestions);
      } catch (error) {
        console.error('Search suggestions failed:', error);
      } finally {
        setLoading(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [query, delay]);

  return { suggestions, loading };
}
```
