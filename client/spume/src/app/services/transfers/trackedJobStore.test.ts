// tests for the generic tracked-job store factory (phase 3b of
// docs/transfer-unification-plan.md) - the shared mechanism
// music/import/remoteImport.ts and video/import/remoteImport.ts both now
// build their own job list on top of.

import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createTrackedJobStore } from "./trackedJobStore";

interface TestJob {
  id: string;
  status: string;
  label: string;
  error?: string;
  tags?: string[];
}

describe("createTrackedJobStore", () => {
  it("starts empty", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      expect(store.getJobs()).toEqual([]);
      dispose();
    });
  });

  it("addJob appends without disturbing existing rows", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      store.addJob({ id: "a", status: "pending", label: "A" });
      store.addJob({ id: "b", status: "pending", label: "B" });
      expect(store.getJobs().map((j) => j.id)).toEqual(["a", "b"]);
      dispose();
    });
  });

  it("updateJob patches only the matching row by id", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      store.addJob({ id: "a", status: "pending", label: "A" });
      store.addJob({ id: "b", status: "pending", label: "B" });
      store.updateJob("a", { status: "completed" });
      expect(store.getJobs().find((j) => j.id === "a")?.status).toBe("completed");
      expect(store.getJobs().find((j) => j.id === "b")?.status).toBe("pending");
      dispose();
    });
  });

  it("updateJob with a function mutator can read-then-write (e.g. append to an array)", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      store.addJob({ id: "a", status: "pending", label: "A", tags: ["x"] });
      store.updateJob("a", (j) => {
        j.tags = [...(j.tags ?? []), "y"];
      });
      expect(store.getJobs().find((j) => j.id === "a")?.tags).toEqual(["x", "y"]);
      dispose();
    });
  });

  it("updateJob is a no-op for an unknown id", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      store.addJob({ id: "a", status: "pending", label: "A" });
      expect(() => store.updateJob("missing", { status: "failed" })).not.toThrow();
      expect(store.getJobs()).toHaveLength(1);
      dispose();
    });
  });

  it("removeJob removes only the matching row", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      store.addJob({ id: "a", status: "pending", label: "A" });
      store.addJob({ id: "b", status: "pending", label: "B" });
      store.removeJob("a");
      expect(store.getJobs().map((j) => j.id)).toEqual(["b"]);
      dispose();
    });
  });

  it("clearJobsWhere removes every matching row", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      store.addJob({ id: "a", status: "completed", label: "A" });
      store.addJob({ id: "b", status: "pending", label: "B" });
      store.addJob({ id: "c", status: "completed", label: "C" });
      store.clearJobsWhere((j) => j.status === "completed");
      expect(store.getJobs().map((j) => j.id)).toEqual(["b"]);
      dispose();
    });
  });

  it("clearAllJobs empties the store", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      store.addJob({ id: "a", status: "pending", label: "A" });
      store.clearAllJobs();
      expect(store.getJobs()).toEqual([]);
      dispose();
    });
  });

  it("nextId generates a stable, incrementing sequence per store instance", () => {
    createRoot((dispose) => {
      const store = createTrackedJobStore<TestJob>();
      expect(store.nextId("upload")).toBe("upload-1");
      expect(store.nextId("upload")).toBe("upload-2");
      dispose();
    });
  });

  it("two store instances have independent counters and job lists", () => {
    createRoot((dispose) => {
      const musicStore = createTrackedJobStore<TestJob>();
      const videoStore = createTrackedJobStore<TestJob>();
      musicStore.addJob({ id: "a", status: "pending", label: "music job" });
      expect(musicStore.getJobs()).toHaveLength(1);
      expect(videoStore.getJobs()).toHaveLength(0);
      expect(musicStore.nextId("job")).toBe("job-1");
      expect(videoStore.nextId("job")).toBe("job-1");
      dispose();
    });
  });
});
