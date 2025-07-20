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

// Mock window.matchMedia
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
