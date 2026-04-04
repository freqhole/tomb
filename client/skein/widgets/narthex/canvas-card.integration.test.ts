import type { DocumentId } from "@automerge/automerge-repo";
import { Repo } from "@automerge/automerge-repo";
import { describe, expect, it } from "vitest";
import { CanvasStore } from "../../src/canvas/canvas-store";
import { createWidgetDoc } from "../../src/widgets/widget-doc";
import { canvasCardSchema } from "./canvas-card";
import { canvasWizardSchema } from "./canvas-wizard";

/**
 * integration tests for the narthex canvas-card creation flow.
 *
 * these tests exercise the exact code paths that run when:
 * 1. the wizard dispatches skein:create-canvas
 * 2. the router creates a canvas-card widget with props
 * 3. the widget-manager mounts the card (creates per-widget doc from props)
 * 4. the user navigates away and back (re-mounts from persisted docId)
 *
 * uses real Automerge repos (in-memory, no IndexedDB) to catch
 * serialization, proxy, and round-trip issues.
 */

function createTestRepo(): Repo {
  return new Repo({});
}

// ---------------------------------------------------------------------------
// 1. per-widget doc creation from props (the mountWidget code path)
// ---------------------------------------------------------------------------

describe("canvas-card per-widget doc creation from props", () => {
  it("creates a widget doc with router-style props", () => {
    const repo = createTestRepo();

    // simulate what boot.ts passes as entry.props when creating a canvas-card
    const entryProps = {
      canvasDocId: "test-canvas-doc-abc123",
      title: "my test canvas",
      description: "a description",
      authorName: "alice",
      color: 0x06b6d4,
      createdAt: "2025-01-15",
      modifiedAt: "2025-01-15",
    };

    // this is the exact line from widget-manager.ts mountWidget():
    //   const defaults = factory.schema.parse(entry.props ?? {});
    //   widgetDocHandle = this.repo.create(defaults);
    const defaults = canvasCardSchema.parse(entryProps);
    const handle = repo.create(defaults);

    // verify the handle has a documentId
    expect(handle.documentId).toBeTruthy();

    // verify the doc contains the seeded data
    const doc = handle.doc();
    expect(doc).toBeTruthy();
    expect(doc!.canvasDocId).toBe("test-canvas-doc-abc123");
    expect(doc!.title).toBe("my test canvas");
    expect(doc!.description).toBe("a description");
    expect(doc!.authorName).toBe("alice");
    expect(doc!.color).toBe(0x06b6d4);
    expect(doc!.createdAt).toBe("2025-01-15");
    expect(doc!.modifiedAt).toBe("2025-01-15");
    // previewUrl should be filled with default
    expect(doc!.previewUrl).toBe("");
  });

  it("creates a widget doc with empty props (defaults only)", () => {
    const repo = createTestRepo();

    const defaults = canvasCardSchema.parse({});
    const handle = repo.create(defaults);
    const doc = handle.doc();

    expect(doc).toBeTruthy();
    expect(doc!.canvasDocId).toBe("");
    expect(doc!.title).toBe("untitled canvas");
    expect(doc!.description).toBe("");
    expect(doc!.authorName).toBe("");
    expect(doc!.color).toBe(0xd946ef);
  });

  it("WidgetDoc facade reads seeded props correctly", () => {
    const repo = createTestRepo();

    const entryProps = {
      canvasDocId: "doc-xyz",
      title: "facade test",
      authorName: "bob",
      color: 0xeab308,
    };

    const defaults = canvasCardSchema.parse(entryProps);
    const handle = repo.create(defaults);
    const widgetDoc = createWidgetDoc(canvasCardSchema, handle);

    expect(widgetDoc.current.canvasDocId).toBe("doc-xyz");
    expect(widgetDoc.current.title).toBe("facade test");
    expect(widgetDoc.current.authorName).toBe("bob");
    expect(widgetDoc.current.color).toBe(0xeab308);
    // defaults filled in
    expect(widgetDoc.current.description).toBe("");
    expect(widgetDoc.current.previewUrl).toBe("");
  });

  it("WidgetDoc facade change() persists mutations", () => {
    const repo = createTestRepo();

    const defaults = canvasCardSchema.parse({ title: "original" });
    const handle = repo.create(defaults);
    const widgetDoc = createWidgetDoc(canvasCardSchema, handle);

    expect(widgetDoc.current.title).toBe("original");

    widgetDoc.change((draft) => {
      draft.title = "updated";
    });

    expect(widgetDoc.current.title).toBe("updated");
    // verify the underlying handle also reflects the change
    expect(handle.doc()!.title).toBe("updated");
  });
});

