import { describe, expect, it } from "vitest";
import { formatDateTime, formatRelativeTime } from "./dateTime";

describe("date and time formatting", () => {
  const now = new Date("2026-11-06T12:00:00Z");

  it("formats relative times at unit boundaries", () => {
    for (const [seconds, text] of [
      [0, "a moment ago"],
      [30, "30 seconds ago"],
      [60, "1 minute ago"],
      [3600, "1 hour ago"],
      [86400, "yesterday"],
      [604800, "last week"],
      [2592000, "last month"],
      [31536000, "2025"],
    ] as const) {
      expect(formatRelativeTime(now.getTime() - seconds * 1000, now)).toBe(text);
    }
  });

  it("accepts dates and strings, and handles clock skew and invalid dates", () => {
    expect(formatRelativeTime(now, now)).toBe("a moment ago");
    expect(formatRelativeTime(now.toISOString(), now)).toBe("a moment ago");
    expect(formatRelativeTime(now.getTime() + 1000, now)).toBe("just now");
    expect(formatRelativeTime("invalid", now)).toBe("invalid date");
  });

  it("includes the local date and time", () => {
    const timestamp = now.getTime();
    expect(formatDateTime(timestamp)).toBe(
      `${now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} at ${now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
    );
  });
});
