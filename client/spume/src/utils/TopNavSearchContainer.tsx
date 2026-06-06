import { Component, createSignal } from "solid-js";
import { TopNavSearch, TopNavSearchProps } from "../components/navigation/TopNavSearch";
import { useSearchSuggestions } from "../music/queries/search";
import { getCurrentRemote } from "../music/data";
import type { SearchSuggestion as SearchInputSuggestion } from "../components/forms/SearchInput";
import type { ImageMetadata } from "../music/services/storage/types";
import { getRemoteMediaUrl } from "./urls";

type TopNavSearchContainerProps = Omit<
  TopNavSearchProps,
  | "suggestions"
  | "onSearchChange"
  | "hasMoreSuggestions"
  | "isLoadingSuggestions"
  | "onLoadMoreSuggestions"
> & {
  /** callback when search expanded state changes */
  onExpandedChange?: (expanded: boolean) => void;
  /** whether the parent nav is being hovered */
  navHovered?: boolean;
};

/**
 * smart wrapper around TopNavSearch that provides search suggestions
 * using tanstack-query hooks
 */
export const TopNavSearchContainer: Component<TopNavSearchContainerProps> = (props) => {
  const [searchInput, setSearchInput] = createSignal("");

  const suggestionsQuery = useSearchSuggestions({
    field: () => "all",
    partial: searchInput,
  });

  // map API suggestions to SearchInputSuggestion format
  const suggestions = (): SearchInputSuggestion[] => {
    const data = suggestionsQuery.data?.pages?.flatMap((p) => p.suggestions) || [];
    const remote = getCurrentRemote();
    const baseUrl = remote?.base_url || "";
    const remoteId = remote?.remote_id;

    return data.map((s) => {
      return {
        id: s.entity_id,
        text: s.display,
        category: s.suggestion_type || "unknown",
        highlight: s.highlight,
        images: parseMetadataImages(s.metadata, baseUrl, remoteId),
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
      isLoadingSuggestions={suggestionsQuery.isFetching || suggestionsQuery.isFetchingNextPage}
      onLoadMoreSuggestions={() => suggestionsQuery.fetchNextPage()}
      remoteIdFor={() => getCurrentRemote()?.remote_id}
    />
  );
};

// parse the images JSON string from suggestion metadata into ImageMetadata[]
function parseMetadataImages(
  metadata: any,
  baseUrl: string,
  remoteId?: string
): ImageMetadata[] | undefined {
  if (!metadata?.images) return undefined;
  try {
    const raw = typeof metadata.images === "string" ? JSON.parse(metadata.images) : metadata.images;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw.map((img: any) => ({
      remote_blob_id: img.media_blob_id,
      remote_url: getRemoteMediaUrl(baseUrl, img.media_blob_id),
      remote_server_id: remoteId,
      is_primary: !!img.is_primary,
      blob_type: "thumbnail" as const,
    }));
  } catch {
    return undefined;
  }
}
