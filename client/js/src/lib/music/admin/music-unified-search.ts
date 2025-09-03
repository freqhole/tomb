import type {
  UnifiedSearchConfig,
  UnifiedSearchParams,
} from "../../../hooks/search/useUnifiedSearch.js";

/**
 * Music-specific configuration for unified search
 */
export const musicUnifiedSearchConfig: UnifiedSearchConfig = {
  domain: "music",
  searchEndpoint: "/api/music/search",
  filterOptionsEndpoint: "/api/music/filter-options",
  suggestionsEndpoint: "/api/music/suggestions",
  defaultParams: {
    page: 1,
    page_size: 20,
    sort_by: "created_at",
    sort_direction: "desc",
    songs_only: true,
  },
  debounceMs: 300,
  defaultPageSize: 20,
};

/**
 * Common music search presets for quick filtering
 */
export const musicSearchPresets = [
  {
    id: "favorites",
    label: "favorites",
    params: { is_favorite: true } as UnifiedSearchParams,
  },
  {
    id: "recent",
    label: "recent additions",
    params: {
      created_after: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
    } as UnifiedSearchParams,
  },
  {
    id: "unrated",
    label: "unrated songs",
    params: { rating_is_null: true } as UnifiedSearchParams,
  },
  {
    id: "highly-rated",
    label: "highly rated",
    params: { rating_min: 4 } as UnifiedSearchParams,
  },
  {
    id: "no-artwork",
    label: "missing artwork",
    params: { has_thumbnail: false } as UnifiedSearchParams,
  },
  {
    id: "lossless",
    label: "lossless audio",
    params: { file_formats: ["flac", "wav"] } as UnifiedSearchParams,
  },
  {
    id: "short-tracks",
    label: "short tracks",
    params: { duration_max: 180 } as UnifiedSearchParams,
  },
  {
    id: "long-tracks",
    label: "long tracks",
    params: { duration_min: 300 } as UnifiedSearchParams,
  },
];

/**
 * Music-specific sort field configurations
 */
export const musicSortFields = [
  {
    field: "title",
    label: "title",
    defaultDirection: "asc" as const,
  },
  {
    field: "artist",
    label: "artist",
    defaultDirection: "asc" as const,
  },
  {
    field: "album",
    label: "album",
    defaultDirection: "asc" as const,
  },
  {
    field: "year",
    label: "year",
    defaultDirection: "desc" as const,
  },
  {
    field: "rating",
    label: "rating",
    defaultDirection: "desc" as const,
  },
  {
    field: "duration_seconds",
    label: "duration",
    defaultDirection: "desc" as const,
  },
  {
    field: "created_at",
    label: "date added",
    defaultDirection: "desc" as const,
  },
  {
    field: "updated_at",
    label: "date modified",
    defaultDirection: "desc" as const,
  },
];

/**
 * Music filter field configurations for UI components
 */
export const musicFilterFields = [
  {
    key: "artist",
    label: "artist",
    type: "text" as const,
    placeholder: "search by artist name",
    supportsExact: true,
  },
  {
    key: "album",
    label: "album",
    type: "text" as const,
    placeholder: "search by album name",
    supportsExact: true,
  },
  {
    key: "genre",
    label: "genre",
    type: "select" as const,
    placeholder: "select genre",
    options: [], // populated dynamically from filter-options API
  },
  {
    key: "title",
    label: "title",
    type: "text" as const,
    placeholder: "search by title",
  },
  {
    key: "year",
    label: "year",
    type: "range" as const,
    min: 1900,
    max: new Date().getFullYear() + 1,
  },
  {
    key: "rating",
    label: "rating",
    type: "rating" as const,
    min: 0,
    max: 5,
  },
  {
    key: "duration",
    label: "duration",
    type: "duration" as const,
    min: 0,
    max: 3600, // 1 hour in seconds
  },
  {
    key: "tags",
    label: "tags",
    type: "multi-select" as const,
    placeholder: "select tags",
    options: [], // populated dynamically
  },
  {
    key: "file_format",
    label: "file format",
    type: "select" as const,
    options: [
      { value: "mp3", label: "MP3" },
      { value: "flac", label: "FLAC" },
      { value: "wav", label: "WAV" },
      { value: "m4a", label: "M4A/AAC" },
      { value: "ogg", label: "OGG Vorbis" },
    ],
  },
  {
    key: "is_favorite",
    label: "favorites only",
    type: "boolean" as const,
  },
  {
    key: "has_thumbnail",
    label: "has artwork",
    type: "boolean" as const,
  },
  {
    key: "created_after",
    label: "added after",
    type: "date" as const,
  },
  {
    key: "created_before",
    label: "added before",
    type: "date" as const,
  },
];

/**
 * Helper to get filter field configuration by key
 */
