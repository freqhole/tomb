import { onlineManager } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "./queryClient";

afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
});

describe("offline local library queries", () => {
  it("loads uncached local data and refetches it without a network", async () => {
    onlineManager.setOnline(false);
    const queryFn = vi.fn().mockResolvedValue(["local song", "local video"]);
    const options = { queryKey: ["offline-library"], queryFn, retry: false };
    expect(await queryClient.fetchQuery(options)).toEqual(["local song", "local video"]);
    await queryClient.invalidateQueries({ queryKey: options.queryKey });
    await queryClient.fetchQuery(options);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("runs local mutations offline rather than leaving them paused", async () => {
    onlineManager.setOnline(false);
    const mutationFn = vi.fn().mockResolvedValue("saved locally");
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn });
    expect(await mutation.execute(undefined)).toBe("saved locally");
    expect(mutationFn).toHaveBeenCalledOnce();
  });

  it("still reports remote failures instead of returning empty library data", async () => {
    onlineManager.setOnline(false);
    await expect(
      queryClient.fetchQuery({
        queryKey: ["unreachable-remote"],
        queryFn: () => Promise.reject(new Error("remote unavailable")),
        retry: false,
      })
    ).rejects.toThrow("remote unavailable");
  });
});
