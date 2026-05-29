// page info store - used by views to communicate title/count/controls to TopNav
import { createSignal } from "solid-js";
import type { SortField } from "../../components/controls/SearchSortControls";
import type { TagFilter, TagOption } from "../../components/forms/TagFilterPicker";

// feed type filter option
export interface FeedTypeOption {
  /** feed type value (e.g. "recent_listen") */
  value: string;
  /** human-readable label (e.g. "listens") */
  label: string;
}

// a selected feed type filter with include/exclude mode
export interface FeedTypeFilter {
  type: string;
  mode: "include" | "exclude";
}

// generic status filter option (used by the library/table view's
// `mb_lookup_status` picker — surfaced in the topnav alongside the tag
// + feed-type pickers for ui consistency).
export interface StatusFilterOption {
  /** raw status value (e.g. "needs_review") */
  value: string;
  /** human-readable label (e.g. "needs review") */
  label: string;
  /** optional count to show inline in the dropdown */
  count?: number;
}

// a selected status filter with include/exclude mode
export interface StatusFilter {
  value: string;
  mode: "include" | "exclude";
}

export interface PageInfo {
  /** page title (e.g. "songs", "artists") */
  title?: string;
  /** item count to display with title */
  count?: number;

  // sort controls (optional - only views with sorting)
  sortFields?: SortField[];
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  defaultSortBy?: string;
  defaultSortDirection?: "asc" | "desc";
  onSortChange?: (field: string, direction: "asc" | "desc") => void;

  // tag filter controls (optional - only views with tags)
  availableTags?: TagOption[];
  selectedTagFilters?: TagFilter[];
  tagsLoading?: boolean;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  onToggleTagMode?: (tag: string) => void;
  onClearAllTags?: () => void;

  // feed type filter controls (optional - only feed view)
  feedTypeOptions?: FeedTypeOption[];
  selectedFeedTypes?: FeedTypeFilter[];
  onToggleFeedType?: (type: string) => void;
  onToggleFeedTypeMode?: (type: string) => void;
  onRemoveFeedType?: (type: string) => void;
  onClearFeedTypes?: () => void;
  myItemsOnly?: boolean;
  onToggleMyItems?: () => void;

  // status filter controls (optional - library/table view). mirrors the
  // tag-filter shape: each entry is include/exclude, the dropdown lets
  // the user add new statuses, badges below the nav let them flip
  // mode or remove. icon-button label is configurable via
  // `statusFilterLabel` so other views could reuse this slot.
  statusFilterOptions?: StatusFilterOption[];
  selectedStatusFilters?: StatusFilter[];
  statusFilterLabel?: string;
  onAddStatusFilter?: (value: string) => void;
  onRemoveStatusFilter?: (value: string) => void;
  onToggleStatusFilterMode?: (value: string) => void;
  onClearStatusFilters?: () => void;

  // back-to-top control (optional - views with long scroll)
  showBackToTop?: boolean;
  onBackToTop?: () => void;
}

// singleton signals for page info
const [pageInfo, setPageInfoInternal] = createSignal<PageInfo>({});

/**
 * get the current page info (reactive)
 */
export function getPageInfo() {
  return pageInfo();
}

/**
 * set the current page info - call from view components to update TopNav
 * @param info - page title and optional count
 */
export function setPageInfo(info: PageInfo) {
  setPageInfoInternal(info);
}

/**
 * clear page info - call when leaving a view
 */
export function clearPageInfo() {
  setPageInfoInternal({});
}
