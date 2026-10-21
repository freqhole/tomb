// @vitest-environment jsdom

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerPointerActivity } from "./playerPointerActivity";
import "./playerCursor.css";

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let activity: ReturnType<typeof usePlayerPointerActivity>;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => {
    activity = usePlayerPointerActivity();
    return (
      <div classList={{ "player-cursor-idle": activity.cursorHidden() }}>
        <button style={{ cursor: "pointer" }}>settings</button>
      </div>
    );
  }, host);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host.remove();
  vi.useRealTimers();
});

describe("player pointer activity", () => {
  it("keeps the existing three-second controls timer and hides the cursor at five seconds", () => {
    expect(activity.pointerActive()).toBe(true);
    expect(activity.cursorHidden()).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(activity.pointerActive()).toBe(false);
    expect(activity.cursorHidden()).toBe(false);
    vi.advanceTimersByTime(1999);
    expect(activity.cursorHidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(activity.cursorHidden()).toBe(true);
    expect(host.firstElementChild?.classList.contains("player-cursor-idle")).toBe(true);
  });

  it.each(["pointermove", "pointerdown"])("reveals the cursor and restarts idle time on %s", (event) => {
    vi.advanceTimersByTime(5000);
    host.querySelector("button")?.dispatchEvent(new Event(event, { bubbles: true }));
    expect(activity.cursorHidden()).toBe(false);
    expect(activity.pointerActive()).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(activity.cursorHidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(activity.cursorHidden()).toBe(true);
  });

  it("does not let an old timer hide the cursor during continuing activity", () => {
    vi.advanceTimersByTime(4000);
    window.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(1000);
    expect(activity.cursorHidden()).toBe(false);
    vi.advanceTimersByTime(4000);
    expect(activity.cursorHidden()).toBe(true);
  });

  it("removes timers and listeners when leaving the player view", () => {
    dispose?.();
    dispose = undefined;
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event("pointermove"));
    expect(vi.getTimerCount()).toBe(0);
    expect(host.children).toHaveLength(0);
  });
});
