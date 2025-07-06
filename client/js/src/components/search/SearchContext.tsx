/* @jsxImportSource solid-js */
import { createContext, useContext, JSX } from "solid-js";
import type { ApiClient } from "../../lib/api-client.js";
import { useSearchAll, type UseSearchAllProps, type UseSearchAllReturn } from "../../hooks/useSearchAll.js";

export interface SearchContextValue extends UseSearchAllReturn {
  apiClient: ApiClient;
}

export interface SearchProviderProps {
  children: JSX.Element;
  apiClient: ApiClient;
  /** Search configuration options */
  searchOptions?: Partial<UseSearchAllProps>;
}

// Create the context
const SearchContext = createContext<SearchContextValue>();

/**
 * SearchProvider component
 *
 * Provides search functionality to child components through context.
 * This is an optional convenience wrapper - components can also use hooks directly.
 */
export function SearchProvider(props: SearchProviderProps) {
  const searchAll = useSearchAll({
    apiClient: props.apiClient,
    initialQuery: props.searchOptions?.initialQuery || "",
    initialDomain: props.searchOptions?.initialDomain || "music",
    enableHistory: props.searchOptions?.enableHistory ?? true,
    enableSuggestions: props.searchOptions?.enableSuggestions ?? true,
    debounceMs: props.searchOptions?.debounceMs || 300,
    autoSearch: props.searchOptions?.autoSearch ?? false,
    integrationMode: props.searchOptions?.integrationMode || "standalone",
    webSocketItems: props.searchOptions?.webSocketItems,
    onError: props.searchOptions?.onError,
  });

  const contextValue: SearchContextValue = {
    ...searchAll,
    apiClient: props.apiClient,
  };

  return (
    <SearchContext.Provider value={contextValue}>
      {props.children}
    </SearchContext.Provider>
  );
}

/**
 * Hook to access search context
 *
 * @throws Error if used outside of SearchProvider
 */
export function useSearchContext(): SearchContextValue {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error("useSearchContext must be used within a SearchProvider");
  }
  return context;
}

/**
 * Hook to safely access search context
 *
 * @returns SearchContextValue or undefined if not within provider
 */
export function useOptionalSearchContext(): SearchContextValue | undefined {
  return useContext(SearchContext);
}

export default SearchProvider;
