import { Show } from "solid-js";
import { DesktopSongsView } from "./songs/DesktopSongsView";
import { MobileSongsView } from "./songs/MobileSongsView";
import type { RouteSectionProps } from "@solidjs/router";

interface SongTableViewProps {
  class?: string;
}

export function SongTableView(
  props: RouteSectionProps<unknown> & SongTableViewProps = {} as any
) {
  return (
    <div class={`h-full w-full ${props.class || ""}`}>
      {/* Desktop View */}
      <Show when={true}>
        <div class="hidden md:block h-full">
          <DesktopSongsView {...props} />
        </div>
      </Show>

      {/* Mobile View */}
      <Show when={true}>
        <div class="md:hidden h-full">
          <MobileSongsView {...props} />
        </div>
      </Show>
    </div>
  );
}
