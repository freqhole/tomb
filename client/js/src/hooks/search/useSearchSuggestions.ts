import { createSignal, createMemo, createEffect } from "solid-js";
import type { ApiClient } from "../../lib/api-client.js";
import type {
  SuggestionsOptions,
  SearchSuggestion,
} from "../../lib/search-types.js";

export interface UseSearchSuggestionsProps {
  apiClient: ApiClient;
  query: () => string;
  debounceMs?: number;
  minQueryLength?: number;
  maxSuggestions?: number;
  enabled?: boolean;
  onError?: (error: Error) => void;
}

export interface UseSearchSuggestionsReturn {
  // Suggestions state
  suggestions: () => SearchSuggestion[];
  loading: () => boolean;
  error: () => Error | null;

  // Computed state
  hasSuggestions: () => boolean;
  suggestionsCount: () => number;
  isEmpty: () => boolean;

  // Actions
  refresh: () => Promise<void>;
  clearSuggestions: () => void;
  clearError: () => void;
}

/**
 * Debounce utility function
 */
function debounce<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  }) as T;
}

/**
 * Search suggestions hook that provides debounced autocomplete functionality
 *
 * This hook automatically fetches suggestions based on the query signal,
 * with configurable debouncing and minimum query length requirements.
 */
export function useSearchSuggestions(
  props: UseSearchSuggestionsProps
): UseSearchSuggestionsReturn {
  // Core state
  const [suggestions, setSuggestions] = createSignal<SearchSuggestion[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  // Configuration with defaults
  const minQueryLength = () => props.minQueryLength ?? 2;
  const maxSuggestions = () => props.maxSuggestions ?? 10;
  const enabled = () => props.enabled ?? true;

  // Computed state
  const hasSuggestions = createMemo(() => suggestions().length > 0);
  const suggestionsCount = createMemo(() => suggestions().length);
  const isEmpty = createMemo(() => {
    const query = props.query().trim();
    return query.length === 0;
  });

  // Main suggestions fetch function
  const fetchSuggestions = async (queryText: string) => {
    if (!enabled()) return;

    const trimmed = queryText.trim();

    // Clear suggestions if query is too short
    if (trimmed.length < minQueryLength()) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const options: SuggestionsOptions = {
        q: trimmed,
        limit: maxSuggestions(),
      };

      const result = await props.apiClient.getMusicSuggestions(
        trimmed,
        options
      );
      setSuggestions(result.suggestions);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setSuggestions([]);

      if (props.onError) {
        props.onError(error);
      }
    } finally {
      setLoading(false);
    }
  };

  // Debounced suggestions fetch
  const debouncedFetch = debounce(fetchSuggestions, props.debounceMs || 300);

  // Auto-fetch effect based on query changes
  createEffect(() => {
    const query = props.query();

    if (enabled()) {
      debouncedFetch(query);
    } else {
      setSuggestions([]);
    }
  });

  // Clear error when query changes
  createEffect(() => {
    props.query(); // Track query changes
    if (error()) {
      setError(null);
    }
  });

  // Refresh function for manual triggering
  const refresh = async () => {
    const query = props.query();
    await fetchSuggestions(query);
  };

  // Clear suggestions function
  const clearSuggestions = () => {
    setSuggestions([]);
  };

  // Clear error function
  const clearError = () => {
    setError(null);
  };

  return {
    // State getters
    suggestions,
    loading,
    error,

    // Computed state
    hasSuggestions,
    suggestionsCount,
    isEmpty,

    // Actions
    refresh,
    clearSuggestions,
    clearError,
  };
}

export default useSearchSuggestions;