export function getMusicFilterField(key: string) {
  return musicFilterFields.find((field) => field.key === key);
}

/**
 * Helper to get sort field configuration by field name
 */
export function getMusicSortField(field: string) {
  return musicSortFields.find((sort) => sort.field === field);
}

/**
 * Helper to build search params for a preset
 */
export function applyMusicPreset(
  presetId: string,
  currentParams: UnifiedSearchParams
): UnifiedSearchParams {
  const preset = musicSearchPresets.find((p) => p.id === presetId);
  if (!preset) {
    return currentParams;
  }

  return {
    ...currentParams,
    ...preset.params,
    page: 1, // reset to first page when applying preset
  };
}

/**
 * Helper to validate music search parameters
 */
export function validateMusicSearchParams(
  params: Partial<UnifiedSearchParams>
): UnifiedSearchParams {
  const validated: UnifiedSearchParams = {};

  // validate page and page_size
  if (params.page !== undefined) {
    const page = Number(params.page);
    if (!isNaN(page) && page >= 1) {
      validated.page = page;
    }
  }

  if (params.page_size !== undefined) {
    const pageSize = Number(params.page_size);
    if (!isNaN(pageSize) && pageSize >= 1 && pageSize <= 1000) {
      validated.page_size = pageSize;
    }
  }

  // validate text fields
  if (params.q && typeof params.q === "string" && params.q.trim().length > 0) {
    validated.q = params.q.trim();
  }

  if (
    params.artist &&
    typeof params.artist === "string" &&
    params.artist.trim().length > 0
  ) {
    validated.artist = params.artist.trim();
  }

  if (
    params.album &&
    typeof params.album === "string" &&
    params.album.trim().length > 0
  ) {
    validated.album = params.album.trim();
  }

  if (
    params.genre &&
    typeof params.genre === "string" &&
    params.genre.trim().length > 0
  ) {
    validated.genre = params.genre.trim();
  }

  if (
    params.title &&
    typeof params.title === "string" &&
    params.title.trim().length > 0
  ) {
    validated.title = params.title.trim();
  }

  // validate numeric fields
  if (params.year !== undefined) {
    const year = Number(params.year);
    if (!isNaN(year) && year >= 1900 && year <= new Date().getFullYear() + 1) {
      validated.year = year;
    }
  }

  if (params.year_min !== undefined) {
    const yearMin = Number(params.year_min);
    if (!isNaN(yearMin) && yearMin >= 1900) {
      validated.year_min = yearMin;
    }
  }

  if (params.year_max !== undefined) {
    const yearMax = Number(params.year_max);
    if (!isNaN(yearMax) && yearMax <= new Date().getFullYear() + 1) {
      validated.year_max = yearMax;
    }
  }

  if (params.rating !== undefined) {
    const rating = Number(params.rating);
    if (!isNaN(rating) && rating >= 0 && rating <= 5) {
      validated.rating = rating;
    }
  }

  if (params.rating_min !== undefined) {
    const ratingMin = Number(params.rating_min);
    if (!isNaN(ratingMin) && ratingMin >= 0 && ratingMin <= 5) {
      validated.rating_min = ratingMin;
    }
  }

  if (params.rating_max !== undefined) {
    const ratingMax = Number(params.rating_max);
    if (!isNaN(ratingMax) && ratingMax >= 0 && ratingMax <= 5) {
      validated.rating_max = ratingMax;
    }
  }

  // validate duration fields
  if (params.duration_min !== undefined) {
    const durMin = Number(params.duration_min);
    if (!isNaN(durMin) && durMin >= 0) {
      validated.duration_min = durMin;
    }
  }

  if (params.duration_max !== undefined) {
    const durMax = Number(params.duration_max);
    if (!isNaN(durMax) && durMax >= 0) {
      validated.duration_max = durMax;
    }
  }

  // validate boolean fields
  if (params.is_favorite !== undefined) {
    validated.is_favorite = Boolean(params.is_favorite);
  }

  if (params.has_thumbnail !== undefined) {
    validated.has_thumbnail = Boolean(params.has_thumbnail);
  }

  if (params.favorites_only !== undefined) {
    validated.favorites_only = Boolean(params.favorites_only);
  }

  if (params.songs_only !== undefined) {
    validated.songs_only = Boolean(params.songs_only);
  }

  // validate array fields
  if (params.tags && Array.isArray(params.tags)) {
    const validTags = params.tags.filter(
      (tag) => typeof tag === "string" && tag.trim().length > 0
    );
    if (validTags.length > 0) {
      validated.tags = validTags;
    }
  }

  if (params.tags_any && Array.isArray(params.tags_any)) {
    const validTags = params.tags_any.filter(
      (tag) => typeof tag === "string" && tag.trim().length > 0
    );
    if (validTags.length > 0) {
      validated.tags_any = validTags;
    }
  }

  if (params.tags_exclude && Array.isArray(params.tags_exclude)) {
    const validTags = params.tags_exclude.filter(
      (tag) => typeof tag === "string" && tag.trim().length > 0
    );
    if (validTags.length > 0) {
      validated.tags_exclude = validTags;
    }
  }

  // validate sort fields
  if (params.sort_by && typeof params.sort_by === "string") {
    const validSortFields = musicSortFields.map((field) => field.field);
    if (validSortFields.includes(params.sort_by)) {
      validated.sort_by = params.sort_by;
    }
  }

  if (params.sort_direction && typeof params.sort_direction === "string") {
    if (params.sort_direction === "asc" || params.sort_direction === "desc") {
      validated.sort_direction = params.sort_direction;
    }
  }

  // validate file format
  if (params.file_format && typeof params.file_format === "string") {
    const validFormats = ["mp3", "flac", "wav", "m4a", "ogg", "aac"];
    if (validFormats.includes(params.file_format.toLowerCase())) {
      validated.file_format = params.file_format.toLowerCase();
    }
  }

  // validate date fields
  if (params.created_after && typeof params.created_after === "string") {
    try {
      new Date(params.created_after);
      validated.created_after = params.created_after;
    } catch {
      // invalid date, skip
    }
  }

  if (params.created_before && typeof params.created_before === "string") {
    try {
      new Date(params.created_before);
      validated.created_before = params.created_before;
    } catch {
      // invalid date, skip
    }
  }

  // validate null checking fields
  if (params.rating_is_null !== undefined) {
    validated.rating_is_null = Boolean(params.rating_is_null);
  }

  if (params.genre_is_null !== undefined) {
    validated.genre_is_null = Boolean(params.genre_is_null);
  }

  if (params.year_is_null !== undefined) {
    validated.year_is_null = Boolean(params.year_is_null);
  }

  if (params.bpm_is_null !== undefined) {
    validated.bpm_is_null = Boolean(params.bpm_is_null);
  }

  if (params.key_signature_is_null !== undefined) {
    validated.key_signature_is_null = Boolean(params.key_signature_is_null);
  }

  if (params.artist_is_null !== undefined) {
    validated.artist_is_null = Boolean(params.artist_is_null);
  }

  if (params.album_is_null !== undefined) {
    validated.album_is_null = Boolean(params.album_is_null);
  }

  if (params.album_artist_is_null !== undefined) {
    validated.album_artist_is_null = Boolean(params.album_artist_is_null);
  }

  return validated;
}

