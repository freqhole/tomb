// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BlobReferenceMaintenance from "./BlobReferenceMaintenance";

const mock = vi.hoisted(() => ({
  dispatch: vi.fn(),
  current: undefined as
    | undefined
    | (() => {
        kind: string;
        peerAddr?: string;
      }),
}));
vi.mock("../admin/context", () => ({
  useAdminTransport: () => ({ current: () => mock.current!(), dispatchOrThrow: mock.dispatch }),
}));

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function mount(kind = "local") {
  const [target, setTarget] = createSignal({
    kind,
    peerAddr: kind === "remote" ? "pi" : undefined,
  });
  mock.current = target;
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <BlobReferenceMaintenance />, host);
  return setTarget;
}
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  button!.click();
}
const job = (status: string, result: unknown = null, error_message: string | null = null) => ({
  id: "audit-1",
  status,
  result: result === null ? null : JSON.stringify(result),
  error_message,
});
beforeEach(() => {
  vi.useFakeTimers();
  mock.dispatch.mockReset();
});
afterEach(() => {
  dispose?.();
  host.remove();
  vi.useRealTimers();
});

describe("blob reference maintenance", () => {
  it.each(["local", "remote"])("queues explicit audit and repair modes for %s", async (kind) => {
    mock.dispatch.mockImplementation(async (command: string) =>
      command === "maintenance_audit_blob_references" ? job("Pending") : null,
    );
    mount(kind);
    await settle();
    click("audit only");
    await settle();
    expect(mock.dispatch).toHaveBeenCalledWith("maintenance_audit_blob_references", {
      repair: false,
    });
    click("audit and repair");
    await settle();
    expect(mock.dispatch).toHaveBeenCalledWith("maintenance_audit_blob_references", {
      repair: true,
    });
  });

  it("restores a running job, polls progress and displays the completed result", async () => {
    mock.dispatch
      .mockResolvedValueOnce(job("Running", { checked: 1, total: 3 }))
      .mockResolvedValueOnce(job("Completed", { repair: true, entries: [{ error: null }] }));
    mount();
    await settle();
    expect(host.textContent).toContain("checked 1 of 3 references");
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(host.textContent).toContain("1 references verified and repaired");
    expect(mock.dispatch).toHaveBeenLastCalledWith("maintenance_blob_reference_status", {
      job_id: "audit-1",
    });
  });

  it("shows failed reference details rather than a successful audit", async () => {
    mock.dispatch.mockResolvedValue(
      job("Failed", [{ detail: "missing" }], "1 reference unresolved: disk missing"),
    );
    mount();
    await settle();
    expect(host.textContent).toContain("disk missing");
    expect(host.textContent).not.toContain("references verified");
  });

  it("surfaces queue errors", async () => {
    mock.dispatch.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    mount();
    await settle();
    click("audit and repair");
    await settle();
    expect(host.textContent).toContain("could not queue reference job: Error: offline");
  });

  it("discards stale responses when the admin target changes", async () => {
    let resolve!: (value: unknown) => void;
    mock.dispatch
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(null);
    const setTarget = mount();
    await settle();
    setTarget({ kind: "remote", peerAddr: "other-pi" });
    await settle();
    resolve(job("Running", { checked: 9, total: 10 }));
    await settle();
    expect(host.textContent).not.toContain("checked 9");
    expect(vi.getTimerCount()).toBe(0);
  });
});
