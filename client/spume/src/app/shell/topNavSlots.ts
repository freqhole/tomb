// topNavSlots
//
// global slot store for content that subviews (e.g. the album graph)
// want to inject into the app shell's TopNav. one writer at a time per
// slot; the writer takes ownership via `useTopNavSlots()` which wires
// onCleanup to clear its slot when the view unmounts.
//
// AppLayout reads the accessors and forwards them into TopNav's
// `rightContent` / `secondaryRowContent` props.

import { createSignal, onCleanup } from "solid-js";
import type { JSX, Accessor } from "solid-js";

const [rightContent, setRightContentInternal] = createSignal<JSX.Element | undefined>(undefined);
const [secondaryRowContent, setSecondaryRowContentInternal] = createSignal<
  JSX.Element | undefined
>(undefined);
const [searchContent, setSearchContentInternal] = createSignal<JSX.Element | undefined>(undefined);
const [hideSearch, setHideSearchInternal] = createSignal<boolean>(false);
// when a custom searchComponent is mounted (via setSearchContent), it
// can publish its expanded/collapsed state here so TopNav's
// "hide other buttons on narrow when search is expanded" logic still
// works. the built-in TopNavSearchContainer wires its own signal
// directly inside TopNav and ignores this one.
const [searchExpanded, setSearchExpandedInternal] = createSignal<boolean>(false);

/** read-only accessors — consumed by AppLayout's TopNav. */
export const topNavRightContent: Accessor<JSX.Element | undefined> = rightContent;
export const topNavSecondaryRowContent: Accessor<JSX.Element | undefined> = secondaryRowContent;
/** custom search component injected by a subview. when set, AppLayout
 *  forwards it as `TopNav.searchComponent`, replacing the default
 *  `TopNavSearchContainer`. used by the library graph viz to mount a
 *  cross-remote search container while still inside the graph view. */
export const topNavSearchContent: Accessor<JSX.Element | undefined> = searchContent;
/** when true, AppLayout asks TopNav to suppress the search input. used
 *  by views (e.g. library graph viz) where the search has no meaning. */
export const topNavHideSearch: Accessor<boolean> = hideSearch;
/** mirror of the custom search component's expanded/collapsed state.
 *  TopNav ORs this with its internal default-search expansion when
 *  deciding whether to hide neighbouring icon buttons on narrow
 *  viewports. */
export const topNavSearchExpanded: Accessor<boolean> = searchExpanded;

export interface UseTopNavSlotsApi {
  setRightContent(node: JSX.Element | undefined): void;
  setSecondaryRowContent(node: JSX.Element | undefined): void;
  setSearchContent(node: JSX.Element | undefined): void;
  setHideSearch(hide: boolean): void;
  /** publish the expansion state of the custom search component (if any)
   *  so TopNav can collapse neighbouring icon buttons on narrow screens.
   *  no-op when the view doesn't supply a custom search. */
  setSearchExpanded(expanded: boolean): void;
}

/**
 * hook for views that want to push content into the topnav. each call
 * registers cleanup that clears the slot on unmount so we don't leak
 * stale dom when the view tears down.
 */
export function useTopNavSlots(): UseTopNavSlotsApi {
  let ownsRight = false;
  let ownsSecondary = false;
  let ownsSearch = false;
  let ownsHideSearch = false;
  let ownsSearchExpanded = false;

  onCleanup(() => {
    if (ownsRight) setRightContentInternal(undefined);
    if (ownsSecondary) setSecondaryRowContentInternal(undefined);
    if (ownsSearch) setSearchContentInternal(undefined);
    if (ownsHideSearch) setHideSearchInternal(false);
    if (ownsSearchExpanded) setSearchExpandedInternal(false);
  });

  return {
    setRightContent(node) {
      ownsRight = true;
      setRightContentInternal(node);
    },
    setSecondaryRowContent(node) {
      ownsSecondary = true;
      setSecondaryRowContentInternal(node);
    },
    setSearchContent(node) {
      ownsSearch = true;
      setSearchContentInternal(node);
    },
    setHideSearch(hide) {
      ownsHideSearch = true;
      setHideSearchInternal(hide);
    },
    setSearchExpanded(expanded) {
      ownsSearchExpanded = true;
      setSearchExpandedInternal(expanded);
    },
  };
}
