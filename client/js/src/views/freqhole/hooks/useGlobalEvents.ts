import { onCleanup } from "solid-js";

// Global event bus instance
const eventBus = new EventTarget();

// Event type definitions
export interface FreqholeEvents {
  // Song events
  "song:play": { song: any; replaceQueue?: boolean };
  "song:queue": { song: any };
  "song:favorite": { song: any };
  "song:unfavorite": { song: any };
  "song:rating-updated": { songId: string; rating: number };

  // Queue events
  "queue:add": { song: any };
  "queue:remove": { index: number };
  "queue:clear": {};
  "queue:toggle": {};
  "queue:reorder": { oldIndex: number; newIndex: number };
  "queue:replace": { songs: any[] };
  "queue:next": {};
  "queue:previous": {};

  // Player events
  "player:play": {};
  "player:pause": {};
  "player:stop": {};
  "player:seek": { time: number };
  "player:volume": { volume: number };
  "player:shuffle": { enabled: boolean };
  "player:repeat": { mode: "none" | "one" | "all" };

  // Navigation events
  "nav:change": { view: string };
  "artist:selected": { artist: any };
  "album:selected": { album: any };
  "playlist:selected": { playlist: any };

  // Playlist events
  "playlist:create": { name: string; description?: string; songs?: any[] };
  "playlist:update": { id: string; updates: any };
  "playlist:delete": { id: string };
  "playlist:add-songs": { playlistId: string; songs: any[] };
  "playlist:remove-songs": { playlistId: string; songIds: string[] };

  // New playlist operation events
  "playlist:created": { playlist: any };
  "playlist:deleted": { playlistId: string; playlistTitle: string };
  "playlist:song-removed": {
    playlistId: string;
    songId: string;
    updatedPlaylist: any;
  };
  "playlist:song-added": {
    playlistId: string;
    songCount: number;
  };

  // Search events
  "search:query": { query: string };
  "search:clear": {};
  "search:results": { results: any };

  // UI events
  "modal:open": { modal: string; data?: any };
  "modal:close": { modal: string };
  "musicbrainz-modal:open": { songs: any[] };
  "musicbrainz-modal:close": {};
  "context-menu:open": { x: number; y: number; actions: any[] };
  "context-menu:close": {};
  "playlist-selector:open": { x: number; y: number; songs: any[] };
  "playlist-selector:close": {};
  "tag-selector:open": {
    x: number;
    y: number;
    songs: any[];
    mode?: "view" | "manage";
  };
  "tag-selector:close": {};
  "selection:clear": {};
  "notification:show": {
    message: string;
    type?: "info" | "success" | "warning" | "error";
  };
  "notification:hide": { id: string };

  // Auth events
  "auth:login": { user: any; token: string };
  "auth:logout": {};
  "auth:token-refresh": { token: string };

  // Data events
  "data:reload": { type: "songs" | "artists" | "albums" | "playlists" };
  "data:error": { error: string; type?: string };
  "songs:updated": { songs: any[]; operation: "bulk-update" | "single-update" };
}

export type EventName = keyof FreqholeEvents;
export type EventData<T extends EventName> = FreqholeEvents[T];

/**
 * Global events hook for cross-component communication
 *
 * @example
 * const events = useGlobalEvents();
 *
 * // Emit an event
 * events.emit("song:play", { song: songData });
 *
 * // Listen for events
 * events.on("song:play", (data) => {
 *   console.log("Playing song:", data.song);
 * });
 */
export function useGlobalEvents() {
  const emit = <T extends EventName>(eventName: T, data: EventData<T>) => {
    const event = new CustomEvent(eventName, { detail: data });
    eventBus.dispatchEvent(event);
  };

  const on = <T extends EventName>(
    eventName: T,
    handler: (data: EventData<T>) => void
  ) => {
    const wrappedHandler = (event: Event) => {
      const customEvent = event as CustomEvent<EventData<T>>;
      handler(customEvent.detail);
    };

    eventBus.addEventListener(eventName, wrappedHandler);

    // Auto cleanup on component unmount
    onCleanup(() => {
      eventBus.removeEventListener(eventName, wrappedHandler);
    });
  };

  const once = <T extends EventName>(
    eventName: T,
    handler: (data: EventData<T>) => void
  ) => {
    const wrappedHandler = (event: Event) => {
      const customEvent = event as CustomEvent<EventData<T>>;
      handler(customEvent.detail);
      eventBus.removeEventListener(eventName, wrappedHandler);
    };

    eventBus.addEventListener(eventName, wrappedHandler);

    // Auto cleanup on component unmount
    onCleanup(() => {
      eventBus.removeEventListener(eventName, wrappedHandler);
    });
  };

  const off = <T extends EventName>(
    eventName: T,
    handler: (data: EventData<T>) => void
  ) => {
    const wrappedHandler = (event: Event) => {
      const customEvent = event as CustomEvent<EventData<T>>;
      handler(customEvent.detail);
    };

    eventBus.removeEventListener(eventName, wrappedHandler);
  };

  // Get all active listeners for debugging
  const getListeners = () => {
    // Note: EventTarget doesn't provide a way to enumerate listeners
    // This is mainly for debugging purposes
    return eventBus;
  };

  return {
    emit,
    on,
    once,
    off,
    getListeners,
  };
}

// Export event bus for advanced usage
export { eventBus };

// Utility to create typed event emitters
export function createEventEmitter<T extends Record<string, any>>() {
  return {
    emit: <K extends keyof T>(eventName: K, data: T[K]) => {
      const event = new CustomEvent(eventName as string, { detail: data });
      eventBus.dispatchEvent(event);
    },
    on: <K extends keyof T>(eventName: K, handler: (data: T[K]) => void) => {
      const wrappedHandler = (event: Event) => {
        const customEvent = event as CustomEvent<T[K]>;
        handler(customEvent.detail);
      };

      eventBus.addEventListener(eventName as string, wrappedHandler);

      return () => {
        eventBus.removeEventListener(eventName as string, wrappedHandler);
      };
    },
  };
}
