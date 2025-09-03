import type { FilterConfig } from "../../admin/components/AdvancedFilterPanel.js";
import type { UnifiedSearchParams } from "../../../hooks/search/useUnifiedSearch.js";
// Note: removed unused musicFilterFields import

/**
 * Music-specific filter configurations for the advanced filter panel
 * Updated to work with the unified search system and comprehensive backend
 */
export const musicFilterConfigs: FilterConfig[] = [
  // text search filters
  {
    key: "q",
    label: "search query",
    type: "text",
    placeholder: "search songs, artists, albums...",
  },
  {
    key: "artist",
    label: "artist",
    type: "text",
    placeholder: "search by artist name",
  },
  {
    key: "album",
    label: "album",
    type: "text",
    placeholder: "search by album name",
  },
  {
    key: "title",
    label: "song title",
    type: "text",
    placeholder: "search by song title",
  },
  {
    key: "genre",
    label: "genre",
    type: "select",
    placeholder: "select genre",
    options: [], // populated dynamically from API
  },

  // numeric range filters
  {
    key: "year",
    label: "year",
    type: "range",
    min: 1900,
    max: new Date().getFullYear() + 1,
  },
  {
    key: "rating",
    label: "rating",
    type: "rating",
    min: 0,
    max: 5,
  },
  {
    key: "duration_min",
    label: "min duration (seconds)",
    type: "range",
    min: 0,
    max: 3600, // 1 hour
  },
  {
    key: "duration_max",
    label: "max duration (seconds)",
    type: "range",
    min: 0,
    max: 3600, // 1 hour
  },

  // boolean filters
  {
    key: "is_favorite",
    label: "favorites only",
    type: "boolean",
  },
  {
    key: "has_thumbnail",
    label: "has artwork",
    type: "boolean",
  },

  // array filters
  {
    key: "tags",
    label: "tags",
    type: "multi-select",
    placeholder: "select tags",
    options: [], // populated dynamically
  },
  {
    key: "file_formats",
    label: "file format",
    type: "multi-select",
    options: [
      { value: "mp3", label: "MP3" },
      { value: "flac", label: "FLAC" },
      { value: "wav", label: "WAV" },
      { value: "m4a", label: "M4A/AAC" },
      { value: "ogg", label: "OGG Vorbis" },
      { value: "aac", label: "AAC" },
    ],
  },

  // date filters
  {
    key: "created_after",
    label: "added after",
    type: "date-range",
  },
  {
    key: "created_before",
    label: "added before",
    type: "date-range",
  },

  // null checking filters
  {
    key: "rating_is_null",
    label: "unrated songs",
    type: "boolean",
  },
  {
    key: "genre_is_null",
    label: "no genre set",
    type: "boolean",
  },
  {
    key: "year_is_null",
    label: "no year set",
    type: "boolean",
  },

  // metadata filters
  {
    key: "bpm_min",
    label: "minimum BPM",
    type: "range",
    min: 0,
    max: 300,
  },
  {
    key: "bpm_max",
    label: "maximum BPM",
    type: "range",
    min: 0,
    max: 300,
  },
  {
    key: "key_signature",
    label: "key signature",
    type: "select",
    options: [
      { value: "C", label: "C Major" },
      { value: "C#", label: "C# Major" },
      { value: "Db", label: "Db Major" },
      { value: "D", label: "D Major" },
      { value: "D#", label: "D# Major" },
      { value: "Eb", label: "Eb Major" },
      { value: "E", label: "E Major" },
      { value: "F", label: "F Major" },
      { value: "F#", label: "F# Major" },
      { value: "Gb", label: "Gb Major" },
      { value: "G", label: "G Major" },
      { value: "G#", label: "G# Major" },
      { value: "Ab", label: "Ab Major" },
      { value: "A", label: "A Major" },
      { value: "A#", label: "A# Major" },
      { value: "Bb", label: "Bb Major" },
      { value: "B", label: "B Major" },
      { value: "Am", label: "A Minor" },
      { value: "A#m", label: "A# Minor" },
      { value: "Bbm", label: "Bb Minor" },
      { value: "Bm", label: "B Minor" },
      { value: "Cm", label: "C Minor" },
      { value: "C#m", label: "C# Minor" },
      { value: "Dm", label: "D Minor" },
      { value: "D#m", label: "D# Minor" },
      { value: "Ebm", label: "Eb Minor" },
      { value: "Em", label: "E Minor" },
      { value: "Fm", label: "F Minor" },
      { value: "F#m", label: "F# Minor" },
      { value: "Gm", label: "G Minor" },
      { value: "G#m", label: "G# Minor" },
    ],
  },
];

/**
 * Update filter configs with dynamic options from API
 */
