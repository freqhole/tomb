import { createSignal } from "solid-js";

export interface LongPressConfig {
  delay?: number; // milliseconds to wait before triggering long press
  moveThreshold?: number; // max pixels user can move before canceling
}

export interface LongPressHandlers {
  onLongPress: (event: { clientX: number; clientY: number }) => void;
  onTap?: () => void;
}

export function useLongPress(
  handlers: LongPressHandlers,
  config: LongPressConfig = {}
) {
  const { delay = 500, moveThreshold = 10 } = config;

  const [touchStart, setTouchStart] = createSignal<{
    x: number;
    y: number;
    time: number;
    element: HTMLElement;
  } | null>(null);

  const [longPressTimer, setLongPressTimer] = createSignal<number | null>(null);
  const [hasTriggeredLongPress, setHasTriggeredLongPress] = createSignal(false);

  // Temporarily apply styles to prevent text selection
  const applyPreventSelectionStyles = (element: HTMLElement) => {
    const style = element.style as any; // Cast to handle WebKit properties
    const originalStyles = {
      userSelect: style.userSelect,
      webkitUserSelect: style.webkitUserSelect,
      webkitTouchCallout: style.webkitTouchCallout,
      webkitTapHighlightColor: style.webkitTapHighlightColor,
    };

    style.userSelect = "none";
    style.webkitUserSelect = "none";
    style.webkitTouchCallout = "none";
    style.webkitTapHighlightColor = "transparent";

    return () => {
      // Restore original styles
      style.userSelect = originalStyles.userSelect;
      style.webkitUserSelect = originalStyles.webkitUserSelect;
      style.webkitTouchCallout = originalStyles.webkitTouchCallout;
      style.webkitTapHighlightColor = originalStyles.webkitTapHighlightColor;
    };
  };

  const clearTimer = () => {
    const timer = longPressTimer();
    if (timer) {
      clearTimeout(timer);
      setLongPressTimer(null);
    }
  };

  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) {
      return;
    }

    const element = e.currentTarget as HTMLElement;

    // Clear any existing timer
    clearTimer();
    setHasTriggeredLongPress(false);

    // Apply prevention styles IMMEDIATELY to prevent text selection
    const restoreStyles = applyPreventSelectionStyles(element);

    // Record touch start with restore function
    setTouchStart({
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      element,
    });

    // Set long press timer
    const timer = window.setTimeout(() => {
      setHasTriggeredLongPress(true);
      handlers.onLongPress({
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
      setLongPressTimer(null);

      // Restore styles after long press triggers
      const restoreStyles = (element as any)._longPressRestore;
      if (restoreStyles) {
        restoreStyles();
        delete (element as any)._longPressRestore;
      }
    }, delay);

    setLongPressTimer(timer);

    // Store restore function to call it in touchend/touchcancel
    (element as any)._longPressRestore = restoreStyles;
  };

  const handleTouchMove = (e: TouchEvent) => {
    const start = touchStart();
    if (!start) return;

    const touch = e.touches[0];
    if (!touch) return;

    // Calculate movement distance
    const distance = Math.sqrt(
      Math.pow(touch.clientX - start.x, 2) +
        Math.pow(touch.clientY - start.y, 2)
    );

    // If user moves too much, cancel long press and restore styles
    if (distance > moveThreshold) {
      clearTimer();
      const element = e.currentTarget as HTMLElement;
      const restoreStyles = (element as any)._longPressRestore;
      if (restoreStyles) {
        restoreStyles();
        delete (element as any)._longPressRestore;
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    const start = touchStart();
    if (!start) {
      return;
    }

    // Clear timer
    clearTimer();

    // Always restore styles on touch end
    const element = e.currentTarget as HTMLElement;
    const restoreStyles = (element as any)._longPressRestore;
    if (restoreStyles) {
      restoreStyles();
      delete (element as any)._longPressRestore;
    }

    // If long press was triggered, don't handle as tap
    if (hasTriggeredLongPress()) {
      setTouchStart(null);
      setHasTriggeredLongPress(false);
      return;
    }

    const touch = e.changedTouches[0];
    if (!touch) {
      return;
    }

    // Check if this was a quick tap
    const duration = Date.now() - start.time;
    const distance = Math.sqrt(
      Math.pow(touch.clientX - start.x, 2) +
        Math.pow(touch.clientY - start.y, 2)
    );

    // If it was a quick tap with minimal movement, trigger tap handler
    if (duration < delay && distance < moveThreshold && handlers.onTap) {
      handlers.onTap();
    }

    setTouchStart(null);
    setHasTriggeredLongPress(false);
  };

  const handleTouchCancel = (e: TouchEvent) => {
    clearTimer();

    // Restore styles on cancel
    const element = e.currentTarget as HTMLElement;
    const restoreStyles = (element as any)._longPressRestore;
    if (restoreStyles) {
      restoreStyles();
      delete (element as any)._longPressRestore;
    }

    setTouchStart(null);
    setHasTriggeredLongPress(false);
  };

  // Return event handlers to be attached to elements
  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchCancel,
  };
}
