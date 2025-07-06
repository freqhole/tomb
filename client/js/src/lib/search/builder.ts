import type { ApiClient } from "../api-client.js";
import type {
  SearchResult,
  SongsSearchResult,
  SuggestionsResult,
  MusicSearchOptions,
  SongsSearchOptions,
  SuggestionsOptions,
} from "./types.js";

// Base search builder class
export class SearchBuilder {
  private queryText: string = "";
  private options: Record<string, unknown> = {};

  constructor(protected apiClient: ApiClient) {}

  // Text search methods
  query(text: string): this {
    this.queryText = text;
    return this;
  }

  structured(field: string, value: string): this {
    this.queryText = `${field}:${value}`;
    this.options.structured = true;
    return this;
  }

  // Search type methods
  websearch(): this {
    this.options.search_type = "websearch";
    return this;
  }

  plainto(): this {
    this.options.search_type = "plainto";
    return this;
  }

  phrase(): this {
    this.options.search_type = "phrase";
    return this;
  }

  // Pagination methods
  page(pageNum: number): this {
    this.options.page = pageNum;
    return this;
  }

  pageSize(size: number): this {
    this.options.page_size = size;
    return this;
  }

  // Sorting methods
  sortBy(field: string, direction: "asc" | "desc" = "desc"): this {
    this.options.sort_by = field;
    this.options.sort_direction = direction;
    return this;
  }

  sortByRelevance(direction: "asc" | "desc" = "desc"): this {
    return this.sortBy("relevance", direction);
  }

  sortByTitle(direction: "asc" | "desc" = "asc"): this {
    return this.sortBy("title", direction);
  }

  sortByCreatedAt(direction: "asc" | "desc" = "desc"): this {
    return this.sortBy("created_at", direction);
  }

  // Domain-specific builders
  music(): MusicSearchBuilder {
    return new MusicSearchBuilder(this.apiClient, this.queryText, this.options);
  }

  // Future domain builders
  // photos(): PhotoSearchBuilder { ... }
  // videos(): VideoSearchBuilder { ... }
  // documents(): DocumentSearchBuilder { ... }

  // Reset builder state
  reset(): this {
    this.queryText = "";
    this.options = {};
    return this;
  }

  // Get current query and options
  getQuery(): string {
    return this.queryText;
  }

  getOptions(): Record<string, unknown> {
    return { ...this.options };
  }

  // Protected method to get mutable options reference
  protected getMutableOptions(): Record<string, unknown> {
    return this.options;
  }
}

// Music-specific search builder
class MusicSearchBuilder extends SearchBuilder {
  constructor(
    apiClient: ApiClient,
    initialQuery: string = "",
    initialOptions: Record<string, unknown> = {}
  ) {
    super(apiClient);
    if (initialQuery) this.query(initialQuery);
    Object.assign(this.getMutableOptions(), initialOptions);
  }

  // Music-specific filter methods
  artist(name: string): this {
    const options = this.getMutableOptions();
    options.artist = name;
    return this;
  }

  album(name: string): this {
    const options = this.getMutableOptions();
    options.album = name;
    return this;
  }

  genre(genre: string): this {
    const options = this.getMutableOptions();
    options.genre = genre;
    return this;
  }

  year(year: number): this {
    const options = this.getMutableOptions();
    options.year = year;
    return this;
  }

  rating(min?: number, max?: number): this {
    const options = this.getMutableOptions();
    if (min !== undefined) options.rating_min = min;
    if (max !== undefined) options.rating_max = max;
    return this;
  }

  ratingMin(min: number): this {
    const options = this.getMutableOptions();
    options.rating_min = min;
    return this;
  }

  ratingMax(max: number): this {
    const options = this.getMutableOptions();
    options.rating_max = max;
    return this;
  }

  favoritesOnly(): this {
    const options = this.getMutableOptions();
    options.favorites_only = true;
    return this;
  }

  // Music-specific sorting
  sortByArtist(direction: "asc" | "desc" = "asc"): this {
    return this.sortBy("artist", direction);
  }

  sortByAlbum(direction: "asc" | "desc" = "asc"): this {
    return this.sortBy("album", direction);
  }

  sortByRating(direction: "asc" | "desc" = "desc"): this {
    return this.sortBy("rating", direction);
  }

  // Structured search helpers for music
  artistSearch(artistName: string): this {
    return this.structured("artist", artistName);
  }

  albumSearch(albumName: string): this {
    return this.structured("album", albumName);
  }

  genreSearch(genreName: string): this {
    return this.structured("genre", genreName);
  }

  titleSearch(title: string): this {
    return this.structured("title", title);
  }

  // Execution methods
  async execute(): Promise<SearchResult> {
    const query = this.getQuery();
    const options = this.getOptions() as Omit<MusicSearchOptions, "q">;

    if (!query) {
      throw new Error("Query is required for search execution");
    }

    return this.apiClient.searchMusic(query, options);
  }

  async executeSongs(): Promise<SongsSearchResult> {
    const query = this.getQuery();
    const options = this.getOptions() as Omit<SongsSearchOptions, "q">;

    if (!query) {
      throw new Error("Query is required for songs search execution");
    }

    return this.apiClient.searchSongs(query, options);
  }

  async getSuggestions(limit?: number): Promise<SuggestionsResult> {
    const query = this.getQuery();
    const options: Omit<SuggestionsOptions, "q"> = {};

    if (limit !== undefined) {
      options.limit = limit;
    }

    if (!query) {
      throw new Error("Query is required for suggestions");
    }

    return this.apiClient.getMusicSuggestions(query, options);
  }

  // Chain multiple conditions with AND logic
  and(): this {
    // For future enhancement - could support complex query building
    return this;
  }

  // Create a copy of this builder
  clone(): MusicSearchBuilder {
    return new MusicSearchBuilder(
      this.apiClient,
      this.getQuery(),
      this.getOptions()
    );
  }
}

// Factory function to create search builders
export function createSearchBuilder(apiClient: ApiClient): SearchBuilder {
  return new SearchBuilder(apiClient);
}

// Factory function to create music search builders
export function createMusicSearchBuilder(
  apiClient: ApiClient
): MusicSearchBuilder {
  return new MusicSearchBuilder(apiClient);
}

// Utility types for builder patterns
export type SearchBuilderChain = SearchBuilder;
export type MusicSearchBuilderChain = MusicSearchBuilder;

// Export the main builder classes
export { MusicSearchBuilder };