/**
 * Helper to generate human-readable filter summary
 */
export function getMusicFilterSummary(params: UnifiedSearchParams): string {
  const parts: string[] = [];

  if (params.q) {
    parts.push(`search: "${params.q}"`);
  }

  if (params.artist) {
    parts.push(`artist: ${params.artist}`);
  }

  if (params.album) {
    parts.push(`album: ${params.album}`);
  }

  if (params.genre) {
    parts.push(`genre: ${params.genre}`);
  }

  if (params.year) {
    parts.push(`year: ${params.year}`);
  } else if (params.year_min && params.year_max) {
    parts.push(`years: ${params.year_min}-${params.year_max}`);
  } else if (params.year_min) {
    parts.push(`year >= ${params.year_min}`);
  } else if (params.year_max) {
    parts.push(`year <= ${params.year_max}`);
  }

  if (params.rating) {
    parts.push(`rating: ${params.rating} stars`);
  } else if (params.rating_min && params.rating_max) {
    parts.push(`rating: ${params.rating_min}-${params.rating_max} stars`);
  } else if (params.rating_min) {
    parts.push(`rating >= ${params.rating_min} stars`);
  } else if (params.rating_max) {
    parts.push(`rating <= ${params.rating_max} stars`);
  }

  if (params.is_favorite) {
    parts.push("favorites only");
  }

  if (params.rating_is_null) {
    parts.push("unrated songs");
  }

  if (params.has_thumbnail === false) {
    parts.push("no artwork");
  } else if (params.has_thumbnail === true) {
    parts.push("has artwork");
  }

  if (params.tags && params.tags.length > 0) {
    parts.push(`tags: ${params.tags.join(", ")}`);
  }

  if (params.file_format) {
    parts.push(`format: ${params.file_format.toUpperCase()}`);
  }

  if (params.duration_min && params.duration_max) {
    parts.push(
      `duration: ${Math.floor(params.duration_min / 60)}-${Math.floor(params.duration_max / 60)} min`
    );
  } else if (params.duration_min) {
    parts.push(`duration >= ${Math.floor(params.duration_min / 60)} min`);
  } else if (params.duration_max) {
    parts.push(`duration <= ${Math.floor(params.duration_max / 60)} min`);
  }

  return parts.join(", ");
}