// ---------------------------------------------------------------------------
// 2. repo.find() round-trip (the navigate-away-and-back code path)
// ---------------------------------------------------------------------------

describe("canvas-card per-widget doc round-trip via repo.find()", () => {
  it("finds a previously-created widget doc by documentId", async () => {
    const repo = createTestRepo();

    // step 1: create the doc (simulates first mount)
    const defaults = canvasCardSchema.parse({
      canvasDocId: "canvas-round-trip",
      title: "round trip test",
      authorName: "charlie",
    });
    const handle = repo.create(defaults);
    const docId = handle.documentId;

    // step 2: find the same doc (simulates re-mount after navigation)
    // repo.find() is async and returns Promise<DocHandle<T>>, already waits
    // for the doc to be ready before resolving.
    const found = await repo.find<typeof defaults>(docId);

    const doc = found.doc();
    expect(doc).toBeTruthy();
    expect(doc!.canvasDocId).toBe("canvas-round-trip");
    expect(doc!.title).toBe("round trip test");
    expect(doc!.authorName).toBe("charlie");
  });

  it("WidgetDoc facade works on a found (not created) handle", async () => {
    const repo = createTestRepo();

    // create
    const defaults = canvasCardSchema.parse({
      canvasDocId: "facade-find-test",
      title: "found facade",
      color: 0x10b981,
    });
    const created = repo.create(defaults);
    const docId = created.documentId;

    // find — repo.find() is async, returns ready DocHandle
    const found = await repo.find<typeof defaults>(docId);

    const widgetDoc = createWidgetDoc(canvasCardSchema, found);
    expect(widgetDoc.current.canvasDocId).toBe("facade-find-test");
    expect(widgetDoc.current.title).toBe("found facade");
    expect(widgetDoc.current.color).toBe(0x10b981);
  });

  it("mutations on found handle are visible on original handle", async () => {
    const repo = createTestRepo();

    const defaults = canvasCardSchema.parse({ title: "before mutation" });
    const created = repo.create(defaults);
    const docId = created.documentId;

    const found = await repo.find<typeof defaults>(docId);

    // mutate via the found handle
    found.change((d: any) => {
      d.title = "after mutation";
    });

    // original handle should see the change
    expect(created.doc()!.title).toBe("after mutation");
  });
});

// ---------------------------------------------------------------------------
// 3. CanvasStore addWidget + setDocId round-trip
//    (the narthex store persists widget entries including docId)
// ---------------------------------------------------------------------------