export function updateMusicFilterConfigs(
  configs: FilterConfig[],
  filterOptions: any
): FilterConfig[] {
  return configs.map((config) => {
    switch (config.key) {
      case "genre":
        return {
          ...config,
          options: filterOptions?.genres || [],
        };
      case "tags":
        return {
          ...config,
          options: filterOptions?.tags || [],
        };
      case "artist":
        return {
          ...config,
          suggestions: filterOptions?.artists?.map((a: any) => a.value) || [],
        };
      case "album":
        return {
          ...config,
          suggestions: filterOptions?.albums?.map((a: any) => a.value) || [],
        };
      default:
        return config;
    }
  });
}

/**
 * Get default unified search parameters for music
 */
export function getDefaultMusicSearchParams(): UnifiedSearchParams {
  return {
    page: 1,
    page_size: 20,
    sort_by: "created_at",
    sort_direction: "desc",
    songs_only: true,
  };
}

/**
 * Validate unified search parameters for music domain
 */
export function validateMusicSearchParams(
  params: Partial<UnifiedSearchParams>
): UnifiedSearchParams {
  const validated: UnifiedSearchParams = {};

  // validate pagination
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
  const textFields = [
    "q",
    "artist",
    "album",
    "title",
    "genre",
    "key_signature",
  ];
  textFields.forEach((field) => {
    const value = params[field as keyof UnifiedSearchParams];
    if (value && typeof value === "string" && value.trim().length > 0) {
      (validated as any)[field] = value.trim();
    }
  });

  // validate exact match flags
  if (params.artist_exact !== undefined) {
    validated.artist_exact = Boolean(params.artist_exact);
  }
  if (params.album_exact !== undefined) {
    validated.album_exact = Boolean(params.album_exact);
  }

  // validate numeric fields
  const numericFields = [
    "year",
    "year_min",
    "year_max",
    "rating",
    "rating_min",
    "rating_max",
    "duration_min",
    "duration_max",
    "duration_seconds",
    "bpm",
    "bpm_min",
    "bpm_max",
  ];
  numericFields.forEach((field) => {
    const value = params[field as keyof UnifiedSearchParams];
    if (value !== undefined) {
      const num = Number(value);
      if (!isNaN(num) && num >= 0) {
        (validated as any)[field] = num;
      }
    }
  });

  // validate boolean fields
  const booleanFields = [
    "is_favorite",
    "has_thumbnail",
    "songs_only",
    "rating_is_null",
    "genre_is_null",
    "year_is_null",
    "bpm_is_null",
    "key_signature_is_null",
  ];
  booleanFields.forEach((field) => {
    const value = params[field as keyof UnifiedSearchParams];
    if (value !== undefined) {
      (validated as any)[field] = Boolean(value);
    }
  });

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

  if (params.file_formats && Array.isArray(params.file_formats)) {
    const validFormats = params.file_formats.filter(
      (format) => typeof format === "string" && format.trim().length > 0
    );
    if (validFormats.length > 0) {
      validated.file_formats = validFormats;
    }
  }

  // validate sort fields
  if (params.sort_by && typeof params.sort_by === "string") {
    const validSortFields = [
      "title",
      "artist",
      "album",
      "year",
      "rating",
      "duration_seconds",
      "created_at",
      "updated_at",
      "bpm",
      "genre",
      "track_number",
    ];
    if (validSortFields.includes(params.sort_by)) {
      validated.sort_by = params.sort_by;
    }
  }

  if (params.sort_direction && typeof params.sort_direction === "string") {
    if (params.sort_direction === "asc" || params.sort_direction === "desc") {
      validated.sort_direction = params.sort_direction;
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

  return validated;
}

/**
 * Convert URL search parameters to unified search params
 */
export function parseUrlToSearchParams(
  searchParams: URLSearchParams
): UnifiedSearchParams {
  const params: Partial<UnifiedSearchParams> = {};

  // parse simple string fields
  const stringFields = [
    "q",
    "artist",
    "album",
    "title",
    "genre",
    "key_signature",
    "sort_by",
    "sort_direction",
  ];
  stringFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value) {
      (params as any)[field] = value;
    }
  });

  // parse numeric fields
  const numericFields = [
    "page",
    "page_size",
    "year",
    "year_min",
    "year_max",
    "rating",
    "rating_min",
    "rating_max",
    "duration_min",
    "duration_max",
    "duration_seconds",
    "bpm",
    "bpm_min",
    "bpm_max",
  ];
  numericFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value) {
      const num = Number(value);
      if (!isNaN(num)) {
        (params as any)[field] = num;
      }
    }
  });

  // parse boolean fields
  const booleanFields = [
    "is_favorite",
    "has_thumbnail",
    "songs_only",
    "artist_exact",
    "album_exact",
    "rating_is_null",
    "genre_is_null",
    "year_is_null",
  ];
  booleanFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value === "true") {
      (params as any)[field] = true;
    } else if (value === "false") {
      (params as any)[field] = false;
    }
  });

  // parse array fields
  const tags = searchParams.get("tags");
  if (tags) {
    params.tags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  const tagsAny = searchParams.get("tags_any");
  if (tagsAny) {
    params.tags_any = tagsAny
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  const tagsExclude = searchParams.get("tags_exclude");
  if (tagsExclude) {
    params.tags_exclude = tagsExclude
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  const fileFormats = searchParams.get("file_formats");
  if (fileFormats) {
    params.file_formats = fileFormats
      .split(",")
      .map((format) => format.trim())
      .filter((format) => format.length > 0);
  }

  // parse date fields
  const dateFields = ["created_after", "created_before"];
  dateFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value) {
      try {
        new Date(value);
        (params as any)[field] = value;
      } catch {
        // invalid date, skip
      }
    }
  });

  return validateMusicSearchParams(params);
}

