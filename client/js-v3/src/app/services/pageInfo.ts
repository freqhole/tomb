// page info store - used by views to communicate title/count to TopNav on mobile
import { createSignal } from "solid-js";

export interface PageInfo {
  /** page title (e.g. "songs", "artists") */
  title?: string;
  /** item count to display with title */
  count?: number;
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
