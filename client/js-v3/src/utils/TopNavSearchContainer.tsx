import { Component, createSignal } from "solid-js";
import { TopNavSearch, TopNavSearchProps } from "../components/navigation/TopNavSearch";
import { useSearchSuggestions } from "../music/queries/search";
import type { SearchSuggestion as SearchInputSuggestion } from "../components/forms/SearchInput";

type TopNavSearchContainerProps = Omit<
  TopNavSearchProps,
  | "suggestions"
  | "onSearchChange"
  | "hasMoreSuggestions"
  | "isLoadingSuggestions"
  | "onLoadMoreSuggestions"
>;

/**
 * smart wrapper around TopNavSearch that provides search suggestions
 * using tanstack-query hooks
 */
export const TopNavSearchContainer: Component<TopNavSearchContainerProps> = (
  props
) => {
  const [searchInput, setSearchInput] = createSignal("");
  
  const suggestionsQuery = useSearchSuggestions({
    field: () => "all",
    partial: searchInput,
  });

  // map API suggestions to SearchInputSuggestion format
  const suggestions = (): SearchInputSuggestion[] => {
    const data = suggestionsQuery.data?.pages?.flatMap((p) => p.suggestions) || [];

    return data.map((s) => {
      return {
        id: s.entity_id,
        text: s.display,
        category: s.suggestion_type || "unknown",
        highlight: s.highlight,
        count: s.count > 0 ? s.count : undefined,
        isFavorite: s.is_favorite,
        data: s,
      };
    });
  };

  return (
    <TopNavSearch
      {...props}
      suggestions={suggestions()}
      onSearchChange={(value) => setSearchInput(value)}
      hasMoreSuggestions={suggestionsQuery.hasNextPage}
      isLoadingSuggestions={
        suggestionsQuery.isFetching || suggestionsQuery.isFetchingNextPage
      }
      onLoadMoreSuggestions={() => suggestionsQuery.fetchNextPage()}
    />
  );
};
