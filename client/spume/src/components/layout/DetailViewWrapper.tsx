// detail view wrapper - handles common mobile patterns for standalone detail views
import {
  createSignal,
  onCleanup,
  onMount,
  createEffect,
  Show,
  type JSX,
  type ParentProps,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { Icon } from "../icons/registry";

const NARROW_BREAKPOINT = 768;

export interface DetailViewWrapperProps extends ParentProps {
  /** page title for TopNav on narrow (e.g. "album", "artist") */
  pageTitle: string;
  /** optional count for TopNav */
  pageCount?: number;
  /** back navigation - string path to navigate to, or function to call */
  onBack?: string | (() => void);
  /** force show/hide back button (auto-detected from isNarrow if not provided) */
  showBackButton?: boolean;
  /** additional CSS classes for the container */
  class?: string;
}

/**
 * wrapper component for standalone detail views (album, artist, etc.)
 *
 * handles:
 * - narrow breakpoint detection
 * - page info management for TopNav (title + count)
 * - back button rendering on narrow viewports
 * - cleanup on unmount
 *
 * usage:
 * ```tsx
 * <DetailViewWrapper pageTitle="album" onBack="/albums">
 *   {/* detail content *\/}
 * </DetailViewWrapper>
 * ```
 */
export function DetailViewWrapper(props: DetailViewWrapperProps) {
  const navigate = useNavigate();

  // narrow viewport detection
  const [isNarrow, setIsNarrow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false
  );

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearPageInfo();
    });
  });

  // update page info for TopNav
  createEffect(() => {
    setPageInfo({
      title: props.pageTitle,
      count: props.pageCount,
    });
  });

  // handle back navigation
  const handleBack = () => {
    if (typeof props.onBack === "string") {
      navigate(props.onBack);
    } else if (typeof props.onBack === "function") {
      props.onBack();
    } else {
      // default: go back in history
      navigate(-1);
    }
  };

  // determine if back button should show
  const shouldShowBackButton = () => {
    if (props.showBackButton !== undefined) {
      return props.showBackButton;
    }
    // auto: show on narrow viewports
    return isNarrow();
  };

  return (
    <div class={`flex flex-col h-full ${props.class || ""}`}>
      {/* main content */}
      <div class="flex-1 overflow-hidden">{props.children}</div>
    </div>
  );
}

/**
 * hook to get narrow state and page info setup
 * use this when you need more control than DetailViewWrapper provides
 */
export function useDetailViewSetup(options: {
  pageTitle: string;
  getCount?: () => number | undefined;
}) {
  const [isNarrow, setIsNarrow] = createSignal(
    typeof window !== "undefined" ? window.innerWidth < NARROW_BREAKPOINT : false
  );

  onMount(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      clearPageInfo();
    });
  });

  // update page info for TopNav
  createEffect(() => {
    setPageInfo({
      title: options.pageTitle,
      count: options.getCount?.(),
    });
  });

  return { isNarrow };
}
