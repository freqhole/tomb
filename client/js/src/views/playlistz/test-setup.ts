// Test setup for playlistz component tests
// This file sets up jsdom environment and IndexedDB mocking

import { vi } from "vitest";
import "fake-indexeddb/auto";

// Configure globals for jsdom environment
global.ResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  root: null,
  rootMargin: "0px",
  thresholds: [],
  takeRecords: vi.fn(() => []),
})) as any;

// Mock BroadcastChannel for tests
global.BroadcastChannel = vi.fn(() => ({
  postMessage: vi.fn(),
  onmessage: null,
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as any;

// Mock crypto.randomUUID and crypto.subtle
Object.defineProperty(global, "crypto", {
  value: {
    randomUUID: vi.fn(
      () => `test-uuid-${Math.random().toString(36).substr(2, 9)}`
    ),
    getRandomValues: vi.fn((arr) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }),
    subtle: {
      digest: vi.fn().mockImplementation((_algorithm, _data) => {
        // Mock SHA-256 digest - return a fixed hash for testing
        const mockHash = new Uint8Array(32); // SHA-256 produces 32 bytes
        for (let i = 0; i < 32; i++) {
          mockHash[i] = i; // Simple pattern for testing
        }
        return Promise.resolve(mockHash.buffer);
      }),
    },
  },
  writable: true,
});

// Mock URL.createObjectURL and revokeObjectURL for file handling
global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

// Mock Cache API - create consistent cache instance
const createMockCache = () => ({
  match: vi.fn(),
  add: vi.fn().mockResolvedValue(undefined),
  addAll: vi.fn().mockResolvedValue(undefined),
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(true),
  keys: vi.fn().mockResolvedValue([]),
});

const mockCache = createMockCache();

const mockCaches = {
  open: vi.fn().mockResolvedValue(mockCache),
  delete: vi.fn().mockResolvedValue(true),
  keys: vi.fn().mockResolvedValue(["playlistz-cache-v1"]),
  match: vi.fn(),
  has: vi.fn().mockResolvedValue(true),
};

Object.defineProperty(global, "caches", {
  value: mockCaches,
  writable: true,
});

// Export mock objects for direct access in tests
(global as any).__mockCache = mockCache;
(global as any).__mockCaches = mockCaches;

// Mock management functions
export const mockManager = {
  // Reset all mocks to default state
  resetAllMocks() {
    vi.clearAllMocks();

    // Reset cache mocks
    mockCache.match.mockResolvedValue(undefined);
    mockCache.add.mockResolvedValue(undefined);
    mockCache.addAll.mockResolvedValue(undefined);
    mockCache.put.mockResolvedValue(undefined);
    mockCache.delete.mockResolvedValue(true);
    mockCache.keys.mockResolvedValue([]);

    // Reset caches API mock
    mockCaches.open.mockResolvedValue(mockCache);
    mockCaches.delete.mockResolvedValue(true);
    mockCaches.keys.mockResolvedValue(["playlistz-cache-v1"]);

    // Reset storage API mock
    mockNavigatorStorage.persist.mockResolvedValue(true);
    mockNavigatorStorage.persisted.mockResolvedValue(true);
    mockNavigatorStorage.estimate.mockResolvedValue({
      quota: 1000000000,
      usage: 100000000,
    });

    // Reset service worker mock
    mockServiceWorker.controller = null;
    mockServiceWorker.register.mockResolvedValue({
      active: null,
      installing: null,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(true),
    });
  },

  // Reset global API availability
  resetGlobalAPIs() {
    // Reset navigator properties safely
    try {
      Object.defineProperty(global.navigator, "storage", {
        value: mockNavigatorStorage,
        writable: true,
        configurable: true,
      });
    } catch {
      // Property already exists and is not configurable
      (global.navigator as any).storage = mockNavigatorStorage;
    }

    try {
      Object.defineProperty(global.navigator, "serviceWorker", {
        value: mockServiceWorker,
        writable: true,
        configurable: true,
      });
    } catch {
      // Property already exists and is not configurable
      (global.navigator as any).serviceWorker = mockServiceWorker;
    }

    try {
      Object.defineProperty(global.navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });
    } catch {
      // Property already exists and is not configurable
      (global.navigator as any).onLine = true;
    }

    // Reset caches API safely
    try {
      Object.defineProperty(global, "caches", {
        value: mockCaches,
        writable: true,
        configurable: true,
      });
    } catch {
      // Property already exists and is not configurable
      (global as any).caches = mockCaches;
    }

    // Reset window properties safely
    try {
      Object.defineProperty(global.window, "caches", {
        value: mockCaches,
        writable: true,
        configurable: true,
      });
    } catch {
      // Property already exists and is not configurable
      (global.window as any).caches = mockCaches;
    }
  },

  // Mock API as unavailable
  mockAPIUnavailable: {
    storage() {
      Object.defineProperty(global.navigator, "storage", {
        value: undefined,
        writable: true,
        configurable: true,
      });
    },

    caches() {
      Object.defineProperty(global, "caches", {
        value: undefined,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(global.window, "caches", {
        value: undefined,
        writable: true,
        configurable: true,
      });
    },

    serviceWorker() {
      Object.defineProperty(global.navigator, "serviceWorker", {
        value: undefined,
        writable: true,
        configurable: true,
      });
    },
  },

  // Get mock references
  getMocks() {
    return {
      cache: mockCache,
      caches: mockCaches,
      navigatorStorage: mockNavigatorStorage,
      serviceWorker: mockServiceWorker,
    };
  },
};

// Mock Service Worker
const mockServiceWorkerRegistration = {
  active: null,
  installing: null,
  waiting: null,
  update: vi.fn().mockResolvedValue(undefined),
  unregister: vi.fn().mockResolvedValue(true),
};

const mockServiceWorker = {
  controller: null,
  ready: Promise.resolve(mockServiceWorkerRegistration),
  register: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  getRegistration: vi.fn().mockResolvedValue(mockServiceWorkerRegistration),
};

// Mock Storage API
const mockNavigatorStorage = {
  persist: vi.fn().mockResolvedValue(true),
  persisted: vi.fn().mockResolvedValue(true),
  estimate: vi.fn().mockResolvedValue({
    quota: 1000000000, // 1GB
    usage: 100000000, // 100MB
  }),
};

// Mock MediaMetadata for media session
global.MediaMetadata = vi.fn().mockImplementation((metadata) => ({
  title: metadata?.title || "",
  artist: metadata?.artist || "",
  album: metadata?.album || "",
  artwork: metadata?.artwork || [],
}));

// Enhanced Blob mock with arrayBuffer method
const originalBlob = global.Blob;
global.Blob = vi.fn().mockImplementation((...args) => {
  const blob = new originalBlob(...args);

  // Add arrayBuffer method if missing
  if (!blob.arrayBuffer) {
    Object.defineProperty(blob, "arrayBuffer", {
      value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      writable: true,
      configurable: true,
    });
  }

  return blob;
}) as any;

// Ensure global Blob constructor maintains prototype
Object.setPrototypeOf(global.Blob, originalBlob);

// Mock Navigator API with all needed properties
Object.defineProperty(global, "navigator", {
  value: {
    ...global.navigator,
    onLine: true,
    serviceWorker: mockServiceWorker,
    storage: mockNavigatorStorage,
    mediaSession: {
      setActionHandler: vi.fn(),
      setPositionState: vi.fn(),
      metadata: null,
      playbackState: "none",
    },
  },
  writable: true,
});

// Mock FileReader for audio metadata extraction
global.FileReader = vi.fn(() => ({
  readAsArrayBuffer: vi.fn(function (this: any) {
    // Simulate async file reading
    setTimeout(() => {
      this.onload?.({ target: { result: new ArrayBuffer(8) } });
    }, 0);
  }),
  onload: null,
  onerror: null,
  result: null,
})) as any;

// Mock Audio constructor for audio file testing
global.Audio = vi.fn(() => {
  const eventListeners = new Map();

  const mockAudio = {
    addEventListener: vi.fn((event, handler) => {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(handler);
    }),
    removeEventListener: vi.fn((event, handler) => {
      if (eventListeners.has(event)) {
        const handlers = eventListeners.get(event);
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    }),
    load: vi.fn(),
    play: vi.fn(() => {
      mockAudio.paused = false;
      // Fire play event synchronously
      const playHandlers = eventListeners.get("play") || [];
      playHandlers.forEach((handler: any) => handler());
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      mockAudio.paused = true;
      // Fire pause event synchronously
      const pauseHandlers = eventListeners.get("pause") || [];
      pauseHandlers.forEach((handler: any) => handler());
    }),
    currentTime: 0,
    duration: 180, // Default 3 minutes
    src: "",
    volume: 1,
    muted: false,
    paused: true,
    ended: false,
    readyState: 4,
    networkState: 1,
    error: null,
    preload: "metadata",
    _volume: 1,
    _currentTime: 0,
    _src: "",
  };

  // Make properties writable so the service can set them
  Object.defineProperty(mockAudio, "volume", {
    get() {
      return mockAudio._volume;
    },
    set(value) {
      mockAudio._volume = value;
    },
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(mockAudio, "currentTime", {
    get() {
      return mockAudio._currentTime;
    },
    set(value) {
      mockAudio._currentTime = value;
    },
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(mockAudio, "src", {
    get() {
      return mockAudio._src;
    },
    set(value) {
      mockAudio._src = value;
      // Simulate events when src is set - fire synchronously
      if (value) {
        const loadstartHandlers = eventListeners.get("loadstart") || [];
        loadstartHandlers.forEach((handler: any) => handler());

        // Also fire loadedmetadata and canplay events
        const loadedmetadataHandlers =
          eventListeners.get("loadedmetadata") || [];
        loadedmetadataHandlers.forEach((handler: any) => handler());

        const canplayHandlers = eventListeners.get("canplay") || [];
        canplayHandlers.forEach((handler: any) => handler());
      }
    },
    enumerable: true,
    configurable: true,
  });

  return mockAudio;
}) as any;

// Mock document API for canvas operations and DOM manipulation
Object.defineProperty(global, "document", {
  value: {
    ...global.document,
    title: "Test Page",
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      setAttribute: vi.fn(),
      remove: vi.fn(),
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback) => {
        const blob = new Blob(["mock-image-data"], { type: "image/png" });
        callback(blob);
      }),
    })),
    head: {
      appendChild: vi.fn(),
    },
  },
  writable: true,
});

// Mock window object with needed properties
Object.defineProperty(global, "window", {
  value: {
    ...global.window,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    location: {
      href: "http://localhost:3000/test",
      protocol: "http:",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    caches: mockCaches,
    navigator: global.navigator,
  },
  writable: true,
});

// Mock window.matchMedia (only in jsdom environment)
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Test database setup functions
export async function setupTestDB(): Promise<void> {
  // fake-indexeddb automatically provides a fresh database for each test
  // No additional setup needed as fake-indexeddb/auto handles this
}

export async function cleanupTestDB(): Promise<void> {
  // fake-indexeddb automatically cleans up after each test
  // Manual cleanup can be done here if needed
  if (typeof indexedDB !== "undefined") {
    // Get all database names and delete them
    try {
      const databases = (await indexedDB.databases?.()) || [];
      for (const db of databases) {
        if (db.name) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    } catch (error) {
      // Some environments may not support indexedDB.databases()
      // In that case, fake-indexeddb will handle cleanup automatically
    }
  }
}

// Helper function to create File mocks with arrayBuffer method
export function createMockFile(
  content: string[] | string,
  filename: string,
  options: { type: string; lastModified?: number } = {
    type: "application/octet-stream",
  }
): File {
  const file = new File(
    Array.isArray(content) ? content : [content],
    filename,
    options
  );

  // Add arrayBuffer method that File objects should have
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    writable: true,
    configurable: true,
  });

  return file;
}

// Clean up after each test
import { afterEach } from "vitest";

afterEach(() => {
  // Clear all IndexedDB databases
  if (typeof indexedDB !== "undefined") {
    // fake-indexeddb cleanup is automatic, but we can reset if needed
  }

  // Clear all mocks
  vi.clearAllMocks();
});
