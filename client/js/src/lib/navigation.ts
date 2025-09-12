import { useNavigate as useSolidNavigate } from "@solidjs/router";

/**
 * Safe navigation helper that ensures hash router compatibility
 * This prevents the routing issues where hash gets stripped during navigation
 */
export function useSafeNavigate() {
  const navigate = useSolidNavigate();

  return (path: string, options?: { replace?: boolean }) => {
    // Always ensure we're using relative paths for hash router
    // The hash router will automatically handle the # prefix
    const cleanPath = path.startsWith("/") ? path : `/${path}`;

    navigate(cleanPath, options);
  };
}

/**
 * Safe navigation function for use outside components
 * Preserves history state for scroll restoration
 */
export function safeNavigate(path: string, options?: { replace?: boolean }) {
  // Always ensure we're using relative paths for hash router
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  // Preserve existing history state when navigating
  const currentState = history.state || {};

  // For hash routing, we should use window.location.hash directly
  // This prevents the routing issues with history.pushState
  if (options?.replace) {
    window.location.hash = cleanPath;
    // Restore the preserved state after hash navigation
    if (Object.keys(currentState).length > 0) {
      setTimeout(() => {
        history.replaceState(currentState, "");
      }, 0);
    }
  } else {
    window.location.hash = cleanPath;
    // Restore the preserved state after hash navigation
    if (Object.keys(currentState).length > 0) {
      setTimeout(() => {
        history.replaceState(currentState, "");
      }, 0);
    }
  }
}

/**
 * Utility to ensure scroll restoration doesn't break hash routing
 */
export function saveScrollStateSecurely(key: string, scrollState: any) {
  const currentState = history.state || {};
  const newState = {
    ...currentState,
    [key]: scrollState,
  };

  // CRITICAL: Don't pass URL parameter to preserve hash routing
  // This was the main cause of routing issues
  history.replaceState(newState, "");
}

/**
 * Debug utility to check if hash routing is working correctly
 */
export function checkHashRouting() {
  const hasHash = window.location.hash.length > 0;
  const hasPath = window.location.pathname !== "/";

  if (hasPath && !hasHash) {
    console.warn(
      "Hash routing issue detected:",
      "pathname =",
      window.location.pathname,
      "hash =",
      window.location.hash,
      "This usually means navigation bypassed the hash router"
    );
  }

  return { hasHash, hasPath, isCorrect: !hasPath || hasHash };
}
