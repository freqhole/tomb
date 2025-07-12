import { Show } from "solid-js";
import { DesktopAlbumsView } from "./albums/DesktopAlbumsView";
import { MobileAlbumsView } from "./albums/MobileAlbumsView";
import type { RouteSectionProps } from "@solidjs/router";

interface AlbumGridViewProps {
  class?: string;
}

export function AlbumGridView(
  props: RouteSectionProps<unknown> & AlbumGridViewProps = {} as any
) {
  return (
    <div class={`h-full w-full ${props.class || ""}`}>
      {/* Desktop View */}
      <Show when={true}>
        <div class="hidden md:block h-full">
          <DesktopAlbumsView {...props} />
        </div>
      </Show>

      {/* Mobile View */}
      <Show when={true}>
        <div class="md:hidden h-full">
          <MobileAlbumsView {...props} />
        </div>
      </Show>
    </div>
  );
}
