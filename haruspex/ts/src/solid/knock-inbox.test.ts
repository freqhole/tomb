import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createKnockInbox, type KnockInboxDeps } from "./knock-inbox.js";

interface Row {
  id: string;
  status: string;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeDeps(overrides: Partial<KnockInboxDeps<Row>> = {}): KnockInboxDeps<Row> {
  return {
    listKnocks: vi.fn().mockResolvedValue([{ id: "1", status: "pending" }]),
    acceptKnock: vi.fn().mockResolvedValue(undefined),
    rejectKnock: vi.fn().mockResolvedValue(undefined),
    deleteKnock: vi.fn().mockResolvedValue(undefined),
    getId: (row) => row.id,
    ...overrides,
  };
}

describe("createKnockInbox", () => {
  it("lists knocks on creation with includeAll defaulting to false", async () => {
    await createRoot(async (dispose) => {
      const listKnocks = vi.fn().mockResolvedValue([]);
      createKnockInbox(makeDeps({ listKnocks }));
      await flush();
      expect(listKnocks).toHaveBeenCalledWith(false);
      dispose();
    });
  });

  it("re-lists with includeAll: true when the toggle is set", async () => {
    await createRoot(async (dispose) => {
      const listKnocks = vi.fn().mockResolvedValue([]);
      const inbox = createKnockInbox(makeDeps({ listKnocks }));
      await flush();
      inbox.setIncludeAll(true);
      await flush();
      expect(listKnocks).toHaveBeenLastCalledWith(true);
      dispose();
    });
  });

  it("populates knocks() once the list resolves", async () => {
    await createRoot(async (dispose) => {
      const inbox = createKnockInbox(makeDeps());
      await flush();
      expect(inbox.knocks()).toEqual([{ id: "1", status: "pending" }]);
      dispose();
    });
  });

  it("accept sets accepting(id) during the call, clears it after, and refetches", async () => {
    await createRoot(async (dispose) => {
      const acceptKnock = vi.fn().mockResolvedValue(undefined);
      const onChanged = vi.fn();
      const listKnocks = vi.fn().mockResolvedValue([{ id: "1", status: "pending" }]);
      const inbox = createKnockInbox(makeDeps({ acceptKnock, onChanged, listKnocks }));
      await flush();

      const row = { id: "1", status: "pending" };
      const promise = inbox.accept(row, { role: "viewer" });
      expect(inbox.accepting()).toBe("1");
      await promise;

      expect(acceptKnock).toHaveBeenCalledWith(row, { role: "viewer" });
      expect(inbox.accepting()).toBeNull();
      expect(onChanged).toHaveBeenCalled();
      dispose();
    });
  });

  it("accept records a row error and does not call onChanged when acceptKnock throws", async () => {
    await createRoot(async (dispose) => {
      const acceptKnock = vi.fn().mockRejectedValue(new Error("already resolved"));
      const onChanged = vi.fn();
      const onActionError = vi.fn();
      const inbox = createKnockInbox(makeDeps({ acceptKnock, onChanged, onActionError }));
      await flush();

      const row = { id: "1", status: "pending" };
      await inbox.accept(row, { role: "viewer" });

      expect(inbox.rowErrors()["1"]).toEqual([{ action: "accept", detail: "already resolved" }]);
      expect(onChanged).not.toHaveBeenCalled();
      expect(onActionError).toHaveBeenCalledWith("accept", row, expect.any(Error));
      dispose();
    });
  });

  it("clearRowError removes just the given row's errors", async () => {
    await createRoot(async (dispose) => {
      const acceptKnock = vi.fn().mockRejectedValue(new Error("boom"));
      const inbox = createKnockInbox(makeDeps({ acceptKnock }));
      await flush();

      await inbox.accept({ id: "1", status: "pending" }, { role: "viewer" });
      expect(inbox.rowErrors()["1"]).toBeDefined();

      inbox.clearRowError("1");
      expect(inbox.rowErrors()["1"]).toBeUndefined();
      dispose();
    });
  });

  it("reject and remove wire through to their respective deps", async () => {
    await createRoot(async (dispose) => {
      const rejectKnock = vi.fn().mockResolvedValue(undefined);
      const deleteKnock = vi.fn().mockResolvedValue(undefined);
      const inbox = createKnockInbox(makeDeps({ rejectKnock, deleteKnock }));
      await flush();

      const row = { id: "1", status: "pending" };
      await inbox.reject(row);
      expect(rejectKnock).toHaveBeenCalledWith(row);
      expect(inbox.rejecting()).toBeNull();

      await inbox.remove(row);
      expect(deleteKnock).toHaveBeenCalledWith(row);
      expect(inbox.deleting()).toBeNull();
      dispose();
    });
  });

  it("rejectAll is a no-op when rejectAllKnocks isn't provided", async () => {
    await createRoot(async (dispose) => {
      const inbox = createKnockInbox(makeDeps());
      await flush();
      await expect(inbox.rejectAll()).resolves.toBeUndefined();
      dispose();
    });
  });

  it("rejectAll calls the provided rejectAllKnocks and refetches", async () => {
    await createRoot(async (dispose) => {
      const rejectAllKnocks = vi.fn().mockResolvedValue({ rejected: 3 });
      const onChanged = vi.fn();
      const onActionSuccess = vi.fn();
      const inbox = createKnockInbox(makeDeps({ rejectAllKnocks, onChanged, onActionSuccess }));
      await flush();

      await inbox.rejectAll();

      expect(rejectAllKnocks).toHaveBeenCalled();
      expect(onChanged).toHaveBeenCalled();
      expect(onActionSuccess).toHaveBeenCalledWith("rejectAll", null, { rejected: 3 });
      dispose();
    });
  });

  it("uses a custom mapError when provided", async () => {
    await createRoot(async (dispose) => {
      const acceptKnock = vi.fn().mockRejectedValue({ title: "conflict", detail: "already taken" });
      const mapError = vi.fn(() => [{ action: "accept", title: "conflict", detail: "already taken" }]);
      const inbox = createKnockInbox(makeDeps({ acceptKnock, mapError }));
      await flush();

      await inbox.accept({ id: "1", status: "pending" }, { role: "viewer" });

      expect(mapError).toHaveBeenCalled();
      expect(inbox.rowErrors()["1"]).toEqual([
        { action: "accept", title: "conflict", detail: "already taken" },
      ]);
      dispose();
    });
  });

  it("list failures surface via onActionError and leave knocks() empty", async () => {
    await createRoot(async (dispose) => {
      const listKnocks = vi.fn().mockRejectedValue(new Error("offline"));
      const onActionError = vi.fn();
      const inbox = createKnockInbox(makeDeps({ listKnocks, onActionError }));
      await flush();

      expect(inbox.knocks()).toEqual([]);
      expect(onActionError).toHaveBeenCalledWith("list", null, expect.any(Error));
      dispose();
    });
  });
});
