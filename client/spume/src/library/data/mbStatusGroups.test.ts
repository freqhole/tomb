// unit tests for mbStatusGroups helper module.
// focuses on:
//   1. statusGroupOf — exhaustive coverage of every enum value
//   2. isDone — only "confirmed" and "enriched" return true
//   3. MB_STATUS_GROUP_MEMBERS — every enum value appears exactly once

import { describe, expect, it } from "vitest";
import type { MbLookupStatus } from "freqhole-api-client";
import { MB_LOOKUP_STATUSES } from "./albumMetadata";
import {
  isDone,
  isInFlight,
  MB_STATUS_GROUP_MEMBERS,
  MB_STATUS_GROUPS,
  needsReview,
  statusGroupOf,
  type MbStatusGroup,
} from "./mbStatusGroups";

describe("statusGroupOf", () => {
  it("returns 'untouched' for null", () => {
    expect(statusGroupOf(null)).toBe("untouched");
  });

  it("returns 'untouched' for undefined", () => {
    expect(statusGroupOf(undefined)).toBe("untouched");
  });

  it("maps every mb_lookup_status value to a known group", () => {
    for (const s of MB_LOOKUP_STATUSES) {
      const g = statusGroupOf(s);
      expect(MB_STATUS_GROUPS).toContain(g);
    }
  });

  it("maps not_attempted → untouched", () => {
    expect(statusGroupOf("not_attempted")).toBe("untouched");
  });

  it("maps queued, searching, fetching_detail, auto_applying → in_flight", () => {
    const expected: MbLookupStatus[] = ["queued", "searching", "fetching_detail", "auto_applying"];
    for (const s of expected) {
      expect(statusGroupOf(s)).toBe("in_flight");
    }
  });

  it("maps candidates, needs_review → needs_attention", () => {
    expect(statusGroupOf("candidates")).toBe("needs_attention");
    expect(statusGroupOf("needs_review")).toBe("needs_attention");
  });

  it("maps confirmed, enriched → done", () => {
    expect(statusGroupOf("confirmed")).toBe("done");
    expect(statusGroupOf("enriched")).toBe("done");
  });

  it("maps skipped, rejected → deferred", () => {
    expect(statusGroupOf("skipped")).toBe("deferred");
    expect(statusGroupOf("rejected")).toBe("deferred");
  });

  it("maps error, no_match → error", () => {
    expect(statusGroupOf("error")).toBe("error");
    expect(statusGroupOf("no_match")).toBe("error");
  });
});

describe("isDone", () => {
  it("returns true for 'confirmed'", () => {
    expect(isDone("confirmed")).toBe(true);
  });

  it("returns true for 'enriched'", () => {
    expect(isDone("enriched")).toBe(true);
  });

  it("returns false for every other status", () => {
    const notDone = MB_LOOKUP_STATUSES.filter((s) => s !== "confirmed" && s !== "enriched");
    for (const s of notDone) {
      expect(isDone(s), `expected isDone(${s}) to be false`).toBe(false);
    }
  });

  it("returns false for null/undefined", () => {
    expect(isDone(null)).toBe(false);
    expect(isDone(undefined)).toBe(false);
  });
});

describe("isInFlight", () => {
  const inFlightStatuses: MbLookupStatus[] = [
    "queued",
    "searching",
    "fetching_detail",
    "auto_applying",
  ];

  it("returns true for in-flight statuses", () => {
    for (const s of inFlightStatuses) {
      expect(isInFlight(s), `expected isInFlight(${s}) to be true`).toBe(true);
    }
  });

  it("returns false for non-in-flight statuses", () => {
    const others = MB_LOOKUP_STATUSES.filter((s) => !inFlightStatuses.includes(s));
    for (const s of others) {
      expect(isInFlight(s), `expected isInFlight(${s}) to be false`).toBe(false);
    }
  });
});

describe("needsReview", () => {
  it("returns true for candidates and needs_review", () => {
    expect(needsReview("candidates")).toBe(true);
    expect(needsReview("needs_review")).toBe(true);
  });

  it("returns false for all other statuses", () => {
    const others = MB_LOOKUP_STATUSES.filter(
      (s) => s !== "candidates" && s !== "needs_review",
    );
    for (const s of others) {
      expect(needsReview(s), `expected needsReview(${s}) to be false`).toBe(false);
    }
  });
});

describe("MB_STATUS_GROUP_MEMBERS", () => {
  it("covers every mb_lookup_status exactly once", () => {
    const allMapped = Object.values(MB_STATUS_GROUP_MEMBERS).flat();
    // every known status appears in exactly one group
    for (const s of MB_LOOKUP_STATUSES) {
      const count = allMapped.filter((m) => m === s).length;
      expect(count, `status '${s}' should appear in exactly 1 group`).toBe(1);
    }
    // no extra values
    expect(allMapped.length).toBe(MB_LOOKUP_STATUSES.length);
  });

  it("groups sum matches MB_LOOKUP_STATUSES length", () => {
    const total = MB_STATUS_GROUPS.reduce(
      (sum, g) => sum + MB_STATUS_GROUP_MEMBERS[g].length,
      0,
    );
    expect(total).toBe(MB_LOOKUP_STATUSES.length);
  });
});

// compile-time exhaustiveness helper: if a new MbStatusGroup is added,
// this function will fail to compile until a case is added.
function assertExhaustiveGroup(g: MbStatusGroup): string {
  switch (g) {
    case "untouched": return g;
    case "in_flight": return g;
    case "needs_attention": return g;
    case "done": return g;
    case "deferred": return g;
    case "error": return g;
  }
}

it("assertExhaustiveGroup covers all MbStatusGroup values", () => {
  for (const g of MB_STATUS_GROUPS) {
    expect(assertExhaustiveGroup(g)).toBe(g);
  }
});
