// @vitest-environment jsdom

import { createRoot, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvailabilityFilter, AvailabilityFilterChip } from "./AvailabilityFilter";
import { useAvailabilityFilter } from "../../utils/useAvailabilityFilter";

const { probe } = vi.hoisted(() => ({ probe: { data: true as boolean | undefined } }));
vi.mock("@tanstack/solid-query", () => ({ createQuery: () => probe }));
vi.mock("../../utils/useLibraryAvailability", () => ({ useLibraryAvailability: vi.fn() }));
vi.mock("../../music/data/currentState", () => ({ getCurrentRemote: () => undefined }));
vi.mock("../../app/api/client", () => ({ getClientForRemote: vi.fn() }));
vi.mock("../icons/registry", () => ({ Icon: () => null }));

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  window.history.replaceState({}, "");
  probe.data = true;
});

describe("browse availability control", () => {
  it("uses an active chip, toggles, removes and re-adds through the filter menu", () => {
    window.history.replaceState({}, "");
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => {
      const availability = useAvailabilityFilter("songs");
      return (
        <Show when={availability.pageInfo().onHideOfflineChange}>
          <Show
            when={availability.pageInfo().availabilityFilterSelected}
            fallback={
              <AvailabilityFilter
                onSelect={() => availability.pageInfo().onAddAvailabilityFilter()}
              />
            }
          >
            <AvailabilityFilterChip
              hideOffline={availability.hideOffline()}
              onChange={(hide) => availability.pageInfo().onHideOfflineChange?.(hide)}
              onRemove={() => availability.pageInfo().onRemoveAvailabilityFilter()}
            />
          </Show>
        </Show>
      );
    }, host);
    const chip = () => host!.querySelector<HTMLButtonElement>("[aria-pressed]")!;
    expect(host.querySelector("input")).toBeNull();
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    chip().click();
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    expect(window.history.state.viewState["songs.hideOffline"]).toBe(false);
    host.querySelector<HTMLButtonElement>('[aria-label="remove"]')!.click();
    expect(chip()).toBeNull();
    host.querySelector<HTMLButtonElement>("button")!.click();
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    createRoot((cleanup) => {
      expect(useAvailabilityFilter("songs").hideOffline()).toBe(true);
      cleanup();
    });
  });

  it.each([false, undefined])(
    "does not offer a control without confirmed offline media (%s)",
    (data) => {
      probe.data = data;
      createRoot((cleanup) => {
        expect(useAvailabilityFilter("songs").pageInfo().onHideOfflineChange).toBeUndefined();
        cleanup();
      });
    }
  );
});
