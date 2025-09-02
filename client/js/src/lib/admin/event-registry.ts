/**
 * simplified event registry system
 *
 * works with natural DOM bubbling/propagation rather than fighting against it.
 * this registry is just for cleanup tracking - no complex enable/disable logic.
 */

export interface EventRegistryListener {
  element: HTMLElement | Document;
  type: string;
  handler: (event: Event) => void;
  options?: AddEventListenerOptions;
}

/**
 * simple event registry for cleanup management
 *
 * key principles:
 * - child elements naturally get events first (bubbling)
 * - use event.stopPropagation() selectively when you want to prevent parent handlers
 * - register at appropriate DOM levels (document for global, specific elements for targeted)
 * - text inputs automatically get priority due to being focused child elements
 */
export class EventRegistry {
  private listeners: EventRegistryListener[] = [];

  /**
   * register an event listener and track it for cleanup
   */
  register(
    element: HTMLElement | Document,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions
  ): void {
    element.addEventListener(type, handler, options);
    this.listeners.push({ element, type, handler, options });
  }

  /**
   * clean up all registered event listeners
   */
  cleanup(): void {
    this.listeners.forEach(({ element, type, handler, options }) => {
      element.removeEventListener(type, handler, options);
    });
    this.listeners = [];
  }

  /**
   * get the number of registered listeners (for debugging)
   */
  getListenerCount(): number {
    return this.listeners.length;
  }
}

/**
 * global event registry instance for admin interface
 */
export const globalEventRegistry = new EventRegistry();

/**
 * helper function to check if an event target is a text input
 */
export function isTextInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  return target.matches('input, textarea, [contenteditable="true"]');
}

/**
 * helper function to create keyboard shortcut handlers
 */
export function createKeyboardHandler(
  shortcuts: Record<string, (event: KeyboardEvent) => void>
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    // build key combination string
    const modifiers = [];
    if (event.ctrlKey || event.metaKey) modifiers.push("ctrl");
    if (event.shiftKey) modifiers.push("shift");
    if (event.altKey) modifiers.push("alt");

    const key = event.key.toLowerCase();
    const combination =
      modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key;

    const handler = shortcuts[combination];
    if (handler) {
      handler(event);
    }
  };
}

/**
 * helper function to safely handle events that should only work outside text inputs
 */
export function createGlobalKeyboardHandler(
  shortcuts: Record<string, (event: KeyboardEvent) => void>
): (event: KeyboardEvent) => void {
  const keyboardHandler = createKeyboardHandler(shortcuts);

  return (event: KeyboardEvent) => {
    // don't handle shortcuts when user is typing in text inputs
    if (isTextInput(event.target)) {
      return;
    }

    keyboardHandler(event);
  };
}

/**
 * utility class for managing event registration in SolidJS components
 */
export class ComponentEventRegistry extends EventRegistry {
  /**
   * register events that should be cleaned up when component unmounts
   * use this in onCleanup() calls
   */
  registerForCleanup(
    element: HTMLElement | Document,
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions
  ): void {
    this.register(element, type, handler, options);
  }

  /**
   * create a scoped keyboard handler for this component
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
