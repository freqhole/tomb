import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SearchBox } from "../../../src/components/search/SearchBox";
import { SearchResults } from "../../../src/components/search/SearchResults";
import { SearchFilters } from "../../../src/components/search/SearchFilters";
import { SearchProvider, useSearchContext } from "../../../src/components/search/SearchContext";
import { ApiClient } from "../../../src/lib/api-client";
import type { SearchResult, FilterOption } from "../../../src/components/search";

// Mock API client
const mockApiClient = {
  search: vi.fn(),
  searchSongs: vi.fn(),
  getSearchSuggestions: vi.fn(),
} as unknown as ApiClient;

describe("SearchBox", () => {
  let mockOnQueryChange: ReturnType<typeof vi.fn>;
  let mockOnSearch: ReturnType<typeof vi.fn>;
  let mockOnSuggestionSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnQueryChange = vi.fn();
    mockOnSearch = vi.fn();
    mockOnSuggestionSelect = vi.fn();
  });

  it("renders with basic props", () => {
    render(() => (
      <SearchBox
        query="test query"
        onQueryChange={mockOnQueryChange}
        placeholder="Search music..."
      />
    ));

    const input = screen.getByPlaceholderText("Search music...");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("test query");
  });

  it("calls onQueryChange when input changes", async () => {
    render(() => (
      <SearchBox
        query=""
        onQueryChange={mockOnQueryChange}
      />
    ));

    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "new query" } });

    expect(mockOnQueryChange).toHaveBeenCalledWith("new query");
  });

  it("calls onSearch when Enter key is pressed", async () => {
    render(() => (
      <SearchBox
        query="test"
        onQueryChange={mockOnQueryChange}
        onSearch={mockOnSearch}
      />
    ));

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockOnSearch).toHaveBeenCalledWith("test");
  });

  it("shows suggestions dropdown when available", async () => {
    render(() => (
      <SearchBox
        query="test"
        onQueryChange={mockOnQueryChange}
        suggestions={["test song", "test artist"]}
        showSuggestions={true}
      />
    ));

    // Focus input to trigger suggestions
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText("test song")).toBeInTheDocument();
      expect(screen.getByText("test artist")).toBeInTheDocument();
    });
  });

  it("handles suggestion selection", async () => {
    render(() => (
      <SearchBox
        query="test"
        onQueryChange={mockOnQueryChange}
        onSuggestionSelect={mockOnSuggestionSelect}
        suggestions={["test song"]}
        showSuggestions={true}
      />
    ));

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);

    await waitFor(() => {
      const suggestion = screen.getByText("test song");
      fireEvent.click(suggestion);
    });

    expect(mockOnQueryChange).toHaveBeenCalledWith("test song");
    expect(mockOnSuggestionSelect).toHaveBeenCalledWith("test song");
  });

  it("navigates suggestions with arrow keys", async () => {
    render(() => (
      <SearchBox
        query="test"
        onQueryChange={mockOnQueryChange}
        onSuggestionSelect={mockOnSuggestionSelect}
        suggestions={["test song 1", "test song 2"]}
        showSuggestions={true}
      />
    ));

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText("test song 1")).toBeInTheDocument();
    });

    // Navigate down
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockOnQueryChange).toHaveBeenCalledWith("test song 1");
    expect(mockOnSuggestionSelect).toHaveBeenCalledWith("test song 1");
  });

  it("shows loading state", () => {
    render(() => (
      <SearchBox
        query="test"
        onQueryChange={mockOnQueryChange}
        suggestionsLoading={true}
      />
    ));

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("can be disabled", () => {
    render(() => (
      <SearchBox
        query="test"
        onQueryChange={mockOnQueryChange}
        disabled={true}
      />
    ));

    const input = screen.getByRole("combobox");
    expect(input).toBeDisabled();
  });
});

