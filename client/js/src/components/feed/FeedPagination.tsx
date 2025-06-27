/**
 * Feed Pagination Component
 *
 * A reusable pagination component for media blob feeds.
 * Supports load more, page navigation, and page size controls.
 */

/* @jsxImportSource solid-js */
import { Show, createMemo } from "solid-js";

export interface FeedPaginationProps {
  currentPage: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  mode?: "loadMore" | "pages" | "both";
  onLoadMore?: () => void;
  onLoadPage?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  showPageSizeSelector?: boolean;
  showStats?: boolean;
  className?: string;
}

export function FeedPaginationComponent(props: FeedPaginationProps) {
  const mode = () => props.mode || "both";
  const showLoadMore = () => mode() === "loadMore" || mode() === "both";
  const showPages = () => mode() === "pages" || mode() === "both";

  // Calculate pagination stats
  const totalPages = createMemo(() =>
    Math.ceil(props.totalCount / props.pageSize)
  );

  const startItem = createMemo(() => props.currentPage * props.pageSize + 1);

  const endItem = createMemo(() =>
    Math.min((props.currentPage + 1) * props.pageSize, props.totalCount)
  );

  // Generate page numbers for pagination controls
  const visiblePages = createMemo(() => {
    const current = props.currentPage;
    const total = totalPages();
    const maxVisible = 7;

    if (total <= maxVisible) {
      return Array.from({ length: total }, (_, i) => i);
    }

    const start = Math.max(0, current - 3);
    const end = Math.min(total - 1, start + maxVisible - 1);
    const adjustedStart = Math.max(0, end - maxVisible + 1);

    return Array.from(
      { length: end - adjustedStart + 1 },
      (_, i) => adjustedStart + i
    );
  });

  const handleLoadMore = () => {
    if (props.onLoadMore && props.hasMore && !props.isLoadingMore) {
      props.onLoadMore();
    }
  };

  const handlePageChange = (page: number) => {
    if (props.onLoadPage && page !== props.currentPage && !props.isLoading) {
      props.onLoadPage(page);
    }
  };

  const handlePageSizeChange = (size: number) => {
    if (props.onPageSizeChange && size !== props.pageSize) {
      props.onPageSizeChange(size);
    }
  };

  const containerStyles = () => ({
    display: "flex",
    "flex-direction": "column" as const,
    gap: "12px",
    padding: "12px",
    "background-color": "#f8fafc",
    border: "1px solid #e2e8f0",
    "border-radius": "8px",
    "font-size": "14px",
  });

  const sectionStyles = () => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "space-between",
    gap: "12px",
    "flex-wrap": "wrap" as const,
  });

  const buttonStyles = (disabled = false, active = false) => ({
    padding: "6px 12px",
    border: "1px solid #d1d5db",
    "border-radius": "6px",
    "background-color": active ? "#3b82f6" : disabled ? "#f3f4f6" : "#ffffff",
    color: active ? "#ffffff" : disabled ? "#9ca3af" : "#374151",
    cursor: disabled ? "not-allowed" : "pointer",
    "font-size": "13px",
    "font-weight": "500",
    transition: "all 0.2s ease",
    "min-width": "36px",
    "text-align": "center" as const,
  });

  const loadMoreButtonStyles = () => ({
    ...buttonStyles(props.isLoadingMore || !props.hasMore),
    padding: "8px 16px",
    "background-color":
      props.hasMore && !props.isLoadingMore ? "#10b981" : "#f3f4f6",
    color: props.hasMore && !props.isLoadingMore ? "#ffffff" : "#9ca3af",
    "font-weight": "600",
  });

  const statsStyles = () => ({
    "font-size": "12px",
    color: "#64748b",
    "font-weight": "500",
  });

  const selectStyles = () => ({
    padding: "4px 8px",
    border: "1px solid #d1d5db",
    "border-radius": "4px",
    "background-color": "#ffffff",
    "font-size": "12px",
    cursor: "pointer",
  });

  // Add CSS animation for spinner
  const spinKeyframes = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;

  return (
    <div class={props.className} style={containerStyles()}>
      <style>{spinKeyframes}</style>
      {/* Stats and Page Size Selector */}
      <Show when={props.showStats || props.showPageSizeSelector}>
        <div style={sectionStyles()}>
          <Show when={props.showStats}>
            <div style={statsStyles()}>
              <Show
                when={props.totalCount > 0}
                fallback={<span>No items</span>}
              >
                <Show
                  when={mode() === "loadMore"}
                  fallback={
                    <span>
                      Showing {startItem()}-{endItem()} of {props.totalCount}{" "}
                      items
                      {totalPages() > 1 &&
                        ` (Page ${props.currentPage + 1} of ${totalPages()})`}
                    </span>
                  }
                >
                  <span>
                    Loaded {endItem()} of {props.totalCount} items
                    {props.hasMore && " (more available)"}
                  </span>
                </Show>
              </Show>
            </div>
          </Show>

          <Show when={props.showPageSizeSelector}>
            <div
              style={{ display: "flex", "align-items": "center", gap: "6px" }}
            >
              <span style={{ "font-size": "12px", color: "#64748b" }}>
                Per page:
              </span>
              <select
                style={selectStyles()}
                value={props.pageSize}
                onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </Show>
        </div>
      </Show>

      {/* Load More Button */}
      <Show when={showLoadMore() && props.totalCount > 0}>
        <div style={{ display: "flex", "justify-content": "center" }}>
          <button
            style={loadMoreButtonStyles()}
            onClick={handleLoadMore}
            disabled={props.isLoadingMore || !props.hasMore}
          >
            <Show
              when={props.isLoadingMore}
              fallback={
                <Show when={props.hasMore} fallback="No more items">
                  Load More ({props.totalCount - endItem()} remaining)
                </Show>
              }
            >
              Loading...
            </Show>
          </button>
        </div>
      </Show>

      {/* Page Navigation */}
      <Show when={showPages() && totalPages() > 1}>
        <div
          style={{
            display: "flex",
            "justify-content": "center",
            gap: "4px",
            "flex-wrap": "wrap",
          }}
        >
          {/* Previous button */}
          <button
            style={buttonStyles(props.currentPage === 0 || props.isLoading)}
            onClick={() => handlePageChange(props.currentPage - 1)}
            disabled={props.currentPage === 0 || props.isLoading}
          >
            ‹
          </button>

          {/* First page if not visible */}
          <Show when={visiblePages().length > 0 && visiblePages()[0]! > 0}>
            <button
              style={buttonStyles(props.isLoading)}
              onClick={() => handlePageChange(0)}
              disabled={props.isLoading}
            >
              1
            </button>
            <Show when={visiblePages().length > 0 && visiblePages()[0]! > 1}>
              <span style={{ padding: "6px 4px", color: "#9ca3af" }}>…</span>
            </Show>
          </Show>

          {/* Visible page numbers */}
          {visiblePages().map((page) => (
            <button
              style={buttonStyles(props.isLoading, page === props.currentPage)}
              onClick={() => handlePageChange(page)}
              disabled={props.isLoading}
            >
              {page + 1}
            </button>
          ))}

          {/* Last page if not visible */}
          <Show
            when={
              visiblePages().length > 0 &&
              visiblePages()[visiblePages().length - 1]! < totalPages() - 1
            }
          >
            <Show
              when={
                visiblePages().length > 0 &&
                visiblePages()[visiblePages().length - 1]! < totalPages() - 2
              }
            >
              <span style={{ padding: "6px 4px", color: "#9ca3af" }}>…</span>
            </Show>
            <button
              style={buttonStyles(props.isLoading)}
              onClick={() => handlePageChange(totalPages() - 1)}
              disabled={props.isLoading}
            >
              {totalPages()}
            </button>
          </Show>

          {/* Next button */}
          <button
            style={buttonStyles(
              props.currentPage >= totalPages() - 1 || props.isLoading
            )}
            onClick={() => handlePageChange(props.currentPage + 1)}
            disabled={props.currentPage >= totalPages() - 1 || props.isLoading}
          >
            ›
          </button>
        </div>
      </Show>

      {/* Loading indicator */}
      <Show when={props.isLoading}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            gap: "8px",
            padding: "8px",
            color: "#64748b",
            "font-size": "12px",
          }}
        >
          <div
            style={{
              width: "16px",
              height: "16px",
              border: "2px solid #e2e8f0",
              "border-top": "2px solid #3b82f6",
              "border-radius": "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <span>Loading page...</span>
        </div>
      </Show>
    </div>
  );
}

export default FeedPaginationComponent;
