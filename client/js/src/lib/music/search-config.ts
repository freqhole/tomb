/* Music Search Configuration
 * Shared filter configurations and search setup for music domain
 */

import type { FilterField, FilterOption } from "../../components/search/SearchFilters.js";
import type { SearchSuggestion } from "../../components/search/SearchInput.js";

// Music-specific filter field configurations
export const musicFilterFields: FilterField[] = [
  {
    key: "genre",
    label: "genre",
    type: "select",
    placeholder: "select genre",
  },
  {
    key: "artist",
    label: "artist",
    type: "text",
    placeholder: "enter artist name",
  },
  {
    key: "album",
    label: "album",
    type: "text",
    placeholder: "enter album name",
  },
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
    type: "range",
    min: 1,
    max: 5,
  },
  {
    key: "bpm",
    label: "bpm",
    type: "range",
    min: 60,
    max: 200,
  },
  {
    key: "key_signature",
    label: "key",
    type: "text",
    placeholder: "e.g. C, Am, F#",
  },
  {
    key: "favorites_only",
    label: "favorites only",
    type: "boolean",
  },
  {
    key: "tags",
    label: "tags",
    type: "multi-select",
  },
  {
    key: "created_date",
    label: "added date",
    type: "date",
  },
];

// Quick filter presets for music
export const musicQuickFilters = [
  {
    key: "favorites_only",
    value: true,
    label: "favorites",
    description: "show only favorited songs",
    category: "status",
  },
  {
    key: "rating",
    value: [4, 5],
    label: "highly rated",
    description: "4-5 star ratings",
    category: "rating",
  },
  {
    key: "rating",
    value: [1, 1],
    label: "unrated",
    description: "songs without ratings",
    category: "rating",
  },
  {
    key: "genre",
    value: "rock",
    label: "rock",
    description: "rock genre songs",
    category: "genre",
  },
  {
    key: "genre",
    value: "jazz",
    label: "jazz",
    description: "jazz genre songs",
    category: "genre",
  },
  {
    key: "genre",
    value: "electronic",
    label: "electronic",
    description: "electronic genre songs",
    category: "genre",
  },
  {
    key: "year",
    value: [2020, new Date().getFullYear()],
    label: "recent",
    description: "songs from 2020 onwards",
    category: "time",
  },
  {
    key: "bpm",
    value: [120, 140],
    label: "danceable",
    description: "120-140 bpm range",
    category: "features",
  },
];

// Music suggestions API configuration
export interface MusicSuggestionsConfig {
  endpoint: string;
  transform: (data: any) => SearchSuggestion[];
}

export const createMusicSuggestionsAPI = (apiBaseUrl: string): ((query: string) => Promise<SearchSuggestion[]>) => {
  return async (query: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/music/suggestions?q=${encodeURIComponent(query)}&limit=8`);
      if (!response.ok) {
        throw new Error(`suggestions api error: ${response.status}`);
      }

      const data = await response.json();

      // Transform API response to SearchSuggestion format
      if (data.suggestions && Array.isArray(data.suggestions)) {
        return data.suggestions.map((item: any) => ({
          text: item.text || item.value || String(item),
          category: item.suggestion_type || item.category || "music",
          highlight: item.highlight,
        }));
      }

      return [];
    } catch (error) {
      console.error("failed to fetch music suggestions:", error);
      return [];
    }
  };
};

// Filter options API configuration
export const createMusicFilterOptionsAPI = (apiBaseUrl: string) => {
  return async (): Promise<Record<string, FilterOption[]>> => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/music/filter-options`);
      if (!response.ok) {
        throw new Error(`filter options api error: ${response.status}`);
      }

      const data = await response.json();

      // Transform API response to FilterOption format
      const options: Record<string, FilterOption[]> = {};

      if (data.genres && Array.isArray(data.genres)) {
        options.genre = data.genres.map((item: any) => ({
          value: item.value || item,
          label: item.label || item,
          count: item.count,
        }));
      }

      if (data.tags && Array.isArray(data.tags)) {
        options.tags = data.tags.map((item: any) => ({
          value: item.value || item,
          label: item.label || item,
          count: item.count,
        }));
      }

      return options;
    } catch (error) {
      console.error("failed to fetch music filter options:", error);
      return {};
    }
  };
};

// Common music search configuration factory
export interface MusicSearchConfig {
  apiBaseUrl: string;
  filterFields: FilterField[];
  quickFilters: typeof musicQuickFilters;
  suggestionsAPI: (query: string) => Promise<SearchSuggestion[]>;
  filterOptionsAPI: () => Promise<Record<string, FilterOption[]>>;
}

export const createMusicSearchConfig = (apiBaseUrl: string): MusicSearchConfig => {
  return {
    apiBaseUrl,
    filterFields: musicFilterFields,
    quickFilters: musicQuickFilters,
    suggestionsAPI: createMusicSuggestionsAPI(apiBaseUrl),
    filterOptionsAPI: createMusicFilterOptionsAPI(apiBaseUrl),
  };
};

// Default configuration for music search components
export const defaultMusicSearchConfig = createMusicSearchConfig(window.location.origin);
