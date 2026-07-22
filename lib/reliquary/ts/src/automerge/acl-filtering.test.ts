// ---------------------------------------------------------------------------
// unit tests for AclFilteringNetworkAdapter / createAclFilteringAdapter /
// createHandleBasedRoleResolver
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Automerge from "@automerge/automerge";
import { NetworkAdapter, type DocumentId, type Message, type PeerId } from "@automerge/automerge-repo";

import {
  AclFilteringNetworkAdapter,
  createAclFilteringAdapter,
  createHandleBasedRoleResolver,
  type AclFilteringOptions,
  type HandleLookup,
} from "./acl-filtering.js";

// ---------------------------------------------------------------------------
// mock: a minimal NetworkAdapter we can drive by hand and spy on.
// ---------------------------------------------------------------------------

class MockAdapter extends NetworkAdapter {
  isReady = vi.fn(() => true);
  whenReady = vi.fn(async () => {});
  connect = vi.fn();
  send = vi.fn();
  disconnect = vi.fn();
}

// ---------------------------------------------------------------------------
// a stand-in role type + read-only predicate, playing the part a
// consuming app's own role model would play (e.g. loam's canvas roles).
// ---------------------------------------------------------------------------

type TestRole = "reader" | "writer" | "admin";
const isReadOnlyRole = (role: TestRole) => role === "reader";

// ---------------------------------------------------------------------------
// helpers: build real automerge sync messages so decode/encode round-trips
// through genuine wasm data, not synthetic garbage bytes (which can hang
// the wasm decoder instead of throwing).
// ---------------------------------------------------------------------------

const DOC_ID = "doc-1" as DocumentId;
const READER_ID = "reader-peer" as PeerId;
const WRITER_ID = "writer-peer" as PeerId;
const LOCAL_ID = "local-peer" as PeerId;

/**
 * run a two-doc sync handshake far enough that the final message from doc1
 * to doc2 actually carries a change (automerge's first couple of sync
 * messages are just heads/have/need - the change payload only shows up
 * once both sides have exchanged state at least once).
 */
function buildSyncMessageWithChange(): Uint8Array {
  let doc1 = Automerge.from({ foo: "bar" });
  let doc2 = Automerge.init<{ foo: string }>();
  let s1 = Automerge.initSyncState();
  let s2 = Automerge.initSyncState();

  const [ns1, msg1] = Automerge.generateSyncMessage(doc1, s1);
  s1 = ns1;
  [doc2, s2] = Automerge.receiveSyncMessage(doc2, s2, msg1!);

  const [ns2, msg2] = Automerge.generateSyncMessage(doc2, s2);
  s2 = ns2;
  [doc1, s1] = Automerge.receiveSyncMessage(doc1, s1, msg2!);

  const [, msg3] = Automerge.generateSyncMessage(doc1, s1);
  return msg3!;
}

function buildSyncMessageWithoutChange(): Uint8Array {
  const doc1 = Automerge.from({ foo: "bar" });
  const s1 = Automerge.initSyncState();
  const [, msg1] = Automerge.generateSyncMessage(doc1, s1);
  return msg1!;
}

function makeSyncMessage(
  data: Uint8Array,
  senderId: PeerId,
  type: "sync" | "request" = "sync"
): Message {
  return {
    type,
    senderId,
    targetId: LOCAL_ID,
    documentId: DOC_ID,
    data,
  } as Message;
}