describe("SearchResults", () => {
  const mockResults: SearchResult[] = [
    {
      id: "1",
      title: "Song 1",
      description: "Artist 1",
      type: "song",
    },
    {
      id: "2",
      title: "Song 2",
      description: "Artist 2",
      type: "song",
    },
  ];

  let mockOnPageChange: ReturnType<typeof vi.fn>;
  let mockOnResultClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnPageChange = vi.fn();
    mockOnResultClick = vi.fn();
  });

  it("renders results list", () => {
    render(() => (
      <SearchResults
        results={mockResults}
        onPageChange={mockOnPageChange}
        onResultClick={mockOnResultClick}
      />
    ));

    expect(screen.getByText("Song 1")).toBeInTheDocument();
    expect(screen.getByText("Song 2")).toBeInTheDocument();
    expect(screen.getByText("Artist 1")).toBeInTheDocument();
    expect(screen.getByText("Artist 2")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(() => (
      <SearchResults
        results={[]}
        loading={true}
        onPageChange={mockOnPageChange}
      />
    ));

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows error state", () => {
    render(() => (
      <SearchResults
        results={[]}
        error="Search failed"
        onPageChange={mockOnPageChange}
      />
    ));

    expect(screen.getByText("Error: Search failed")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    render(() => (
      <SearchResults
        results={[]}
        onPageChange={mockOnPageChange}
        emptyMessage="No songs found"
      />
    ));

    expect(screen.getByText("No songs found")).toBeInTheDocument();
  });

  it("shows result count", () => {
    render(() => (
      <SearchResults
        results={mockResults}
        totalResults={100}
        currentPage={1}
        resultsPerPage={10}
        showResultCount={true}
        onPageChange={mockOnPageChange}
      />
    ));

    expect(screen.getByText("Showing 1-2 of 100 results")).toBeInTheDocument();
  });

  it("handles result click", async () => {
    render(() => (
      <SearchResults
        results={mockResults}
        onResultClick={mockOnResultClick}
        onPageChange={mockOnPageChange}
      />
    ));

    const result = screen.getByText("Song 1");
    fireEvent.click(result);

    expect(mockOnResultClick).toHaveBeenCalledWith(mockResults[0]);
  });

  it("shows pagination controls", () => {
    render(() => (
      <SearchResults
        results={mockResults}
        currentPage={2}
        totalPages={5}
        showPagination={true}
        onPageChange={mockOnPageChange}
      />
    ));

    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("handles pagination clicks", async () => {
    render(() => (
      <SearchResults
        results={mockResults}
        currentPage={2}
        totalPages={5}
        showPagination={true}
        onPageChange={mockOnPageChange}
      />
    ));

    const nextButton = screen.getByText("Next");
    fireEvent.click(nextButton);

    expect(mockOnPageChange).toHaveBeenCalledWith(3);

    const prevButton = screen.getByText("Previous");
    fireEvent.click(prevButton);

    expect(mockOnPageChange).toHaveBeenCalledWith(1);
  });

  it("renders in grid layout", () => {
    render(() => (
      <SearchResults
        results={mockResults}
        layout="grid"
        onPageChange={mockOnPageChange}
      />
    ));

    const list = screen.getByRole("generic", { name: /search-results__list--grid/i });
    expect(list).toHaveClass("search-results__list--grid");
  });

  it("uses custom result renderer", () => {
    const customRenderer = (result: SearchResult) => (
      <div data-testid="custom-result">Custom: {result.title}</div>
    );

    render(() => (
      <SearchResults
        results={mockResults}
        renderResult={customRenderer}
        onPageChange={mockOnPageChange}
      />
    ));

    expect(screen.getByText("Custom: Song 1")).toBeInTheDocument();
    expect(screen.getByText("Custom: Song 2")).toBeInTheDocument();
  });
});

describe("SearchFilters", () => {
  const mockFilterOptions = {
    genres: [
      { value: "rock", label: "Rock", count: 50 },
      { value: "pop", label: "Pop", count: 30 },
    ],
    artists: [
      { value: "artist1", label: "Artist 1", count: 20 },
      { value: "artist2", label: "Artist 2", count: 15 },
    ],
    types: [
      { value: "song", label: "Song", count: 100 },
      { value: "album", label: "Album", count: 25 },
    ],
  };

  let mockOnFiltersChange: ReturnType<typeof vi.fn>;
  let mockOnClearAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnFiltersChange = vi.fn();
    mockOnClearAll = vi.fn();
  });

  it("renders filter controls", () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
      />
    ));

    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Expand")).toBeInTheDocument();
  });

  it("shows active filter count", () => {
    render(() => (
      <SearchFilters
        filters={{ genre: "rock", artist: "artist1" }}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
      />
    ));

    expect(screen.getByText("(2)")).toBeInTheDocument();
    expect(screen.getByText("Clear All")).toBeInTheDocument();
  });

  it("expands to show filter options", async () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
      />
    ));

    const expandButton = screen.getByText("Expand");
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText("Genre")).toBeInTheDocument();
      expect(screen.getByText("Artist")).toBeInTheDocument();
      expect(screen.getByText("Type")).toBeInTheDocument();
    });
  });

  it("handles filter changes", async () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
      />
    ));

    // Expand filters
    const expandButton = screen.getByText("Expand");
    fireEvent.click(expandButton);

    await waitFor(() => {
      const genreSelect = screen.getByDisplayValue("All Genres");
      fireEvent.change(genreSelect, { target: { value: "rock" } });
    });

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ genre: "rock" });
  });

  it("handles text input filters", async () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
      />
    ));

    // Expand filters
    const expandButton = screen.getByText("Expand");
    fireEvent.click(expandButton);

    await waitFor(() => {
      const queryInput = screen.getByPlaceholderText("Search terms...");
      fireEvent.input(queryInput, { target: { value: "test query" } });
    });

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ query: "test query" });
  });

  it("handles range filters", async () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
      />
    ));

    // Expand filters
    const expandButton = screen.getByText("Expand");
    fireEvent.click(expandButton);

    await waitFor(() => {
      const yearFromInput = screen.getByPlaceholderText("From");
      fireEvent.input(yearFromInput, { target: { value: "2020" } });
    });

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ yearFrom: "2020" });
  });

  it("handles checkbox filters", async () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
      />
    ));

    // Expand filters
    const expandButton = screen.getByText("Expand");
    fireEvent.click(expandButton);

    await waitFor(() => {
      const songCheckbox = screen.getByLabelText(/Song/);
      fireEvent.click(songCheckbox);
    });

    expect(mockOnFiltersChange).toHaveBeenCalledWith({ types: ["song"] });
  });

  it("handles clear all filters", async () => {
    render(() => (
      <SearchFilters
        filters={{ genre: "rock", artist: "artist1" }}
        onFiltersChange={mockOnFiltersChange}
        onClearAll={mockOnClearAll}
        filterOptions={mockFilterOptions}
      />
    ));

    const clearAllButton = screen.getByText("Clear All");
    fireEvent.click(clearAllButton);

    expect(mockOnClearAll).toHaveBeenCalled();
    expect(mockOnFiltersChange).toHaveBeenCalledWith({});
  });

  it("shows filter option counts", async () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        filterOptions={mockFilterOptions}
        showCounts={true}
      />
    ));

    // Expand filters
    const expandButton = screen.getByText("Expand");
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText("(50)")).toBeInTheDocument(); // Rock count
      expect(screen.getByText("(30)")).toBeInTheDocument(); // Pop count
    });
  });

  it("shows loading state", () => {
    render(() => (
      <SearchFilters
        filters={{}}
        onFiltersChange={mockOnFiltersChange}
        loading={true}
      />
    ));

    expect(screen.getByText("Loading filters...")).toBeInTheDocument();
  });
});

