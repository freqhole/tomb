import { DesktopSongsView } from "./songs/DesktopSongsView";
import { MobileSongsView } from "./songs/MobileSongsView";
import { isMobile } from "../../../../../lib/format-utils";
import type { RouteSectionProps } from "@solidjs/router";

interface SongTableViewProps {
  class?: string;
}

export function SongTableView(
  props: RouteSectionProps<unknown> & SongTableViewProps = {} as any
) {
  return (
    <div class={`h-full w-full ${props.class || ""}`}>
      {isMobile() ? (
        <MobileSongsView {...props} />
      ) : (
        <DesktopSongsView {...props} />
      )}
    </div>
  );
}