/**
 * Convert unified search params to URL search parameters
 */
export function searchParamsToUrl(
  params: UnifiedSearchParams
): URLSearchParams {
  const urlParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          urlParams.set(key, value.join(","));
        }
      } else {
        urlParams.set(key, String(value));
      }
    }
  });

  return urlParams;
}

/**
 * Generate human-readable filter summary for music search
 */
export function generateMusicFilterSummary(
  params: UnifiedSearchParams
): string {
  const parts: string[] = [];

  if (params.q) {
    parts.push(`search: "${params.q}"`);
  }

  if (params.artist) {
    const exactStr = params.artist_exact ? " (exact)" : "";
    parts.push(`artist: ${params.artist}${exactStr}`);
  }

  if (params.album) {
    const exactStr = params.album_exact ? " (exact)" : "";
    parts.push(`album: ${params.album}${exactStr}`);
  }

  if (params.title) {
    parts.push(`title: ${params.title}`);
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

  if (params.genre_is_null) {
    parts.push("no genre");
  }

  if (params.year_is_null) {
    parts.push("no year");
  }

  if (params.has_thumbnail === false) {
    parts.push("no artwork");
  } else if (params.has_thumbnail === true) {
    parts.push("has artwork");
  }

  if (params.tags && params.tags.length > 0) {
    parts.push(`tags: ${params.tags.join(", ")}`);
  }

  if (params.tags_any && params.tags_any.length > 0) {
    parts.push(`any tags: ${params.tags_any.join(", ")}`);
  }

  if (params.tags_exclude && params.tags_exclude.length > 0) {
    parts.push(`exclude tags: ${params.tags_exclude.join(", ")}`);
  }

  if (params.file_formats && params.file_formats.length > 0) {
    parts.push(
      `formats: ${params.file_formats.map((f) => f.toUpperCase()).join(", ")}`
    );
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

  if (params.bpm) {
    parts.push(`bpm: ${params.bpm}`);
  } else if (params.bpm_min && params.bpm_max) {
    parts.push(`bpm: ${params.bpm_min}-${params.bpm_max}`);
  } else if (params.bpm_min) {
    parts.push(`bpm >= ${params.bpm_min}`);
  } else if (params.bpm_max) {
    parts.push(`bpm <= ${params.bpm_max}`);
  }

  if (params.key_signature) {
    parts.push(`key: ${params.key_signature}`);
  }

  if (params.created_after) {
    const date = new Date(params.created_after);
    parts.push(`added after ${date.toLocaleDateString()}`);
  }

  if (params.created_before) {
    const date = new Date(params.created_before);
    parts.push(`added before ${date.toLocaleDateString()}`);
  }

  return parts.join(", ");
}

/**
 * Music search preset configurations
 */
export const musicSearchPresets = [
  {
    id: "favorites",
    label: "favorites",
    params: { is_favorite: true },
  },
  {
    id: "recent",
    label: "recent additions",
    params: {
      created_after: new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
    },
  },
  {
    id: "unrated",
    label: "unrated songs",
    params: { rating_is_null: true },
  },
  {
    id: "highly-rated",
    label: "highly rated",
    params: { rating_min: 4 },
  },
  {
    id: "no-artwork",
    label: "missing artwork",
    params: { has_thumbnail: false },
  },
  {
    id: "lossless",
    label: "lossless audio",
    params: { file_formats: ["flac", "wav"] },
  },
  {
    id: "short-tracks",
    label: "short tracks",
    params: { duration_max: 180 },
  },
  {
    id: "long-tracks",
    label: "long tracks",
    params: { duration_min: 300 },
  },
  {
    id: "no-genre",
    label: "no genre set",
    params: { genre_is_null: true },
  },
  {
    id: "no-year",
    label: "no year set",
    params: { year_is_null: true },
  },
  {
    id: "high-bpm",
    label: "high energy",
    params: { bpm_min: 120 },
  },
  {
    id: "low-bpm",
    label: "low energy",
    params: { bpm_max: 80 },
  },
];
