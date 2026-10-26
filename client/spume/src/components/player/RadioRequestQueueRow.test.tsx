// @vitest-environment jsdom

import type { Accessor } from "solid-js";
import { render } from "solid-js/web";
import { expect, it, vi } from "vitest";
import { RadioRequestQueueRow } from "./RadioRequestQueueRow";

vi.mock("../media/MediaThumbnail", () => ({
  MediaThumbnail: () => <span data-testid="thumbnail">thumbnail</span>,
}));
vi.mock("../icons/registry", () => ({ Icon: () => null }));
vi.mock("../text/MarqueeText", () => ({
  MarqueeText: (props: { text: string; isHovering: Accessor<boolean> }) => (
    <span data-hovered={String(props.isHovering())}>{props.text}</span>
  ),
}));

it("controls the title marquee from the whole row, including the thumbnail and remove button", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const remove = vi.fn();
  const dispose = render(() => (
    <RadioRequestQueueRow
      row={{
        id: "request",
        kind: "video",
        itemId: "video",
        requestedBy: "user",
        requestedByUsername: "listener",
        title: "a long episode title",
        artist: "series",
        album: null,
        durationMs: 120000,
        artBlobId: null,
      }}
      index={0}
      thumbnailUrl={null}
      isDragging={false}
      isDropTarget={false}
      top={0}
      draggableEnabled={false}
      onRemove={remove}
      onDragStart={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDragEnd={vi.fn()}
      onDrop={vi.fn()}
      onPointerDown={vi.fn()}
    />
  ), host);
  try {
    const title = host.querySelector("[data-hovered]")!;
    const row = host.firstElementChild!;
    expect(title.getAttribute("data-hovered")).toBe("false");
    row.dispatchEvent(new MouseEvent("mouseenter"));
    host.querySelector('[data-testid="thumbnail"]')!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true })
    );
    expect(title.getAttribute("data-hovered")).toBe("true");
    const button = host.querySelector<HTMLButtonElement>("button")!;
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(title.getAttribute("data-hovered")).toBe("true");
    button.click();
    expect(remove).toHaveBeenCalledOnce();
    row.dispatchEvent(new MouseEvent("mouseleave"));
    expect(title.getAttribute("data-hovered")).toBe("false");
  } finally {
    dispose();
    host.remove();
  }
});
