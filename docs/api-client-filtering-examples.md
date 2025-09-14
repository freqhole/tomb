# API Client Filtering Examples

This document shows how to use the new filtering functionality in the API client for artists and albums with tag-based filtering support.

## Phase 3 Implementation Status

✅ **COMPLETED**: Backend API Extensions
- New `POST /api/music/artists` endpoint for artist filtering
- New `POST /api/music/albums` endpoint for album filtering
- Zod schemas for request/response validation
- JavaScript API client methods with type safety

## Basic Usage

### Import the API Client

```typescript
import { apiClient } from "@/lib/api-client";
import type {
  ArtistsFilterRequest,
  AlbumsFilterRequest
} from "@/lib/music/schemas";
```

### Filter Artists by Tags

```typescript
// Get rock artists
const rockArtists = await apiClient.getArtistsByTags(["rock"]);

// Get rock and classic artists with search
const classicRockArtists = await apiClient.getArtistsByTags(
  ["rock", "classic"],
  {
    query: "queen",
    sort_by: "song_count",
    sort_direction: "desc"
  }
);
```

### Filter Albums by Tags and Year

```typescript
// Get rock albums from the 80s
const eightyRockAlbums = await apiClient.getAlbumsByTags(
  ["rock"],
  {
    year_min: 1980,
    year_max: 1989,
    sort_by: "year",
    sort_direction: "desc"
  }
);

// Get Queen albums with rock tag
const queenRockAlbums = await apiClient.getAlbumsByTags(
  ["rock"],
  {
    artist: "Queen",
    sort_by: "year"
  }
);
```

## Advanced Filtering

### Direct Filter Methods

For more control, use the direct filtering methods:

```typescript
// Advanced artist filtering
const artistsResult = await apiClient.filterArtists({
  tags: ["rock", "progressive"],
  query: "pink",
  sort_by: "rating",
  sort_direction: "desc",
  page: 1,
  page_size: 20
});

console.log(artistsResult.artists);      // Artist data
console.log(artistsResult.pagination);  // Pagination info

// Advanced album filtering
const albumsResult = await apiClient.filterAlbums({
  tags: ["jazz", "fusion"],
  artist: "Miles Davis",
  year_min: 1970,
  year_max: 1980,
  sort_by: "year",
  page: 1,
  page_size: 10
});
```

### Search Without Tags

```typescript
// Search artists by name
const searchResults = await apiClient.searchArtists("beatles", {
  sort_by: "song_count",
  sort_direction: "desc"
});

// Search albums with filters
const albumSearch = await apiClient.searchAlbums("dark side", {
  year_min: 1970,
  year_max: 1980
});
```

## Request/Response Types

### Artist Filtering

```typescript
// Request type
interface ArtistsFilterRequest {
  tags?: string[];
  query?: string;
  page?: number;
  page_size?: number;
  sort_by?: string;        // "artist" | "song_count" | "album_count" | "rating"
  sort_direction?: string; // "asc" | "desc"
}

// Response type
interface ArtistsFilterResponse {
  artists: ArtistSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}
```

### Album Filtering

```typescript
// Request type
interface AlbumsFilterRequest {
  tags?: string[];
  query?: string;
  artist?: string;
  year_min?: number;
  year_max?: number;
  page?: number;
  page_size?: number;
  sort_by?: string;        // "album" | "artist" | "year" | "rating"
  sort_direction?: string; // "asc" | "desc"
}

// Response type
interface AlbumsFilterResponse {
  albums: Album[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}
```

## Available Methods

### Core Filtering Methods
- `apiClient.filterArtists(request)` - Full artist filtering
- `apiClient.filterAlbums(request)` - Full album filtering

### Convenience Methods
- `apiClient.getArtistsByTags(tags, options)` - Filter artists by tags
- `apiClient.getAlbumsByTags(tags, options)` - Filter albums by tags
- `apiClient.searchArtists(query, options)` - Search artists by name
- `apiClient.searchAlbums(query, options)` - Search albums by name

### Existing Methods (unchanged)
- `apiClient.getArtists(options)` - Get all artists (GET)
- `apiClient.getAlbums(options)` - Get all albums (GET)

## Pagination Handling

```typescript
// Handle paginated results
let page = 1;
let allArtists: ArtistSummary[] = [];

do {
  const result = await apiClient.getArtistsByTags(["rock"], {
    page,
    page_size: 50
  });

  allArtists.push(...result.artists);
  page++;

  if (!result.pagination.has_next) break;
} while (page <= 10); // Safety limit
```

## Error Handling

```typescript
try {
  const result = await apiClient.filterArtists({
    tags: ["rock"],
    sort_by: "invalid_field" // This will be validated
  });
} catch (error) {
  if (error instanceof Error) {
    console.error("Filtering failed:", error.message);
  }
}
```

## Integration Notes

- All methods return type-safe results validated with Zod schemas
- Pagination is handled consistently across all methods
- Empty tag arrays are treated as "no tag filter"
- Invalid sort fields default to sensible fallbacks
- Search queries are trimmed and empty queries ignored

## Next Steps

This filtering functionality is ready for integration into:
- Phase 4: Infinite Grid Virtualization
- Phase 5: Frontend Integration with Tag Context Menus
- Phase 6: Cross-View Synchronization

The API client provides both simple convenience methods and full control methods to support various UI patterns and use cases.
