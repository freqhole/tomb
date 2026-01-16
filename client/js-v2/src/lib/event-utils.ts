//! Event utilities for cleaner EventTarget management
//!
//! This module provides utility functions to reduce code duplication
//! in EventTarget cleanup and management across the codebase.

/**
 * Safely remove all event listeners from an EventTarget
 * This replaces the repeated cleanup code found in multiple classes
 */
export function removeAllEventListeners(target: EventTarget): void {
  // Access the internal listeners map (non-standard but widely supported)
  const listeners = (target as any)._listeners;
  if (!listeners) return;

  // Remove all listeners for each event type
  Object.keys(listeners).forEach((eventType) => {
    const eventListeners = listeners[eventType] || [];
    eventListeners.forEach((listener: EventListener) => {
      target.removeEventListener(eventType, listener);
    });
  });
}

/**
 * Create a typed event listener that ensures type safety
 */
export function createTypedEventListener<T = any>(
  callback: (data: T) => void
): EventListener {
  return (event: Event) => {
    const customEvent = event as CustomEvent<T>;
    callback(customEvent.detail);
  };
}

/**
 * Dispatch a typed custom event
 */
export function dispatchTypedEvent<T>(
  target: EventTarget,
  type: string,
  detail: T,
  options?: CustomEventInit
): boolean {
  const event = new CustomEvent(type, {
    detail,
    bubbles: options?.bubbles ?? false,
    cancelable: options?.cancelable ?? false,
    composed: options?.composed ?? false,
  });
  return target.dispatchEvent(event);
}

/**
 * Create a one-time event listener that automatically removes itself
 */
export function createOneTimeListener(
  target: EventTarget,
  eventType: string,
  callback: EventListener
): void {
  const oneTimeListener = (event: Event) => {
    callback(event);
    target.removeEventListener(eventType, oneTimeListener);
  };
  target.addEventListener(eventType, oneTimeListener);
}

/**
 * Create an event listener with automatic cleanup tracking
 * Returns a cleanup function that removes the listener
 */
export function createManagedListener(
  target: EventTarget,
  eventType: string,
  callback: EventListener,
  options?: AddEventListenerOptions
): () => void {
  target.addEventListener(eventType, callback, options);
  return () => target.removeEventListener(eventType, callback);
}

/**
 * Event listener manager for classes that need to track multiple listeners
 */
export class EventListenerManager {
  private cleanupFunctions: (() => void)[] = [];

  /**
   * Add a managed event listener
   */
  addListener(
    target: EventTarget,
    eventType: string,
    callback: EventListener,
    options?: AddEventListenerOptions
  ): void {
    const cleanup = createManagedListener(target, eventType, callback, options);
    this.cleanupFunctions.push(cleanup);
  }

  /**
   * Add a one-time listener
   */
  addOneTimeListener(
    target: EventTarget,
    eventType: string,
    callback: EventListener
  ): void {
    createOneTimeListener(target, eventType, callback);
  }

  /**
   * Add a typed event listener
   */
  addTypedListener<T>(
    target: EventTarget,
    eventType: string,
    callback: (data: T) => void,
    options?: AddEventListenerOptions
  ): void {
    const typedCallback = createTypedEventListener(callback);
    this.addListener(target, eventType, typedCallback, options);
  }

  /**
   * Remove all managed listeners
   */
  removeAll(): void {
    this.cleanupFunctions.forEach((cleanup) => cleanup());
    this.cleanupFunctions = [];
  }

  /**
   * Get the number of managed listeners
   */
  get count(): number {
    return this.cleanupFunctions.length;
  }
}

/**
 * Base class for EventTarget with automatic cleanup management
 */
export abstract class ManagedEventTarget extends EventTarget {
  protected eventManager = new EventListenerManager();

  /**
   * Add a managed event listener to this target
   */
  protected addManagedListener(
    eventType: string,
    callback: EventListener,
    options?: AddEventListenerOptions
  ): void {
    this.eventManager.addListener(this, eventType, callback, options);
  }

  /**
   * Add a managed event listener to an external target
   */
  protected addExternalListener(
    target: EventTarget,
    eventType: string,
    callback: EventListener,
    options?: AddEventListenerOptions
  ): void {
    this.eventManager.addListener(target, eventType, callback, options);
  }

  /**
   * Dispatch a typed event from this target
   */
  protected dispatchTypedEvent<T>(
    type: string,
    detail: T,
    options?: CustomEventInit
  ): boolean {
    return dispatchTypedEvent(this, type, detail, options);
  }

  /**
   * Cleanup all managed listeners - call this in destroy() methods
   */
  protected cleanup(): void {
    this.eventManager.removeAll();
  }

  /**
   * Abstract destroy method that subclasses should implement
   */
  abstract destroy(): void;
}
