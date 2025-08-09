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

// Mock crypto.randomUUID
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
global.__mockCache = mockCache;
global.__mockCaches = mockCaches;

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
      if (global.navigator.storage !== mockNavigatorStorage) {
        (global.navigator as any).storage = mockNavigatorStorage;
      }
    }

    try {
      Object.defineProperty(global.navigator, "serviceWorker", {
        value: mockServiceWorker,
        writable: true,
        configurable: true,
      });
    } catch {
      // Property already exists and is not configurable
      if (global.navigator.serviceWorker !== mockServiceWorker) {
        (global.navigator as any).serviceWorker = mockServiceWorker;
      }
    }

    try {
      Object.defineProperty(global.navigator, "onLine", {
        value: true,
        writable: true,
        configurable: true,
      });
    } catch {
      // Property already exists and is not configurable
      if (global.navigator.onLine !== true) {
        (global.navigator as any).onLine = true;
      }
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
      if (global.caches !== mockCaches) {
        (global as any).caches = mockCaches;
      }
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
      if (global.window.caches !== mockCaches) {
        (global.window as any).caches = mockCaches;
      }
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

// Mock Navigator API with all needed properties
Object.defineProperty(global, "navigator", {
  value: {
    ...global.navigator,
    onLine: true,
    serviceWorker: mockServiceWorker,
    storage: mockNavigatorStorage,
    mediaSession: {
      setActionHandler: vi.fn(),
      metadata: null,
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
global.Audio = vi.fn(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  load: vi.fn(),
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  currentTime: 0,
  duration: 180, // Default 3 minutes
  src: "",
  volume: 1,
  muted: false,
})) as any;

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
      toBlob: vi.fn((callback) => callback(new Blob())),
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
