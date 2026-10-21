// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraggableRow } from "./DraggableRow";

const layout = vi.hoisted(() => ({ mobile: false }));
vi.mock("../../utils/isMobile", () => ({ isMobile: () => layout.mobile }));
vi.mock("../icons/registry", () => ({ Icon: () => null }));
vi.mock("../ratings/FavoriteHeart", () => ({ FavoriteHeart: () => null }));
vi.mock("../media/MediaThumbnail", () => ({
  MediaThumbnail: (props: { enablePlayClick: boolean; onPlayClick: () => void; index: number }) => (
    <button
      data-thumbnail
      disabled={!props.enablePlayClick}
      onClick={(event) => {
        event.stopPropagation();
        props.onPlayClick();
      }}
    >
      {props.index}
    </button>
  ),
}));

let host: HTMLDivElement | undefined;
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
});

describe("offline playlist row", () => {
  it.each([false, true])(
    "disables play but retains row order and management (touch: %s)",
    (mobile) => {
      layout.mobile = mobile;
      const [offline, setOffline] = createSignal(true);
      const play = vi.fn();
      const manage = vi.fn();
      const drag = vi.fn();
      host = document.createElement("div");
      document.body.appendChild(host);
      dispose = render(
        () => (
          <DraggableRow
            id="saved-item"
            index={7}
            isOffline={offline()}
            onDoubleClick={play}
            onPlayClick={play}
            onDragStart={drag}
          >
            <span>saved media</span>
            <button
              onClick={(event) => {
                event.stopPropagation();
                manage();
              }}
            >
              manage
            </button>
          </DraggableRow>
        ),
        host
      );
      const row = () => host!.querySelector<HTMLElement>('[data-row-id="saved-item"]')!;
      const thumbnail = () => host!.querySelector<HTMLButtonElement>("[data-thumbnail]")!;
      expect(thumbnail().textContent).toBe("7");
      expect(thumbnail().disabled).toBe(true);
      expect(host.querySelector('[title="media is on offline storage"]')).not.toBeNull();
      thumbnail().click();
      row().dispatchEvent(new MouseEvent(mobile ? "click" : "dblclick", { bubbles: true }));
      expect(play).not.toHaveBeenCalled();
      host.querySelector<HTMLButtonElement>("button:not([data-thumbnail])")!.click();
      expect(manage).toHaveBeenCalledOnce();
      row().dispatchEvent(new Event("dragstart", { bubbles: true }));
      expect(drag).toHaveBeenCalledOnce();
      expect(row().draggable).toBe(true);
      setOffline(false);
      expect(thumbnail().disabled).toBe(false);
      expect(host.querySelector('[title="media is on offline storage"]')).toBeNull();
      thumbnail().click();
      expect(play).toHaveBeenCalledOnce();
      expect(thumbnail().textContent).toBe("7");
    }
  );
});