describe("SearchProvider", () => {
  it("provides search context to children", () => {
    const TestComponent = () => {
      const context = useSearchContext();
      return <div data-testid="context-test">{context ? "Context available" : "No context"}</div>;
    };

    render(() => (
      <SearchProvider apiClient={mockApiClient}>
        <TestComponent />
      </SearchProvider>
    ));

    expect(screen.getByTestId("context-test")).toHaveTextContent("Context available");
  });

  it("throws error when useSearchContext is used outside provider", () => {
    const TestComponent = () => {
      try {
        useSearchContext();
        return <div>Should not render</div>;
      } catch (error) {
        return <div data-testid="error">{(error as Error).message}</div>;
      }
    };

    render(() => <TestComponent />);

    expect(screen.getByTestId("error")).toHaveTextContent(
      "useSearchContext must be used within a SearchProvider"
    );
  });
});

describe("Integration Tests", () => {
  it("components work together", async () => {
    const TestSearchApp = () => {
      const [query, setQuery] = createSignal("");
      const [filters, setFilters] = createSignal({});
      const [results, setResults] = createSignal<SearchResult[]>([]);

      const handleSearch = async (searchQuery: string) => {
        // Simulate search
        setResults([
          {
            id: "1",
            title: `Result for: ${searchQuery}`,
            description: "Test result",
            type: "song",
          },
        ]);
      };

      return (
        <div>
          <SearchBox
            query={query()}
            onQueryChange={setQuery}
            onSearch={handleSearch}
            placeholder="Search..."
          />
          <SearchFilters
            filters={filters()}
            onFiltersChange={setFilters}
          />
          <SearchResults
            results={results()}
            onPageChange={() => {}}
            onResultClick={() => {}}
          />
        </div>
      );
    };

    render(() => <TestSearchApp />);

    // Test search flow
    const searchInput = screen.getByPlaceholderText("Search...");
    fireEvent.input(searchInput, { target: { value: "test song" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Result for: test song")).toBeInTheDocument();
    });
  });
});
