// @vitest-environment happy-dom

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBlobUrl } from "./blob-url.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubObjectUrl() {
  let counter = 0;
  const created: string[] = [];
  const revoked: string[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => {
      const url = `blob:mock-${++counter}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });
  return { created, revoked };
}

describe("createBlobUrl", () => {
  it("resolves to an object url for a non-null blob", async () => {
    const { created } = stubObjectUrl();
    let dispose = () => {};
    let url!: ReturnType<typeof createBlobUrl>;

    createRoot((d) => {
      dispose = d;
      url = createBlobUrl(async () => new Blob(["hello"]));
    });

    await vi.waitFor(() => expect(url.loading).toBe(false));
    expect(url()).toBe(created[0]);
    dispose();
  });

  it("resolves to null for a null blob", async () => {
    stubObjectUrl();
    let dispose = () => {};
    let resource!: ReturnType<typeof createBlobUrl>;

    createRoot((d) => {
      dispose = d;
      resource = createBlobUrl(async () => null);
    });

    await vi.waitFor(() => expect(resource.loading).toBe(false));
    expect(resource()).toBeNull();
    dispose();
  });

  it("revokes the object url once the owning root is disposed", async () => {
    const { created, revoked } = stubObjectUrl();
    let dispose = () => {};
    let url!: ReturnType<typeof createBlobUrl>;

    createRoot((d) => {
      dispose = d;
      url = createBlobUrl(async () => new Blob(["hello"]));
    });

    await vi.waitFor(() => expect(url.loading).toBe(false));
    expect(revoked).not.toContain(created[0]);

    dispose();
    expect(revoked).toContain(created[0]);
  });
});