describe("CanvasStore widget entry with docId round-trip", () => {
  it("addWidget stores props in the canvas doc", () => {
    const repo = createTestRepo();
    const store = CanvasStore.create(repo);

    const widgetId = "card-widget-1";
    store.addWidget({
      id: widgetId,
      type: "canvas-card",
      x: 60,
      y: 60,
      width: 280,
      height: 200,
      zIndex: 1,
      props: {
        canvasDocId: "linked-canvas-doc",
        title: "my canvas",
        description: "test desc",
        authorName: "eve",
        color: 0xf97316,
        createdAt: "2025-06-01",
        modifiedAt: "2025-06-01",
      },
      collapsed: false,
      docId: null,
    });

    const entry = store.getWidget(widgetId);
    expect(entry).toBeTruthy();
    expect(entry!.type).toBe("canvas-card");
    expect(entry!.docId).toBeNull();
    expect(entry!.props.canvasDocId).toBe("linked-canvas-doc");
    expect(entry!.props.title).toBe("my canvas");
    expect(entry!.props.authorName).toBe("eve");
  });

  it("setDocId persists the per-widget doc reference", () => {
    const repo = createTestRepo();
    const store = CanvasStore.create(repo);

    const widgetId = "card-widget-2";
    store.addWidget({
      id: widgetId,
      type: "canvas-card",
      x: 0,
      y: 0,
      width: 280,
      height: 200,
      zIndex: 1,
      props: { canvasDocId: "some-canvas" },
      collapsed: false,
      docId: null,
    });

    // simulate what widget-manager does after creating the per-widget doc
    const perWidgetDoc = repo.create(canvasCardSchema.parse({ canvasDocId: "some-canvas" }));
    store.setDocId(widgetId, perWidgetDoc.documentId);

    const entry = store.getWidget(widgetId);
    expect(entry!.docId).toBe(perWidgetDoc.documentId);

    // props should still be there (setDocId doesn't clear them)
    expect(entry!.props.canvasDocId).toBe("some-canvas");
  });

  it("full create-then-find flow: addWidget → setDocId → read entry → find widget doc", async () => {
    const repo = createTestRepo();
    const store = CanvasStore.create(repo);

    // step 1: router adds canvas-card with props (simulates createCanvasFromNarthex)
    const widgetId = "full-flow-card";
    const props = {
      canvasDocId: "target-canvas",
      title: "full flow test",
      description: "testing the whole chain",
      authorName: "mallory",
      color: 0x8b5cf6,
      createdAt: "2025-06-15",
      modifiedAt: "2025-06-15",
    };

    store.addWidget({
      id: widgetId,
      type: "canvas-card",
      x: 60,
      y: 60,
      width: 280,
      height: 200,
      zIndex: 1,
      props,
      collapsed: false,
      docId: null,
    });

    // step 2: widget-manager mounts — creates per-widget doc from entry.props
    const entry = store.getWidget(widgetId)!;
    expect(entry.docId).toBeNull();

    // this is the exact widget-manager code path:
    const defaults = canvasCardSchema.parse(entry.props ?? {});
    const widgetDocHandle = repo.create(defaults);
    store.setDocId(widgetId, widgetDocHandle.documentId);

    // step 3: verify the per-widget doc has correct data
    const widgetDoc = createWidgetDoc(canvasCardSchema, widgetDocHandle);
    expect(widgetDoc.current.canvasDocId).toBe("target-canvas");
    expect(widgetDoc.current.title).toBe("full flow test");
    expect(widgetDoc.current.authorName).toBe("mallory");

    // step 4: simulate navigate-away-and-back — re-read entry, find widget doc
    const entryAfter = store.getWidget(widgetId)!;
    expect(entryAfter.docId).toBe(widgetDocHandle.documentId);

    const foundHandle = await repo.find(entryAfter.docId as DocumentId);

    const foundDoc = createWidgetDoc(canvasCardSchema, foundHandle);
    expect(foundDoc.current.canvasDocId).toBe("target-canvas");
    expect(foundDoc.current.title).toBe("full flow test");
    expect(foundDoc.current.description).toBe("testing the whole chain");
    expect(foundDoc.current.authorName).toBe("mallory");
    expect(foundDoc.current.color).toBe(0x8b5cf6);
  });

  it("removeWidget then addWidget: fresh widget gets new doc from props", () => {
    const repo = createTestRepo();
    const store = CanvasStore.create(repo);

    // add wizard widget (simulates wizard appearing)
    const wizardId = "wizard-1";
    store.addWidget({
      id: wizardId,
      type: "canvas-wizard",
      x: 100,
      y: 100,
      width: 320,
      height: 340,
      zIndex: 1,
      props: {},
      collapsed: false,
      docId: null,
    });

    // wizard doc is created
    const wizardDefaults = canvasWizardSchema.parse({});
    const wizardDocHandle = repo.create(wizardDefaults);
    store.setDocId(wizardId, wizardDocHandle.documentId);

    // simulate wizard form filled and create clicked:
    // 1. remove wizard
    store.removeWidget(wizardId);
    expect(store.getWidget(wizardId)).toBeNull();

    // 2. add canvas-card with props from the wizard
    const cardId = "card-from-wizard";
    store.addWidget({
      id: cardId,
      type: "canvas-card",
      x: 60,
      y: 60,
      width: 280,
      height: 200,
      zIndex: 1,
      props: {
        canvasDocId: "new-canvas-id",
        title: "wizard-created canvas",
        description: "made via wizard",
        authorName: "alice",
        color: 0xd946ef,
        createdAt: "2025-06-15",
        modifiedAt: "2025-06-15",
      },
      collapsed: false,
      docId: null,
    });

    // 3. widget-manager creates per-widget doc
    const cardEntry = store.getWidget(cardId)!;
    const cardDefaults = canvasCardSchema.parse(cardEntry.props ?? {});
    const cardDocHandle = repo.create(cardDefaults);
    store.setDocId(cardId, cardDocHandle.documentId);

    // verify everything persisted
    const finalEntry = store.getWidget(cardId)!;
    expect(finalEntry.docId).toBe(cardDocHandle.documentId);
    expect(finalEntry.props.title).toBe("wizard-created canvas");

    const cardDoc = createWidgetDoc(canvasCardSchema, cardDocHandle);
    expect(cardDoc.current.title).toBe("wizard-created canvas");
    expect(cardDoc.current.canvasDocId).toBe("new-canvas-id");
    expect(cardDoc.current.authorName).toBe("alice");
  });
});

