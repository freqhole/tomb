// tests for createDocStore solid adapter.
//
// uses a lightweight mock DocHandle (no automerge wasm needed) to test
// the solid reactivity layer independently of any specific doc schema.

import { describe, it, expect, vi } from "vitest";
import { createRoot } from "solid-js";
import type {
  DocHandleChangePayload,
  DocHandleDeletePayload,
} from "@automerge/automerge-repo";
import { createDocStore, changeDoc } from "./doc-store.js";
import type { DocHandle } from "@automerge/automerge-repo";

// --- minimal mock DocHandle ---

type EventName = "change" | "delete";
type HandlerFn = (payload: unknown) => void;

function createMockHandle(initialDoc: unknown = undefined): {
  handle: DocHandle<unknown>;
  setDoc: (doc: unknown) => void;
  emitChange: (doc: unknown) => void;
  emitDelete: () => void;
  resolveReady: () => void;
  rejectReady: (err: unknown) => void;
  offSpy: ReturnType<typeof vi.fn>;
} {
  let currentDoc = initialDoc;
  const handlers = new Map<EventName, Set<HandlerFn>>();
  let readyResolve: () => void;
  let readyReject: (err: unknown) => void;

  const readyPromise = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  const offSpy = vi.fn();

  const handle = {
    doc: () => currentDoc,
    whenReady: () => readyPromise,
    on: (event: EventName, handler: HandlerFn) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: offSpy,
    change: vi.fn((fn: (d: unknown) => void) => {
      fn(currentDoc);
      const set = handlers.get("change");
      if (set) {
        const payload: DocHandleChangePayload<unknown> = {
          handle: handle as unknown as DocHandle<unknown>,
          doc: currentDoc as ReturnType<typeof handle.doc>,
          patches: [],
          patchInfo: {
            before: currentDoc as ReturnType<typeof handle.doc>,
            after: currentDoc as ReturnType<typeof handle.doc>,
            source: "change",
          },
        };
        set.forEach((h) => h(payload));
      }
    }),
  } as unknown as DocHandle<unknown>;

  return {
    handle,
    setDoc: (d: unknown) => {
      currentDoc = d;
    },
    emitChange: (doc: unknown) => {
      currentDoc = doc;
      const set = handlers.get("change");
      if (set) {
        const payload: DocHandleChangePayload<unknown> = {
          handle: handle as unknown as DocHandle<unknown>,
          doc: doc as ReturnType<typeof handle.doc>,
          patches: [],
          patchInfo: {
            before: doc as ReturnType<typeof handle.doc>,
            after: doc as ReturnType<typeof handle.doc>,
            source: "change",
          },
        };
        set.forEach((h) => h(payload));
      }
    },
    emitDelete: () => {
      const set = handlers.get("delete");
      if (set) {
        const payload: DocHandleDeletePayload<unknown> = {
          handle: handle as unknown as DocHandle<unknown>,
        };
        set.forEach((h) => h(payload));
      }
    },
    resolveReady: () => readyResolve(),
    rejectReady: (err: unknown) => readyReject(err),
    offSpy,
  };
}

// --- simple parse functions for testing genericity ---

interface SimpleDoc {
  title: string;
  count: number;
}

function parseSimpleDoc(raw: unknown): SimpleDoc {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "title" in raw &&
    typeof raw.title === "string" &&
    "count" in raw &&
    typeof raw.count === "number"
  ) {
    return { title: raw.title, count: raw.count };
  }
  return { title: "", count: 0 };
}

interface CounterDoc {
  count: number;
}

function parseCounterDoc(raw: unknown): CounterDoc {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "count" in raw &&
    typeof raw.count === "number"
  ) {
    return { count: raw.count };
  }
  return { count: 0 };
}

