import { Show } from "solid-js";

export interface FreqholeAlbumGridProps {
  album: {
    album: string;
    artist: string;
    track_count: number;
    year?: number;
    avgRank?: number;
  };
  index: number;
  variant: "desktop" | "mobile";
  selected?: boolean;
  onClick?: (album: any) => void;
  class?: string;
}

/**
 * album grid card component for freqhole infinite grid
 * supports desktop and mobile variants
 */
export function FreqholeAlbumGrid(props: FreqholeAlbumGridProps) {
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    props.onClick?.(props.album);
  };

  // Desktop variant - square grid card
  const renderDesktop = () => (
    <div
      class={`p-4 hover:bg-gray-800/50 rounded transition-colors cursor-pointer ${
        props.selected ? "bg-magenta-500/20 ring-2 ring-magenta-500" : ""
      } ${props.class || ""}`}
      onClick={handleClick}
    >
      {/* Album artwork placeholder */}
      <div class="aspect-square bg-gray-700 rounded mb-3 flex items-center justify-center hover:bg-gray-600 transition-colors">
        <div class="text-4xl text-gray-500">♪</div>
      </div>

      {/* Album info */}
      <div class="space-y-1">
        <div class="font-medium text-white text-sm mb-1 truncate" title={props.album.album}>
          {props.album.album || "untitled"}
        </div>
        <div class="text-xs text-gray-400 truncate" title={props.album.artist}>
          {props.album.artist || "unknown artist"}
        </div>
        <div class="flex items-center justify-between text-xs text-gray-500 mt-2">
          <span>
            {props.album.track_count || 0} track{props.album.track_count !== 1 ? "s" : ""}
          </span>
          <Show when={props.album.year}>
            <span>{props.album.year}</span>
          </Show>
        </div>
      </div>
    </div>
  );

  // Mobile variant - horizontal card layout
  const renderMobile = () => (
    <div
      class={`flex items-center gap-3 p-4 hover:bg-gray-800/50 transition-colors border-b border-gray-800/50 cursor-pointer ${
        props.selected ? "bg-magenta-500/20" : ""
      } ${props.class || ""}`}
      onClick={handleClick}
    >
      {/* Album artwork placeholder */}
      <div class="w-12 h-12 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
        <div class="text-lg text-gray-500">♪</div>
      </div>

      {/* Album info */}
      <div class="flex-1 min-w-0">
        <div class="font-medium text-white mb-1 truncate">
          {props.album.album || "untitled"}
        </div>
        <div class="text-sm text-gray-400 truncate">
          {props.album.artist || "unknown artist"}
        </div>
        <div class="text-xs text-gray-500 mt-1">
          {props.album.track_count || 0} track{props.album.track_count !== 1 ? "s" : ""}
          <Show when={props.album.year}>
            <span> • {props.album.year}</span>
          </Show>
        </div>
      </div>

      {/* Chevron indicator */}
      <div class="flex-shrink-0 text-gray-500 ml-3">
        →
      </div>
    </div>
  );

  // Render based on variant
  switch (props.variant) {
    case "mobile":
      return renderMobile();
    case "desktop":
    default:
      return renderDesktop();
  }
}
