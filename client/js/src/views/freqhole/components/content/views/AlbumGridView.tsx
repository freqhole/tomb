import { Show } from "solid-js";
import { DesktopAlbumsView } from "./albums/DesktopAlbumsView";
import { MobileAlbumsView } from "./albums/MobileAlbumsView";
import { useLayout } from "../../../store";
import type { RouteSectionProps } from "@solidjs/router";

interface AlbumGridViewProps {
  class?: string;
}

export function AlbumGridView(
  props: RouteSectionProps<unknown> & AlbumGridViewProps = {} as any
) {
  const [layout] = useLayout();

  return (
    <div class={`h-full w-full ${props.class || ""}`}>
      {/* Desktop View */}
      <Show when={layout.breakpoint === "desktop"}>
        <DesktopAlbumsView {...props} />
      </Show>

      {/* Mobile View */}
      <Show
        when={layout.breakpoint === "mobile" || layout.breakpoint === "tablet"}
      >
        <MobileAlbumsView {...props} />
      </Show>
    </div>
  );
}
