export interface FreqholeArtistRowProps {
  artist: {
    name: string;
    song_count: number;
    avgRank?: number;
  };
  index: number;
  variant: "desktop" | "mobile";
  selected?: boolean;
  onClick?: (artist: any) => void;
  class?: string;
}

/**
 * artist row component for freqhole infinite grid
 * supports desktop and mobile variants
 */
export function FreqholeArtistRow(props: FreqholeArtistRowProps) {
  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    props.onClick?.(props.artist);
  };

  // Desktop variant - table row format
  const renderDesktop = () => (
    <div
      class={`grid grid-cols-[1fr_auto] gap-4 px-6 py-4 items-center hover:bg-gray-800/50 transition-colors cursor-pointer ${
        props.selected ? "bg-magenta-500/20" : ""
      } ${props.class || ""}`}
      onClick={handleClick}
    >
      {/* Artist name */}
      <div class="font-medium text-white truncate">{props.artist.name}</div>

      {/* Song count */}
      <div class="text-center text-gray-400 text-sm w-20">
        {props.artist.song_count} song{props.artist.song_count !== 1 ? "s" : ""}
      </div>
    </div>
  );

  // Mobile variant - card layout
  const renderMobile = () => (
    <div
      class={`p-4 hover:bg-gray-800/50 transition-colors border-b border-gray-800/50 cursor-pointer ${
        props.selected ? "bg-magenta-500/20" : ""
      } ${props.class || ""}`}
      onClick={handleClick}
    >
      <div class="flex items-center justify-between">
        {/* Artist info */}
        <div class="flex-1 min-w-0">
          <div class="font-medium text-white mb-1 truncate">
            {props.artist.name}
          </div>
          <div class="text-sm text-gray-400">
            {props.artist.song_count} song
            {props.artist.song_count !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Chevron indicator */}
        <div class="flex-shrink-0 text-gray-500 ml-3">→</div>
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
