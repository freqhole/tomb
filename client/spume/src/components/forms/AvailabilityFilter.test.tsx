// @vitest-environment jsdom

import { Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvailabilityFilter, AvailabilityFilterChip } from "./AvailabilityFilter";
import { useAvailabilityFilter } from "../../utils/useAvailabilityFilter";

const { probe } = vi.hoisted(() => ({ probe: { data: true as boolean | undefined } }));
vi.mock("@tanstack/solid-query", () => ({
  createQuery: () => probe,
  useQueryClient: () => ({ fetchQuery: vi.fn() }),
}));
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
  function mount(view = "songs") {
    host = document.createElement("div");
    document.body.appendChild(host);
    let availability!: ReturnType<typeof useAvailabilityFilter>;
    dispose = render(() => {
      availability = useAvailabilityFilter(view);
      return (
        <>
          <Show
            when={
              availability.pageInfo().availabilityFilterAvailable &&
              !availability.pageInfo().availabilityFilterSelected
            }
          >
            <AvailabilityFilter
              onSelect={() => availability.pageInfo().onAddAvailabilityFilter()}
            />
          </Show>
          <Show when={availability.pageInfo().availabilityFilterSelected}>
            <AvailabilityFilterChip
              onRemove={() => availability.pageInfo().onRemoveAvailabilityFilter()}
            />
          </Show>
        </>
      );
    }, host);
    return availability;
  }

  const removeButton = () =>
    host!.querySelector<HTMLButtonElement>('[aria-label="remove"]');

  it.each(["songs", "albums", "artists", "videos", "series", "library.albums"])(
    "%s quietly hides offline media until explicitly selected",
    (view) => {
      const availability = mount(view);
      expect(availability.hideOffline()).toBe(true);
      expect(availability.pageInfo().availabilityFilterSelected).toBe(false);
      expect(removeButton()).toBeNull();
      expect(host!.textContent).toBe("show offline");

      host!.querySelector<HTMLButtonElement>("button")!.click();
      expect(availability.hideOffline()).toBe(false);
      expect(removeButton()).not.toBeNull();
      expect(host!.querySelectorAll("button")).toHaveLength(1);
      expect(host!.querySelector("[aria-pressed]")).toBeNull();
      expect(window.history.state.viewState[`${view}.showOffline`]).toBe(true);

      removeButton()!.click();
      expect(availability.hideOffline()).toBe(true);
      expect(removeButton()).toBeNull();
      expect(window.history.state.viewState[`${view}.showOffline`]).toBe(false);

      host!.querySelector<HTMLButtonElement>("button")!.click();
      expect(availability.hideOffline()).toBe(false);
      expect(removeButton()).not.toBeNull();
    }
  );

  it("restores the explicit selection when returning to a view", () => {
    mount().pageInfo().onAddAvailabilityFilter();
    dispose?.();
    host?.remove();
    const restored = mount();
    expect(restored.hideOffline()).toBe(false);
    expect(removeButton()).not.toBeNull();
  });

  it("does not carry the old default hide-offline chip into the new controls", () => {
    window.history.replaceState({
      viewState: { "songs.hideOffline": true, "songs.availabilitySelected": true },
    }, "");
    expect(mount().hideOffline()).toBe(true);
    expect(removeButton()).toBeNull();
  });

  it("keeps an explicit selection removable when offline media is no longer detected", () => {
    window.history.replaceState({ viewState: { "songs.showOffline": true } }, "");
    probe.data = false;
    const availability = mount();
    expect(availability.hideOffline()).toBe(false);
    expect(removeButton()).not.toBeNull();
    removeButton()!.click();
    expect(availability.hideOffline()).toBe(true);
    expect(host!.textContent).toBe("");
  });

  it.each([false, undefined])(
    "does not offer a control without confirmed offline media (%s)",
    (data) => {
      probe.data = data;
      const availability = mount();
      expect(availability.pageInfo().availabilityFilterAvailable).toBe(false);
      expect(availability.hideOffline()).toBe(true);
      expect(host!.textContent).toBe("");
    }
  );
});
