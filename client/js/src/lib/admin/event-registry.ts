/**
 * Simplified Event Registry System
 *
 * Works with natural DOM bubbling/propagation rather than fighting against it.
 * This registry is just for cleanup tracking - no complex enable/disable logic.
 */

export interface EventRegistryListener {
  element: HTMLElement | Document;
  type: string;
  handler: (event: Event) => void;
  options?: AddEventListenerOptions;
}

/**
 * Simple event registry for cleanup management
 *
 * Key principles:
 * - Child elements naturally get events first (bubbling)
 * - Use event.stopPropagation() selectively when you want to prevent parent handlers
 * - Register at appropriate DOM levels (document for global, specific elements for targeted)
 * - Text inputs automatically get priority due to being focused child elements
 */
export class EventRegistry {
  private listeners: EventRegistryListener[] = [];

  /**
   * Register an event listener and track it for cleanup
   */
  register(
    element: HTMLElement | Document,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    element.addEventListener(type, handler, options);
    this.listeners.push({ element, type, handler, options });
  }

  /**
   * Clean up all registered event listeners
   */
  cleanup(): void {
    this.listeners.forEach(({ element, type, handler, options }) => {
      element.removeEventListener(type, handler, options);
    });
    this.listeners = [];
  }

  /**
   * Get the number of registered listeners (for debugging)
   */
  getListenerCount(): number {
    return this.listeners.length;
  }
}

/**
 * Global event registry instance for admin interface
 */
export const globalEventRegistry = new EventRegistry();

/**
 * Helper function to check if an event target is a text input
 */
export function isTextInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  return target.matches('input, textarea, [contenteditable="true"]');
}

/**
 * Helper function to create keyboard shortcut handlers
 */
export function createKeyboardHandler(
  shortcuts: Record<string, (event: KeyboardEvent) => void>
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    // Build key combination string
    const modifiers = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('ctrl');
    if (event.shiftKey) modifiers.push('shift');
    if (event.altKey) modifiers.push('alt');

    const key = event.key.toLowerCase();
    const combination = modifiers.length > 0 ? `${modifiers.join('+')}+${key}` : key;

    const handler = shortcuts[combination];
    if (handler) {
      handler(event);
    }
  };
}

/**
 * Helper function to safely handle events that should only work outside text inputs
 */
export function createGlobalKeyboardHandler(
  shortcuts: Record<string, (event: KeyboardEvent) => void>
): (event: KeyboardEvent) => void {
  const keyboardHandler = createKeyboardHandler(shortcuts);

  return (event: KeyboardEvent) => {
    // Don't handle shortcuts when user is typing in text inputs
    if (isTextInput(event.target)) {
      return;
    }

    keyboardHandler(event);
  };
}

/**
 * Utility class for managing event registration in SolidJS components
 */
export class ComponentEventRegistry extends EventRegistry {
  /**
   * Register events that should be cleaned up when component unmounts
   * Use this in onCleanup() calls
   */
  registerForCleanup(
    element: HTMLElement | Document,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    this.register(element, type, handler, options);
  }

  /**
   * Create a scoped keyboard handler for this component
   */
  createScopedKeyboardHandler(
    shortcuts: Record<string, (event: KeyboardEvent) => void>,
    globalScope = false
  ): (event: KeyboardEvent) => void {
    if (globalScope) {
      return createGlobalKeyboardHandler(shortcuts);
    }
    return createKeyboardHandler(shortcuts);
  }
}
