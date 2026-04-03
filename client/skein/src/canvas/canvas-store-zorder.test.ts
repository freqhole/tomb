import { beforeEach, describe, expect, it } from "vitest";
import { createTestRepo } from "../test-helpers/automerge-helpers";
import { resetEntryCounter, widgetEntry } from "../test-helpers/canvas-fixtures";
import { CanvasStore } from "./canvas-store";

describe("CanvasStore z-order operations", () => {
  let store: CanvasStore;

  beforeEach(() => {
    resetEntryCounter();
    const repo = createTestRepo();
    store = CanvasStore.create(repo);
  });

  // helper to set up 3 widgets with known ids and zIndexes
  function addThreeWidgets() {
    store.addWidget(widgetEntry({ id: "a", zIndex: 0 }));
    store.addWidget(widgetEntry({ id: "b", zIndex: 1 }));
    store.addWidget(widgetEntry({ id: "c", zIndex: 2 }));
  }

  // helper to get the z-order as an array of ids (lowest to highest)
  function zOrder(): string[] {
    const widgets = store.allWidgets();
    return widgets.sort((a, b) => a.zIndex - b.zIndex).map((w) => w.id);
  }

  describe("bringToFront", () => {
    it("moves the bottom widget to the top", () => {
      addThreeWidgets();
      store.bringToFront("a");
      expect(zOrder()).toEqual(["b", "c", "a"]);
    });

    it("normalizes indexes to 0, 1, 2", () => {
      addThreeWidgets();
      store.bringToFront("a");
      expect(store.getWidget("b")!.zIndex).toBe(0);
      expect(store.getWidget("c")!.zIndex).toBe(1);
      expect(store.getWidget("a")!.zIndex).toBe(2);
    });

    it("is a no-op when widget is already at front", () => {
      addThreeWidgets();
      store.bringToFront("c");
      expect(zOrder()).toEqual(["a", "b", "c"]);
    });

    it("is a no-op for nonexistent widget", () => {
      addThreeWidgets();
      store.bringToFront("nonexistent");
      expect(zOrder()).toEqual(["a", "b", "c"]);
    });
  });

  describe("bringForward", () => {
    it("swaps a widget with the one above it", () => {
      addThreeWidgets();
      store.bringForward("a");
      expect(zOrder()).toEqual(["b", "a", "c"]);
    });

    it("normalizes indexes after swap", () => {
      addThreeWidgets();
      store.bringForward("a");
      expect(store.getWidget("b")!.zIndex).toBe(0);
      expect(store.getWidget("a")!.zIndex).toBe(1);
      expect(store.getWidget("c")!.zIndex).toBe(2);
    });

    it("is a no-op when widget is already at front", () => {
      addThreeWidgets();
      store.bringForward("c");
      expect(zOrder()).toEqual(["a", "b", "c"]);
    });

    it("repeated calls move widget to front one step at a time", () => {
      addThreeWidgets();
      store.bringForward("a");
      expect(zOrder()).toEqual(["b", "a", "c"]);
      store.bringForward("a");
      expect(zOrder()).toEqual(["b", "c", "a"]);
      store.bringForward("a"); // already at top, no-op
      expect(zOrder()).toEqual(["b", "c", "a"]);
    });
  });

  describe("sendBackward", () => {
    it("swaps a widget with the one below it", () => {
      addThreeWidgets();
      store.sendBackward("c");
      expect(zOrder()).toEqual(["a", "c", "b"]);
    });

    it("is a no-op when widget is already at back", () => {
      addThreeWidgets();
      store.sendBackward("a");
      expect(zOrder()).toEqual(["a", "b", "c"]);
    });

    it("repeated calls move widget to back one step at a time", () => {
      addThreeWidgets();
      store.sendBackward("c");
      expect(zOrder()).toEqual(["a", "c", "b"]);
      store.sendBackward("c");
      expect(zOrder()).toEqual(["c", "a", "b"]);
      store.sendBackward("c"); // already at bottom, no-op
      expect(zOrder()).toEqual(["c", "a", "b"]);
    });
  });

  describe("sendToBack", () => {
    it("moves the top widget to the bottom", () => {
      addThreeWidgets();
      store.sendToBack("c");
      expect(zOrder()).toEqual(["c", "a", "b"]);
    });

    it("normalizes indexes to 0, 1, 2", () => {
      addThreeWidgets();
      store.sendToBack("c");
      expect(store.getWidget("c")!.zIndex).toBe(0);
      expect(store.getWidget("a")!.zIndex).toBe(1);
      expect(store.getWidget("b")!.zIndex).toBe(2);
    });

    it("is a no-op when widget is already at back", () => {
      addThreeWidgets();
      store.sendToBack("a");
      expect(zOrder()).toEqual(["a", "b", "c"]);
    });
  });

  describe("getLayerInfo", () => {
    it("returns correct position and total", () => {
      addThreeWidgets();
      expect(store.getLayerInfo("a")).toEqual({ position: 0, total: 3 });
      expect(store.getLayerInfo("b")).toEqual({ position: 1, total: 3 });
      expect(store.getLayerInfo("c")).toEqual({ position: 2, total: 3 });
    });

    it("returns updated position after bringToFront", () => {
      addThreeWidgets();
      store.bringToFront("a");
      expect(store.getLayerInfo("a")).toEqual({ position: 2, total: 3 });
    });

    it("returns { position: 0, total: 0 } for nonexistent widget", () => {
      expect(store.getLayerInfo("nope")).toEqual({ position: 0, total: 0 });
    });
  });

  describe("combined operations", () => {
    it("bringToFront then sendToBack round-trips", () => {
      addThreeWidgets();
      store.bringToFront("a");
      expect(zOrder()).toEqual(["b", "c", "a"]);
      store.sendToBack("a");
      expect(zOrder()).toEqual(["a", "b", "c"]);
    });

    it("indexes stay tight after many operations", () => {
      addThreeWidgets();
      store.bringToFront("a");
      store.sendBackward("c");
      store.bringForward("b");
      store.sendToBack("a");
      // verify all indexes are sequential 0..n
      const widgets = store.allWidgets().sort((a, b) => a.zIndex - b.zIndex);
      widgets.forEach((w, i) => {
        expect(w.zIndex).toBe(i);
      });
    });
  });
});
