// tests for the http polling fallback's snapshot-diffing state machine.
//
// pollingJobEvents synthesizes status_changed/stage events by diffing
// consecutive snapshots against a retained baseline (`prev`). these
// tests exist because that diffing logic previously had a real bug: a
// transient snapshot fetch failure wiped `prev` entirely, causing every
// still-active job to spuriously re-announce as "new" (from: null) on
// the next successful poll even though nothing had actually changed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pollingJobEvents,
  POLL_INTERVAL_FALLBACK_MS,
  type Transport,
  type TransportResponse,
} from "./transport.js";
import type { JobStateSnapshot } from "./codegen/schema.js";

function snapshot(
  overrides: Partial<JobStateSnapshot> & Pick<JobStateSnapshot, "job_id">,
): JobStateSnapshot {
  return {
    session_id: null,
    job_type: "ScanDirectory",
    status: "pending",
    entity_ref: null,
    created_by: null,
    last_stage: null,
    last_message: null,
    updated_at: 0,
    ...overrides,
  };
}

/** a fake Transport whose `request` returns one canned snapshot list (or
 *  throws) per call, in order. the last entry repeats for any extra calls. */
function fakeTransport(responses: Array<JobStateSnapshot[] | Error>): Transport {
  let call = 0;
  const request = vi.fn(async (): Promise<TransportResponse> => {
    const entry = responses[Math.min(call, responses.length - 1)];
    call++;
    if (entry instanceof Error) throw entry;
    return { status: 200, body: JSON.stringify({ success: true, data: entry }) };
  });
  return {
    request,
    upload: vi.fn(),
    fetchBlob: vi.fn(),
    getBlobUrl: vi.fn(),
  } as unknown as Transport;
}

/** advances the fake poll-interval timer `count` times in sequence,
 *  fully draining the microtask queue between each advance. */
async function advanceTicks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_FALLBACK_MS);
  }
}

describe("pollingJobEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the first tick only seeds the baseline - no event for an already-known job", async () => {
    const transport = fakeTransport([
      [snapshot({ job_id: "job-a", status: "running" })],
      [snapshot({ job_id: "job-a", status: "completed" })],
    ]);
    const iter = pollingJobEvents(transport);
    const nextPromise = iter.next();

    await advanceTicks(1);
    const result = await nextPromise;

    expect(result.done).toBe(false);
    expect(result.value).toMatchObject({
      kind: "status_changed",
      job_id: "job-a",
      from: "running",
      to: "completed",
    });
  });

  it("a job appearing after the baseline yields status_changed with from: null", async () => {
    const transport = fakeTransport([
      [],
      [snapshot({ job_id: "job-a", status: "running" })],
    ]);
    const iter = pollingJobEvents(transport);
    const nextPromise = iter.next();

    await advanceTicks(1);
    const result = await nextPromise;

    expect(result.value).toMatchObject({
      kind: "status_changed",
      job_id: "job-a",
      from: null,
      to: "running",
    });
  });

  it("a stage/message change yields a stage event", async () => {
    const transport = fakeTransport([
      [snapshot({ job_id: "job-a", status: "running", last_stage: "scanning" })],
      [
        snapshot({
          job_id: "job-a",
          status: "running",
          last_stage: "importing",
          last_message: "42 files",
        }),
      ],
    ]);
    const iter = pollingJobEvents(transport);
    const nextPromise = iter.next();

    await advanceTicks(1);
    const result = await nextPromise;

    expect(result.value).toMatchObject({
      kind: "stage",
      job_id: "job-a",
      stage: "importing",
      message: "42 files",
    });
  });

  it("a transient fetch failure between two ticks does not wipe tracked state (regression)", async () => {
    const transport = fakeTransport([
      [snapshot({ job_id: "job-a", status: "running" })], // tick 1: seed
      new Error("network blip"), // tick 2: transient failure
      [snapshot({ job_id: "job-a", status: "running" })], // tick 3: unchanged
      [snapshot({ job_id: "job-a", status: "completed" })], // tick 4: the only real change
    ]);
    const iter = pollingJobEvents(transport);
    const nextPromise = iter.next();

    // if the failed tick wiped `prev`, job-a would look "new" again on
    // tick 3 (an unchanged snapshot) and this promise would already have
    // resolved with a spurious `from: null` event after just 2 advances.
    await advanceTicks(3);
    const result = await nextPromise;

    expect(result.value).toMatchObject({
      kind: "status_changed",
      job_id: "job-a",
      from: "running",
      to: "completed",
    });
  });

  it("a disappearing job_id is silently dropped, not yielded", async () => {
    const transport = fakeTransport([
      [snapshot({ job_id: "job-a", status: "completed" })],
      [], // job-a no longer present
      [snapshot({ job_id: "job-b", status: "running" })],
    ]);
    const iter = pollingJobEvents(transport);
    const nextPromise = iter.next();

    await advanceTicks(2);
    const result = await nextPromise;

    // the only event ever produced is job-b appearing - job-a's
    // disappearance after tick 2 produced nothing.
    expect(result.value).toMatchObject({
      kind: "status_changed",
      job_id: "job-b",
      from: null,
      to: "running",
    });
  });

  it("stops promptly when the abort signal fires", async () => {
    const controller = new AbortController();
    const transport = fakeTransport([[snapshot({ job_id: "job-a", status: "running" })]]);
    const iter = pollingJobEvents(transport, undefined, controller.signal);

    const nextPromise = iter.next();
    controller.abort();
    await advanceTicks(1);
    const result = await nextPromise;

    expect(result.done).toBe(true);
  });
});
