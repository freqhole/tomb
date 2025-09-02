import type { FilterConfig } from "../../admin/components/AdvancedFilterPanel.js";
import type { AdminMusicFilters } from "../../admin/admin-api.js";

/**
 * Music-specific filter configurations for the advanced filter panel
 */
export const musicFilterConfigs: FilterConfig[] = [
  // basic filters
  {
    key: "artist",
    label: "artist",
    type: "text",
    placeholder: "search by artist name...",
  },
  {
    key: "album",
    label: "album",
    type: "text",
    placeholder: "search by album name...",
  },
  {
    key: "genre",
    label: "genre",
    type: "select",
    options: [], // populated dynamically
  },
  {
    key: "year",
    label: "year",
    type: "range",
    min: 1900,
    max: new Date().getFullYear() + 1,
  },

  // metadata filters
  {
    key: "rating",
    label: "rating",
    type: "rating",
  },
  {
    key: "is_favorite",
    label: "favorites only",
    type: "boolean",
  },
  {
    key: "tags",
    label: "tags",
    type: "multi-select",
    options: [], // populated dynamically
  },
  {
    key: "format",
    label: "file format",
    type: "select",
    options: [
      { value: "mp3", label: "MP3" },
      { value: "flac", label: "FLAC" },
      { value: "wav", label: "WAV" },
      { value: "m4a", label: "M4A" },
      { value: "ogg", label: "OGG" },
      { value: "aac", label: "AAC" },
    ],
  },

  // date filters
  {
    key: "created_after",
    label: "date added",
    type: "date-range",
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
          options: filterOptions.genres || [],
        };
      case "tags":
        return {
          ...config,
          options: filterOptions.tags || [],
        };
      default:
        return config;
    }
  });
}

/**
 * Get default music search filters
 */
export function getDefaultMusicFilters(): AdminMusicFilters {
  return {};
}

/**
 * Validate music search filters
 */
export function validateMusicFilters(
  filters: Partial<AdminMusicFilters>
): AdminMusicFilters {
  const validated: AdminMusicFilters = {};

  // validate rating
  if (filters.rating !== undefined) {
    const rating = Number(filters.rating);
    if (!isNaN(rating) && rating >= 0 && rating <= 5) {
      validated.rating = rating;
    }
  }

  // validate rating range
  if (filters.rating_min !== undefined) {
    const min = Number(filters.rating_min);
    if (!isNaN(min) && min >= 0 && min <= 5) {
      validated.rating_min = min;
    }
  }
  if (filters.rating_max !== undefined) {
    const max = Number(filters.rating_max);
    if (!isNaN(max) && max >= 0 && max <= 5) {
      validated.rating_max = max;
    }
  }

  // validate year
  if (filters.year !== undefined) {
    const year = Number(filters.year);
    if (!isNaN(year) && year >= 1900 && year <= new Date().getFullYear() + 1) {
      validated.year = year;
    }
  }

  // validate year range
  if (filters.year_min !== undefined) {
    const min = Number(filters.year_min);
    if (!isNaN(min) && min >= 1900) {
      validated.year_min = min;
    }
  }
  if (filters.year_max !== undefined) {
    const max = Number(filters.year_max);
    if (!isNaN(max) && max <= new Date().getFullYear() + 1) {
      validated.year_max = max;
    }
  }

  // validate boolean fields
  if (filters.is_favorite !== undefined) {
    validated.is_favorite = Boolean(filters.is_favorite);
  }
  if (filters.has_thumbnail !== undefined) {
    validated.has_thumbnail = Boolean(filters.has_thumbnail);
  }

  // validate string fields
  if (filters.artist && typeof filters.artist === "string") {
    validated.artist = filters.artist.trim();
  }
  if (filters.album && typeof filters.album === "string") {
    validated.album = filters.album.trim();
  }
  if (filters.genre && typeof filters.genre === "string") {
    validated.genre = filters.genre.trim();
  }
  if (filters.format && typeof filters.format === "string") {
    validated.format = filters.format.trim();
  }

  // validate tags array
  if (filters.tags && Array.isArray(filters.tags)) {
    validated.tags = filters.tags.filter(
      (tag) => typeof tag === "string" && tag.trim().length > 0
    );
    if (validated.tags.length === 0) {
      delete validated.tags;
    }
  }

  // validate date fields
  if (filters.created_after && typeof filters.created_after === "string") {
    try {
      new Date(filters.created_after);
      validated.created_after = filters.created_after;
    } catch {
      // invalid date, skip
    }
  }
  if (filters.created_before && typeof filters.created_before === "string") {
    try {
      new Date(filters.created_before);
      validated.created_before = filters.created_before;
    } catch {
      // invalid date, skip
    }
  }

  return validated;
}

/**
 * Convert URL search parameters to music filters
 */
export function parseUrlFilters(
  searchParams: URLSearchParams
): AdminMusicFilters {
  const filters: AdminMusicFilters = {};

  // parse simple fields
  const stringFields = ["artist", "album", "genre", "format"];
  stringFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value) {
      (filters as any)[field] = value;
    }
  });

  // parse numeric fields
  const numericFields = [
    "rating",
    "rating_min",
    "rating_max",
    "year",
    "year_min",
    "year_max",
  ];
  numericFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value) {
      const num = Number(value);
      if (!isNaN(num)) {
        (filters as any)[field] = num;
      }
    }
  });

  // parse boolean fields
  const booleanFields = ["is_favorite", "has_thumbnail"];
  booleanFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value === "true") {
      (filters as any)[field] = true;
    } else if (value === "false") {
      (filters as any)[field] = false;
    }
  });

  // parse tags array
  const tags = searchParams.get("tags");
  if (tags) {
    filters.tags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  // parse dates
  const dateFields = ["created_after", "created_before"];
  dateFields.forEach((field) => {
    const value = searchParams.get(field);
    if (value) {
      try {
        new Date(value);
        (filters as any)[field] = value;
      } catch {
        // invalid date, skip
      }
    }
  });

  return validateMusicFilters(filters);
}

/**
 * Convert music filters to URL search parameters
 */
export function filtersToUrlParams(
  filters: AdminMusicFilters
): URLSearchParams {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          params.set(key, value.join(","));
        }
      } else {
        params.set(key, String(value));
      }
    }
  });

  return params;
}
