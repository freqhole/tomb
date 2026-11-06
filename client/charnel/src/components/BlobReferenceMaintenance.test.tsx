// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import BlobReferenceMaintenance from "./BlobReferenceMaintenance";
import JobProgress from "./JobProgress";
import type { TrackedJob } from "../jobs";

const mock = vi.hoisted(() => ({
  dispatch: vi.fn(),
  jobs: undefined as undefined | (() => TrackedJob[]),
}));
vi.mock("../jobs", () => ({
  useJobs: () => ({
    jobs: () => mock.jobs!(),
    connected: () => true,
    error: () => "",
    dispatch: mock.dispatch,
  }),
}));

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function mount(initial: TrackedJob[] = []) {
  mock.dispatch.mockResolvedValue({ success: true, message: "queued" });
  const [jobs, setJobs] = createSignal(initial);
  mock.jobs = jobs;
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <>
        <BlobReferenceMaintenance />
        <JobProgress filter={(job) => job.job_type === "AuditBlobReferences"} />
      </>
    ),
    host,
  );
  return setJobs;
}
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  button!.click();
}
function job(status: string): TrackedJob {
  return {
    job_id: "audit",
    job_type: "AuditBlobReferences",
    session_id: null,
    status,
    last_message: null,
  };
}
afterEach(() => {
  dispose?.();
  host.remove();
  mock.dispatch.mockReset();
  vi.useRealTimers();
});

describe("blob reference maintenance", () => {
  it("dispatches audit and repair modes through shared job tracking", async () => {
    mount();
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

  it("uses shared progress and does not start a status polling timer", async () => {
    vi.useFakeTimers();
    const setJobs = mount([{ ...job("running"), checked: 1, total: 3 }]);
    expect(host.textContent).toContain("1 / 3");
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    setJobs([job("completed")]);
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
    expect(host.textContent).toContain("inspect all jobs and results");
    expect(vi.getTimerCount()).toBe(0);
    expect(mock.dispatch).not.toHaveBeenCalled();
  });

  it("renders failures through the same related-job component", async () => {
    mount([{ ...job("failed"), errors: [{ detail: "disk missing" }] }]);
    expect(host.textContent).toContain("disk missing");
    expect(host.textContent).not.toContain("references verified");
    expect(host.querySelector('a[href="#/jobs?job=audit"]')).not.toBeNull();
  });

  it("surfaces queue failures explicitly", async () => {
    mount();
    mock.dispatch.mockRejectedValueOnce(new Error("offline"));
    click("audit and repair");
    await settle();
    expect(host.textContent).toContain("could not queue reference job: Error: offline");
  });
});
