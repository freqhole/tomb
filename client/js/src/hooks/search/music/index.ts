//! Music search hooks module exports

// Music filter hook
export { useMusicFilters } from './useMusicFilters.js';
export type { UseMusicFiltersProps, UseMusicFiltersReturn } from './useMusicFilters.js';

// Re-export music filter types from lib for convenience
export type {
  FilterOption,
  FilterParams,
  AllFiltersResponse,
  DefaultFilterOptions,
  MusicFilterClient,
  MusicFilterApiError,
} from '../../../lib/search/music/index.js';

// Re-export music filter client utilities
export {
  createMusicFilterClient,
  createDefaultMusicFilterClient,
  transformToDefaultFormat,
  enrichWithCounts,
} from '../../../lib/search/music/index.js';
