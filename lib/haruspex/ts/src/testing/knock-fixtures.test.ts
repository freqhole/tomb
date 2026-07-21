import { describe, expect, it } from "vitest";

import {
  makeKnockDecision,
  makeKnockRecord,
  makeKnockRecords,
  makeKnockScope,
} from "./knock-fixtures.js";

describe("makeKnockScope", () => {
  it("creates account and browse scopes without extra fields", () => {
    expect(makeKnockScope("account")).toEqual({ kind: "account" });
    expect(makeKnockScope("browse")).toEqual({ kind: "browse" });
  });

  it("creates resource scopes with a resource id", () => {
    expect(makeKnockScope("resource", "doc-1")).toEqual({
      kind: "resource",
      resourceId: "doc-1",
    });
  });

  it("defaults resource id when omitted", () => {
    const scope = makeKnockScope("resource");
    expect(scope.kind).toBe("resource");
    expect(scope.kind === "resource" && scope.resourceId).toBe("doc-1");
  });
});

describe("makeKnockRecord", () => {
  it("produces a valid knock record with default values", () => {
    const record = makeKnockRecord();
    expect(record.id).toMatch(/^knock-/);
    expect(record.nodeId).toHaveLength(64);
    expect(record.status).toBe("pending");
    expect(record.decisions).toEqual([]);
  });

  it("accepts overrides for any field", () => {
    const record = makeKnockRecord({
      nodeId: "custom".padEnd(64, "0"),
      status: "accepted",
      message: "let me in",
    });
    expect(record.nodeId).toBe("custom".padEnd(64, "0"));
    expect(record.status).toBe("accepted");
    expect(record.message).toBe("let me in");
  });
});

describe("makeKnockDecision", () => {
  it("creates an accepted decision with optional role", () => {
    const decision = makeKnockDecision("accepted", "node-id", 5000, "member");
    expect(decision.outcome).toBe("accepted");
    expect(decision.byNodeId).toBe("node-id");
    expect(decision.at).toBe(5000);
    expect(decision.grantedRole).toBe("member");
  });

  it("omits grantedRole when not provided", () => {
    const decision = makeKnockDecision("denied");
    expect(decision.outcome).toBe("denied");
    expect("grantedRole" in decision).toBe(false);
  });
});

describe("makeKnockRecords", () => {
  it("creates a batch of distinct knock records", () => {
    const records = makeKnockRecords(3);
    expect(records).toHaveLength(3);
    const nodeIds = records.map((r) => r.nodeId);
    expect(new Set(nodeIds).size).toBe(3);
  });

  it("applies shared overrides to all records", () => {
    const records = makeKnockRecords(2, { direction: "inbound", message: "hi" });
    expect(records.every((r) => r.direction === "inbound")).toBe(true);
    expect(records.every((r) => r.message === "hi")).toBe(true);
  });
});