// ---------------------------------------------------------------------------
// 4. canvas-card schema parses Automerge proxy objects
//    (the read-back-from-automerge code path that might break with proxies)
// ---------------------------------------------------------------------------

describe("canvasCardSchema parsing of Automerge proxy data", () => {
  it("parses data read back from an Automerge doc (proxy objects)", () => {
    const repo = createTestRepo();

    // create a plain automerge doc (not via schema)
    const handle = repo.create<Record<string, unknown>>({
      canvasDocId: "proxy-test",
      title: "proxy title",
      description: "proxy desc",
      previewUrl: "",
      createdAt: "2025-01-01",
      modifiedAt: "2025-01-01",
      authorName: "proxy-author",
      color: 0xef4444,
    });

    // read back — this returns Automerge proxy objects
    const raw = handle.doc();
    expect(raw).toBeTruthy();

    // this is what widget-manager does: parse the proxy through Zod
    const parsed = canvasCardSchema.parse(raw);
    expect(parsed.canvasDocId).toBe("proxy-test");
    expect(parsed.title).toBe("proxy title");
    expect(parsed.authorName).toBe("proxy-author");
    expect(parsed.color).toBe(0xef4444);
  });

  it("parses entry.props read back from a CanvasStore (Automerge proxy)", () => {
    const repo = createTestRepo();
    const store = CanvasStore.create(repo);

    store.addWidget({
      id: "proxy-entry",
      type: "canvas-card",
      x: 0,
      y: 0,
      width: 280,
      height: 200,
      zIndex: 0,
      props: {
        canvasDocId: "proxy-canvas",
        title: "from store proxy",
        color: 0x06b6d4,
      },
      collapsed: false,
      docId: null,
    });

    // read back — entry.props is an Automerge proxy
    const entry = store.getWidget("proxy-entry")!;
    const props = entry.props;

    // this is what widget-manager does
    const defaults = canvasCardSchema.parse(props ?? {});
    expect(defaults.canvasDocId).toBe("proxy-canvas");
    expect(defaults.title).toBe("from store proxy");
    expect(defaults.color).toBe(0x06b6d4);
    // fields not in props should get defaults
    expect(defaults.description).toBe("");
    expect(defaults.authorName).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 5. wizard schema round-trip (sanity check)
// ---------------------------------------------------------------------------

describe("canvas-wizard per-widget doc round-trip", () => {
  it("creates and reads back wizard state via Automerge", () => {
    const repo = createTestRepo();

    const defaults = canvasWizardSchema.parse({});
    const handle = repo.create(defaults);
    const widgetDoc = createWidgetDoc(canvasWizardSchema, handle);

    expect(widgetDoc.current.title).toBe("untitled canvas");
    expect(widgetDoc.current.description).toBe("");
    expect(widgetDoc.current.authorName).toBe("");
    expect(widgetDoc.current.color).toBe(0xd946ef);

    // simulate user filling in the wizard form
    widgetDoc.change((draft) => {
      draft.title = "wizard-filled title";
      draft.description = "wizard desc";
      draft.authorName = "wizard-user";
      draft.color = 0x10b981;
    });

    expect(widgetDoc.current.title).toBe("wizard-filled title");
    expect(widgetDoc.current.description).toBe("wizard desc");
    expect(widgetDoc.current.authorName).toBe("wizard-user");
    expect(widgetDoc.current.color).toBe(0x10b981);
  });
});
