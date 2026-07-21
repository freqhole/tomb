import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearEndpointAdapter,
  getEndpointState,
  onEndpointStateChange,
  registerEndpointAdapter,
  restartEndpoint,
  stopEndpoint,
  type EndpointAdapter,
  type EndpointState,
} from "./endpoint-control.js";

function makeAdapter(initial: EndpointState = "online") {
  let state = initial;
  const handlers = new Set<(state: EndpointState) => void>();
  const adapter: EndpointAdapter = {
    stop: vi.fn(() => {
      state = "off";
      for (const h of handlers) h(state);
    }),
    restart: vi.fn(async () => {
      state = "online";
      for (const h of handlers) h(state);
    }),
    getEndpointState: () => state,
    onEndpointStateChange: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return adapter;
}

afterEach(() => {
  clearEndpointAdapter();
});

describe("endpoint-control", () => {
  it("reports 'off' when no adapter is registered", () => {
    expect(getEndpointState()).toBe("off");
  });

  it("no-ops stop/restart/subscribe when no adapter is registered", async () => {
    expect(() => stopEndpoint()).not.toThrow();
    await expect(restartEndpoint()).resolves.toBeUndefined();
    const unsubscribe = onEndpointStateChange(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it("delegates state reads to the registered adapter", () => {
    const adapter = makeAdapter("online");
    registerEndpointAdapter(adapter);
    expect(getEndpointState()).toBe("online");
  });

  it("delegates stop/restart to the registered adapter", async () => {
    const adapter = makeAdapter("online");
    registerEndpointAdapter(adapter);

    stopEndpoint();
    expect(adapter.stop).toHaveBeenCalledOnce();
    expect(getEndpointState()).toBe("off");

    await restartEndpoint();
    expect(adapter.restart).toHaveBeenCalledOnce();
    expect(getEndpointState()).toBe("online");
  });

  it("subscribes to state changes through the registered adapter", () => {
    const adapter = makeAdapter("online");
    registerEndpointAdapter(adapter);

    const seen: EndpointState[] = [];
    const unsubscribe = onEndpointStateChange((state) => seen.push(state));

    stopEndpoint();
    expect(seen).toEqual(["off"]);

    unsubscribe();
    void restartEndpoint();
  });
});
