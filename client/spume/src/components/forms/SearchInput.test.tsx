// @vitest-environment jsdom

import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchInput, type SearchSuggestion } from "./SearchInput";

vi.mock("../media/MediaImage", () => ({ MediaImage: () => null }));
vi.mock("../ratings/FavoriteHeart", () => ({ FavoriteHeart: () => null }));
vi.mock("../icons/registry", () => ({ Icon: () => null }));
vi.mock("../overlays/ContextMenu", () => ({
  ContextMenu: (props: { children: JSX.Element }) => <>{props.children}</>,
}));
vi.mock("../text/HighlightedMarqueeText", () => ({
  HighlightedMarqueeText: (props: { text: string }) => <span>{props.text}</span>,
}));

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
});

describe("search availability badge", () => {
  it("labels offline matches without blocking navigation and clears the badge on reconnect", () => {
    const [offline, setOffline] = createSignal(true);
    const onSelect = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => {
      const suggestions = (): SearchSuggestion[] => [
        { id: "offline", text: "exact match", category: "song", isOffline: offline() },
        { id: "online", text: "another match", category: "video", isOffline: false },
        { id: "legacy", text: "older peer", category: "album" },
      ];
      return <SearchInput open suggestions={suggestions()} onSelect={onSelect} />;
    }, host);
    const badges = () => document.querySelectorAll('[title="media is on offline storage"]');
    expect(badges()).toHaveLength(1);
    expect(badges()[0].textContent?.trim()).toBe("offline");
    const rows = document.querySelectorAll<HTMLElement>('[role="option"]');
    expect(rows).toHaveLength(3);
    rows[0].click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "offline" }));
    setOffline(false);
    expect(badges()).toHaveLength(0);
  });
});
