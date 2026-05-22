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

/** read-only accessors — consumed by AppLayout's TopNav. */
export const topNavRightContent: Accessor<JSX.Element | undefined> = rightContent;
export const topNavSecondaryRowContent: Accessor<JSX.Element | undefined> = secondaryRowContent;

export interface UseTopNavSlotsApi {
  setRightContent(node: JSX.Element | undefined): void;
  setSecondaryRowContent(node: JSX.Element | undefined): void;
}

/**
 * hook for views that want to push content into the topnav. each call
 * registers cleanup that clears the slot on unmount so we don't leak
 * stale dom when the view tears down.
 */
export function useTopNavSlots(): UseTopNavSlotsApi {
  let ownsRight = false;
  let ownsSecondary = false;

  onCleanup(() => {
    if (ownsRight) setRightContentInternal(undefined);
    if (ownsSecondary) setSecondaryRowContentInternal(undefined);
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
  };
}