describe("AclFilteringNetworkAdapter", () => {
  let wrapped: MockAdapter;
  let options: AclFilteringOptions<TestRole>;
  let adapter: AclFilteringNetworkAdapter<TestRole>;

  beforeEach(() => {
    wrapped = new MockAdapter();
    options = {
      resolveRole: vi.fn(() => "writer" as TestRole),
      isReadOnly: isReadOnlyRole,
    };
    adapter = new AclFilteringNetworkAdapter(wrapped, options);
  });

  // -----------------------------------------------------------------------
  // lifecycle proxying
  // -----------------------------------------------------------------------

  describe("lifecycle proxying", () => {
    it("proxies connect() to the wrapped adapter", () => {
      const meta = { isEphemeral: false };
      adapter.connect(LOCAL_ID, meta);

      expect(wrapped.connect).toHaveBeenCalledWith(LOCAL_ID, meta);
      expect(adapter.peerId).toBe(LOCAL_ID);
      expect(adapter.peerMetadata).toBe(meta);
    });

    it("proxies send() to the wrapped adapter unchanged", () => {
      const message = makeSyncMessage(new Uint8Array([1, 2, 3]), WRITER_ID);
      adapter.send(message);

      expect(wrapped.send).toHaveBeenCalledWith(message);
    });

    it("proxies disconnect() to the wrapped adapter", () => {
      adapter.disconnect();
      expect(wrapped.disconnect).toHaveBeenCalled();
    });

    it("proxies isReady() and whenReady() to the wrapped adapter", async () => {
      wrapped.isReady.mockReturnValue(false);
      expect(adapter.isReady()).toBe(false);

      wrapped.isReady.mockReturnValue(true);
      expect(adapter.isReady()).toBe(true);

      await adapter.whenReady();
      expect(wrapped.whenReady).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // event re-emission
  // -----------------------------------------------------------------------

  describe("event re-emission", () => {
    it("re-emits peer-candidate from the wrapped adapter unchanged", () => {
      const listener = vi.fn();
      adapter.on("peer-candidate", listener);

      const payload = { peerId: WRITER_ID, peerMetadata: {} };
      wrapped.emit("peer-candidate", payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it("re-emits peer-disconnected from the wrapped adapter unchanged", () => {
      const listener = vi.fn();
      adapter.on("peer-disconnected", listener);

      const payload = { peerId: WRITER_ID };
      wrapped.emit("peer-disconnected", payload);

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it("re-emits close from the wrapped adapter", () => {
      const listener = vi.fn();
      adapter.on("close", listener);

      wrapped.emit("close");

      expect(listener).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // message filtering
  // -----------------------------------------------------------------------

  describe("message filtering", () => {
    it("passes non-sync/request message types through completely unchanged", () => {
      options = { resolveRole: vi.fn(() => "reader" as TestRole), isReadOnly: isReadOnlyRole };
      adapter = new AclFilteringNetworkAdapter(wrapped, options);

      const listener = vi.fn();
      adapter.on("message", listener);

      const ephemeralMessage = {
        type: "ephemeral",
        senderId: READER_ID,
        targetId: LOCAL_ID,
        documentId: DOC_ID,
        data: new Uint8Array([9, 9, 9]),
      } as unknown as Message;

      wrapped.emit("message", ephemeralMessage);

      expect(listener).toHaveBeenCalledWith(ephemeralMessage);
      expect(options.resolveRole).not.toHaveBeenCalled();
    });

    it("passes sync messages through unchanged for a writer sender", () => {
      options = { resolveRole: vi.fn(() => "writer" as TestRole), isReadOnly: isReadOnlyRole };
      adapter = new AclFilteringNetworkAdapter(wrapped, options);

      const listener = vi.fn();
      adapter.on("message", listener);

      const message = makeSyncMessage(buildSyncMessageWithChange(), WRITER_ID);
      wrapped.emit("message", message);

      expect(listener).toHaveBeenCalledWith(message);
    });

    it("passes sync messages through unchanged for an admin sender", () => {
      options = { resolveRole: vi.fn(() => "admin" as TestRole), isReadOnly: isReadOnlyRole };
      adapter = new AclFilteringNetworkAdapter(wrapped, options);

      const listener = vi.fn();
      adapter.on("message", listener);

      const message = makeSyncMessage(buildSyncMessageWithChange(), WRITER_ID);
      wrapped.emit("message", message);

      expect(listener).toHaveBeenCalledWith(message);
    });

    it("strips changes from a read-only sender's sync message, preserving heads/need/have", () => {
      options = { resolveRole: vi.fn(() => "reader" as TestRole), isReadOnly: isReadOnlyRole };
      adapter = new AclFilteringNetworkAdapter(wrapped, options);

      const listener = vi.fn();
      adapter.on("message", listener);

      const rawData = buildSyncMessageWithChange();
      const originalDecoded = Automerge.decodeSyncMessage(rawData);
      expect(originalDecoded.changes.length).toBeGreaterThan(0);

      const message = makeSyncMessage(rawData, READER_ID);
      wrapped.emit("message", message);

      expect(listener).toHaveBeenCalledTimes(1);
      const emitted = listener.mock.calls[0][0] as Message;

      // not the same object/bytes as the original - it was re-encoded.
      expect(emitted).not.toBe(message);
      expect(emitted.data).not.toBe(rawData);

      const filteredDecoded = Automerge.decodeSyncMessage(emitted.data!);
      expect(filteredDecoded.changes).toHaveLength(0);
      expect(filteredDecoded.heads).toEqual(originalDecoded.heads);
      expect(filteredDecoded.need).toEqual(originalDecoded.need);
      expect(filteredDecoded.have).toEqual(originalDecoded.have);
    });

    it("strips changes from a read-only sender's request message the same way as sync", () => {
      options = { resolveRole: vi.fn(() => "reader" as TestRole), isReadOnly: isReadOnlyRole };
      adapter = new AclFilteringNetworkAdapter(wrapped, options);

      const listener = vi.fn();
      adapter.on("message", listener);

      const rawData = buildSyncMessageWithChange();
      const message = makeSyncMessage(rawData, READER_ID, "request");
      wrapped.emit("message", message);

      const emitted = listener.mock.calls[0][0] as Message;
      expect(Automerge.decodeSyncMessage(emitted.data!).changes).toHaveLength(0);
    });

    it("passes a read-only sender's sync message through unchanged when it carries no changes", () => {
      options = { resolveRole: vi.fn(() => "reader" as TestRole), isReadOnly: isReadOnlyRole };
      adapter = new AclFilteringNetworkAdapter(wrapped, options);

      const listener = vi.fn();
      adapter.on("message", listener);

      const message = makeSyncMessage(buildSyncMessageWithoutChange(), READER_ID);
      wrapped.emit("message", message);

      expect(listener).toHaveBeenCalledWith(message);
    });

    it("passes messages through unchanged when documentId or data is missing", () => {
      const listener = vi.fn();
      adapter.on("message", listener);

      const message = {
        type: "sync",
        senderId: READER_ID,
        targetId: LOCAL_ID,
      } as unknown as Message;

      wrapped.emit("message", message);

      expect(listener).toHaveBeenCalledWith(message);
      expect(options.resolveRole).not.toHaveBeenCalled();
    });

    it("calls resolveRole with the message's documentId and senderId", () => {
      const message = makeSyncMessage(buildSyncMessageWithChange(), WRITER_ID);
      wrapped.emit("message", message);

      expect(options.resolveRole).toHaveBeenCalledWith(DOC_ID, WRITER_ID);
    });

    it("calls onStrip with change count details when changes are stripped", () => {
      const onStrip = vi.fn();
      options = {
        resolveRole: vi.fn(() => "reader" as TestRole),
        isReadOnly: isReadOnlyRole,
        onStrip,
      };
      adapter = new AclFilteringNetworkAdapter(wrapped, options);

      const message = makeSyncMessage(buildSyncMessageWithChange(), READER_ID);
      wrapped.emit("message", message);

      expect(onStrip).toHaveBeenCalledWith({
        documentId: DOC_ID,
        senderId: READER_ID,
        changeCount: expect.any(Number),
      });
      expect((onStrip.mock.calls[0][0] as { changeCount: number }).changeCount).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // createAclFilteringAdapter factory
  // -----------------------------------------------------------------------

  describe("createAclFilteringAdapter", () => {
    it("builds an AclFilteringNetworkAdapter wrapping the given adapter", () => {
      const built = createAclFilteringAdapter(wrapped, options);
      expect(built).toBeInstanceOf(AclFilteringNetworkAdapter);

      const listener = vi.fn();
      built.on("message", listener);

      const message = makeSyncMessage(buildSyncMessageWithChange(), WRITER_ID);
      wrapped.emit("message", message);

      expect(listener).toHaveBeenCalledWith(message);
    });
  });
});

// ---------------------------------------------------------------------------
// createHandleBasedRoleResolver
// ---------------------------------------------------------------------------

describe("createHandleBasedRoleResolver", () => {
  function makeFakeRepo(
    handles: Record<string, { isReady: () => boolean; doc: () => unknown }>
  ): HandleLookup {
    return { handles };
  }

  it("defaults to the default role when the repo has no cached handle for the document", () => {
    const repo = makeFakeRepo({});
    const readRole = vi.fn(() => "writer" as TestRole);
    const resolver = createHandleBasedRoleResolver(repo, readRole, "reader" as TestRole);

    expect(resolver(DOC_ID, WRITER_ID)).toBe("reader");
    expect(readRole).not.toHaveBeenCalled();
  });

  it("defaults to the default role when the cached handle isn't ready yet", () => {
    const repo = makeFakeRepo({
      [DOC_ID]: { isReady: () => false, doc: () => ({}) },
    });
    const readRole = vi.fn(() => "writer" as TestRole);
    const resolver = createHandleBasedRoleResolver(repo, readRole, "reader" as TestRole);

    expect(resolver(DOC_ID, WRITER_ID)).toBe("reader");
    expect(readRole).not.toHaveBeenCalled();
  });

  it("delegates to readRole with the handle's current doc value once ready", () => {
    const doc = { acl: { [WRITER_ID]: { role: "writer" } } };
    const repo = makeFakeRepo({
      [DOC_ID]: { isReady: () => true, doc: () => doc },
    });
    const readRole = vi.fn(
      (d: unknown, senderId: PeerId) =>
        ((d as { acl?: Record<string, { role?: TestRole }> }).acl?.[senderId]?.role ?? "reader")
    );
    const resolver = createHandleBasedRoleResolver(repo, readRole, "reader" as TestRole);

    expect(resolver(DOC_ID, WRITER_ID)).toBe("writer");
    expect(readRole).toHaveBeenCalledWith(doc, WRITER_ID);
  });

  it("leaves all role-shape validation and fallback logic to readRole", () => {
    const doc = { acl: { [WRITER_ID]: { role: "super-admin" } } };
    const repo = makeFakeRepo({
      [DOC_ID]: { isReady: () => true, doc: () => doc },
    });
    // readRole itself decides an unrecognized role value falls back to "reader"
    const readRole = vi.fn((): TestRole => "reader");
    const resolver = createHandleBasedRoleResolver(repo, readRole, "reader" as TestRole);

    expect(resolver(DOC_ID, WRITER_ID)).toBe("reader");
  });
});
