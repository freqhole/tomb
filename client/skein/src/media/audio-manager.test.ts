import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock media-urls before importing audio-manager
vi.mock("./media-urls", () => ({
  getMediaPlaybackUrl: vi.fn(),
  revokeMediaUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// minimal HTMLAudioElement stub
// ---------------------------------------------------------------------------

function createMockAudioElement() {
  const listeners: Record<string, Set<EventListener>> = {};
  const mock = {
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    src: "",
    preload: "",
    play: vi.fn(async () => {
      mock.paused = false;
      listeners["play"]?.forEach((h) => h(new Event("play")));
    }),
    pause: vi.fn(() => {
      mock.paused = true;
      listeners["pause"]?.forEach((h) => h(new Event("pause")));
    }),
    load: vi.fn(),
    addEventListener: vi.fn((event: string, handler: EventListener) => {
      if (!listeners[event]) listeners[event] = new Set();
      listeners[event].add(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: EventListener) => {
      listeners[event]?.delete(handler);
    }),
    removeAttribute: vi.fn(),
    error: null as MediaError | null,
    // test helper: fire a DOM event on this element
    _fire(event: string) {
      listeners[event]?.forEach((h) => h(new Event(event)));
    },
    _listeners: listeners,
  };
  return mock;
}

type MockAudio = ReturnType<typeof createMockAudioElement>;
let mockAudioElement: MockAudio;

// ---------------------------------------------------------------------------
// we need a fresh AudioManagerImpl for each test so state doesn't leak.
// the module exports a singleton, so we re-import it each time.
// ---------------------------------------------------------------------------

async function freshManager() {
  // reset the module registry so we get a new singleton
  vi.resetModules();
  // re-apply the mock after resetModules
  vi.doMock("./media-urls", () => ({
    getMediaPlaybackUrl: vi.fn(),
    revokeMediaUrl: vi.fn(),
  }));
  const mod = await import("./audio-manager");
  return mod.audioManager;
}

// ---------------------------------------------------------------------------
// setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockAudioElement = createMockAudioElement();

  // ensure document exists in the Node test environment and stub createElement
  if (typeof globalThis.document === "undefined") {
    (globalThis as any).document = {} as any;
  }

  (document as any).createElement = vi.fn((tag: string) => {
    if (tag === "audio") return mockAudioElement as unknown as HTMLAudioElement;
    return { tagName: tag } as unknown as HTMLElement;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("audioManager", () => {
  describe("getState()", () => {
    it("returns correct initial state before any playback", async () => {
      const mgr = await freshManager();
      const state = mgr.getState();

      expect(state.blobId).toBe("");
      expect(state.isPlaying).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.duration).toBe(0);
      expect(state.volume).toBe(1);
      expect(state.muted).toBe(false);

      mgr.destroy();
    });
  });

  describe("isCurrentBlob()", () => {
    it("returns false when nothing is loaded", async () => {
      const mgr = await freshManager();
      expect(mgr.isCurrentBlob("some-blob-id")).toBe(false);
      expect(mgr.isCurrentBlob("")).toBe(true); // empty matches empty
      mgr.destroy();
    });
  });

  describe("isPlaying", () => {
    it("is false when nothing is loaded", async () => {
      const mgr = await freshManager();
      expect(mgr.isPlaying).toBe(false);
      mgr.destroy();
    });
  });

  describe("currentBlob", () => {
    it("is empty string when nothing is loaded", async () => {
      const mgr = await freshManager();
      expect(mgr.currentBlob).toBe("");
      mgr.destroy();
    });
  });

  describe("pause() / stop()", () => {
    it("pause does not throw when nothing is loaded", async () => {
      const mgr = await freshManager();
      expect(() => mgr.pause()).not.toThrow();
      mgr.destroy();
    });

    it("stop does not throw when nothing is loaded", async () => {
      const mgr = await freshManager();
      expect(() => mgr.stop()).not.toThrow();
      mgr.destroy();
    });
  });

  describe("setVolume()", () => {
    it("sets volume on the audio element", async () => {
      const mgr = await freshManager();
      mgr.setVolume(0.5);
      expect(mockAudioElement.volume).toBe(0.5);
      mgr.destroy();
    });

    it("clamps volume to [0, 1]", async () => {
      const mgr = await freshManager();
      mgr.setVolume(2);
      expect(mockAudioElement.volume).toBe(1);
      mgr.setVolume(-0.5);
      expect(mockAudioElement.volume).toBe(0);
      mgr.destroy();
    });
  });

  describe("toggleMute()", () => {
    it("toggles muted state on the audio element", async () => {
      const mgr = await freshManager();
      expect(mockAudioElement.muted).toBe(false);

      mgr.toggleMute();
      expect(mockAudioElement.muted).toBe(true);

      mgr.toggleMute();
      expect(mockAudioElement.muted).toBe(false);
      mgr.destroy();
    });
  });

  describe("setMuted()", () => {
    it("sets muted state explicitly", async () => {
      const mgr = await freshManager();
      mgr.setMuted(true);
      expect(mockAudioElement.muted).toBe(true);
      mgr.setMuted(false);
      expect(mockAudioElement.muted).toBe(false);
      mgr.destroy();
    });
  });

  describe("event system", () => {
    it("on() registers a handler and returns an unsub function", async () => {
      const mgr = await freshManager();
      const handler = vi.fn();
      const unsub = mgr.on("stop", handler);

      expect(typeof unsub).toBe("function");

      // trigger element creation, then stop to fire the event
      mgr.setVolume(1);
      mgr.stop();

      expect(handler).toHaveBeenCalledOnce();
      mgr.destroy();
    });

    it("unsub function removes the handler", async () => {
      const mgr = await freshManager();
      const handler = vi.fn();
      const unsub = mgr.on("stop", handler);

      unsub();

      mgr.setVolume(1);
      mgr.stop();

      expect(handler).not.toHaveBeenCalled();
      mgr.destroy();
    });

    it("on() can register multiple handlers for the same event", async () => {
      const mgr = await freshManager();
      const h1 = vi.fn();
      const h2 = vi.fn();
      mgr.on("stop", h1);
      mgr.on("stop", h2);

      mgr.setVolume(1);
      mgr.stop();

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
      mgr.destroy();
    });

    it("once() fires handler only once then auto-unsubscribes", async () => {
      const mgr = await freshManager();
      const handler = vi.fn();
      mgr.once("stop", handler);

      mgr.setVolume(1);

      // first stop — handler should fire
      mgr.stop();
      expect(handler).toHaveBeenCalledOnce();

      // second stop — handler should NOT fire again
      mgr.stop();
      expect(handler).toHaveBeenCalledOnce();
      mgr.destroy();
    });

    it("once() returns an unsub function that works before the event fires", async () => {
      const mgr = await freshManager();
      const handler = vi.fn();
      const unsub = mgr.once("stop", handler);

      unsub();

      mgr.setVolume(1);
      mgr.stop();
      expect(handler).not.toHaveBeenCalled();
      mgr.destroy();
    });

    it("off(event) removes all handlers for that event", async () => {
      const mgr = await freshManager();
      const h1 = vi.fn();
      const h2 = vi.fn();
      mgr.on("stop", h1);
      mgr.on("stop", h2);

      mgr.off("stop");

      mgr.setVolume(1);
      mgr.stop();

      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
      mgr.destroy();
    });

    it("off() with no args removes all listeners for all events", async () => {
      const mgr = await freshManager();
      const stopHandler = vi.fn();
      const pauseHandler = vi.fn();
      mgr.on("stop", stopHandler);
      mgr.on("pause", pauseHandler);

      mgr.off();

      mgr.setVolume(1);
      mgr.stop();

      expect(stopHandler).not.toHaveBeenCalled();
      expect(pauseHandler).not.toHaveBeenCalled();
      mgr.destroy();
    });

    it("volumechange event fires when the DOM element dispatches it", async () => {
      const mgr = await freshManager();
      const handler = vi.fn();
      mgr.on("volumechange", handler);

      mgr.setVolume(0.7);
      // simulate the DOM firing volumechange
      mockAudioElement._fire("volumechange");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          volume: expect.any(Number),
          muted: expect.any(Boolean),
        })
      );
      mgr.destroy();
    });
  });

  describe("destroy()", () => {
    it("clears all listeners", async () => {
      const mgr = await freshManager();
      const handler = vi.fn();
      mgr.on("stop", handler);
      mgr.on("play", vi.fn());
      mgr.on("error", vi.fn());

      mgr.destroy();

      // after destroy, handler should not have been called
      expect(handler).not.toHaveBeenCalled();
    });

    it("removes DOM event listeners from the audio element", async () => {
      const mgr = await freshManager();
      // trigger element creation
      mgr.setVolume(1);

      const removeCountBefore = mockAudioElement.removeEventListener.mock.calls.length;

      mgr.destroy();

      // should have called removeEventListener for each bound handler
      expect(mockAudioElement.removeEventListener.mock.calls.length).toBeGreaterThan(
        removeCountBefore
      );
    });

    it("can be reused after destroy — new element is created on next use", async () => {
      const mgr = await freshManager();
      mgr.setVolume(0.5);
      mgr.destroy();

      // after destroy, calling setVolume should create a new element
      expect(() => mgr.setVolume(0.8)).not.toThrow();
    });
  });

  describe("seek()", () => {
    it("does nothing when no element exists", async () => {
      const mgr = await freshManager();
      expect(() => mgr.seek(10)).not.toThrow();
      mgr.destroy();
    });

    it("clamps to valid range", async () => {
      const mgr = await freshManager();
      mgr.setVolume(1); // ensure element created
      mockAudioElement.duration = 60;

      mgr.seek(30);
      expect(mockAudioElement.currentTime).toBe(30);

      mgr.seek(-5);
      expect(mockAudioElement.currentTime).toBe(0);

      mgr.seek(999);
      expect(mockAudioElement.currentTime).toBe(60);

      mgr.destroy();
    });
  });

  describe("seekProgress()", () => {
    it("seeks to fractional position of duration", async () => {
      const mgr = await freshManager();
      mgr.setVolume(1); // ensure element created
      mockAudioElement.duration = 100;

      mgr.seekProgress(0.5);
      expect(mockAudioElement.currentTime).toBe(50);

      mgr.seekProgress(0);
      expect(mockAudioElement.currentTime).toBe(0);

      mgr.seekProgress(1);
      expect(mockAudioElement.currentTime).toBe(100);

      mgr.destroy();
    });
  });
});