describe("createDocStore", () => {
  it("returns loading=true and default doc when handle doc is undefined", () => {
    createRoot((dispose) => {
      const { handle } = createMockHandle(undefined);
      const { doc, loading } = createDocStore(handle, parseSimpleDoc);

      expect(loading()).toBe(true);
      // parse function provides defaults
      expect(doc().title).toBe("");
      expect(doc().count).toBe(0);

      dispose();
    });
  });

  it("returns loading=false immediately when handle already has a doc", () => {
    createRoot((dispose) => {
      const initialDoc = { title: "loaded", count: 42 };
      const { handle } = createMockHandle(initialDoc);
      const { doc, loading } = createDocStore(handle, parseSimpleDoc);

      expect(loading()).toBe(false);
      expect(doc().title).toBe("loaded");
      expect(doc().count).toBe(42);

      dispose();
    });
  });

  it("updates doc signal on handle change event", () => {
    createRoot((dispose) => {
      const { handle, emitChange } = createMockHandle({
        title: "original",
        count: 1,
      });
      const { doc } = createDocStore(handle, parseSimpleDoc);

      expect(doc().title).toBe("original");
      expect(doc().count).toBe(1);

      emitChange({ title: "updated", count: 2 });

      expect(doc().title).toBe("updated");
      expect(doc().count).toBe(2);

      dispose();
    });
  });

  it("degrades corrupt doc to parse function defaults on change", () => {
    createRoot((dispose) => {
      const { handle, emitChange } = createMockHandle({ title: "ok", count: 1 });
      const { doc } = createDocStore(handle, parseSimpleDoc);

      // emit a corrupt doc that fails validation
      emitChange({ badField: true, wrongType: "not a number" });

      // parse function degrades to defaults
      expect(doc().title).toBe("");
      expect(doc().count).toBe(0);

      dispose();
    });
  });

  it("sets loading=false when delete event fires", () => {
    createRoot((dispose) => {
      const { handle, emitDelete } = createMockHandle(undefined);
      const { loading } = createDocStore(handle, parseSimpleDoc);

      expect(loading()).toBe(true);
      emitDelete();
      expect(loading()).toBe(false);

      dispose();
    });
  });

  it("sets loading=false when whenReady resolves", async () => {
    await createRoot(async (dispose) => {
      const { handle, resolveReady, setDoc } = createMockHandle(undefined);
      const { loading } = createDocStore(handle, parseSimpleDoc);

      expect(loading()).toBe(true);

      setDoc({ title: "ready", count: 10 });
      resolveReady();

      // flush microtasks
      await Promise.resolve();
      await Promise.resolve();

      expect(loading()).toBe(false);

      dispose();
    });
  });

  it("sets loading=false when whenReady rejects", async () => {
    await createRoot(async (dispose) => {
      const { handle, rejectReady } = createMockHandle(undefined);
      const { loading } = createDocStore(handle, parseSimpleDoc);

      rejectReady(new Error("unavailable"));

      await Promise.resolve();
      await Promise.resolve();

      expect(loading()).toBe(false);

      dispose();
    });
  });

  it("unsubscribes handlers on cleanup (off called with correct args)", () => {
    const { handle, offSpy } = createMockHandle({ title: "test", count: 1 });

    const dispose = createRoot((disposeRoot) => {
      createDocStore(handle, parseSimpleDoc);
      return disposeRoot;
    });

    dispose();

    // off should have been called for both "change" and "delete"
    expect(offSpy).toHaveBeenCalledWith("change", expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith("delete", expect.any(Function));
  });

  it("degrades null/undefined doc to parse function defaults", () => {
    createRoot((dispose) => {
      const { handle, emitChange } = createMockHandle({ title: "ok", count: 1 });
      const { doc } = createDocStore(handle, parseSimpleDoc);

      emitChange(null);
      expect(doc().title).toBe("");
      expect(doc().count).toBe(0);

      emitChange(undefined);
      expect(doc().title).toBe("");
      expect(doc().count).toBe(0);

      dispose();
    });
  });

  it("works with a different doc type (CounterDoc) proving genericity", () => {
    createRoot((dispose) => {
      const { handle, emitChange } = createMockHandle({ count: 5 });
      const { doc } = createDocStore(handle, parseCounterDoc);

      expect(doc().count).toBe(5);

      emitChange({ count: 10 });
      expect(doc().count).toBe(10);

      // corrupt data degrades to parseCounterDoc's defaults
      emitChange({ wrongField: true });
      expect(doc().count).toBe(0);

      dispose();
    });
  });
});

describe("changeDoc", () => {
  it("calls handle.change with the mutator function", () => {
    const mockChange = vi.fn();
    const handle = {
      change: mockChange,
    } as unknown as DocHandle<SimpleDoc>;

    const mutator = vi.fn();
    changeDoc(handle, mutator);

    expect(mockChange).toHaveBeenCalledWith(mutator);
  });
});
