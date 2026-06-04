// pure presentational album node tile.
//
// this is the HTML/CSS preview of a graph node (used in storybook for state
// docs + as a tile inside legends / overlays). the actual canvas renders via
// `drawAlbumNode()` which mirrors these visuals.
//
// when there is no image, the tile falls back to a text-only square showing
// artist + album name. on hover/selected, the tile gets a colored ring.

import { Show } from "solid-js";
import type { AlbumNodeData, NodeState } from "./types";
import { MediaImage } from "../media/MediaImage";

export interface AlbumNodeViewProps {
  album: AlbumNodeData;
  state?: NodeState;
  /** edge length in css pixels (square). default 72. */
  size?: number;
  /** show title + artist label under the tile. default false (hover-only). */
  showLabel?: boolean;
  onClick?: (e: MouseEvent) => void;
}

const RING_COLOR: Record<NodeState, string | null> = {
  idle: null,
  hover: "var(--color-accent-500, #ff1a9e)",
  selected: "var(--color-accent-500, #ff1a9e)",
  dimmed: null,
};

export function AlbumNodeView(props: AlbumNodeViewProps) {
  const size = () => props.size ?? 72;
  const state = () => props.state ?? "idle";
  const ring = () => RING_COLOR[state()];
  const dimmed = () => state() === "dimmed";
  const selected = () => state() === "selected";

  return (
    <div
      class="inline-flex flex-col items-center select-none"
      style={{ width: `${size()}px` }}
      onClick={props.onClick}
    >
      <div
        class="relative rounded-md overflow-hidden bg-[var(--color-bg-elevated)] border border-[var(--color-border)] transition-all"
        style={{
          width: `${size()}px`,
          height: `${size()}px`,
          opacity: dimmed() ? 0.25 : 1,
          "box-shadow": ring() ? `0 0 0 ${selected() ? 3 : 2}px ${ring()}` : undefined,
        }}
      >
        <Show
          when={props.album.image || props.album.imageUrl}
          fallback={
            <div class="w-full h-full flex flex-col items-center justify-center p-1 text-center bg-gradient-to-br from-[var(--color-bg-elevated)] to-[var(--color-bg)]">
              <div
                class="text-[var(--color-text)] font-medium leading-tight overflow-hidden"
                style={{
                  "font-size": `${Math.max(8, Math.floor(size() / 8))}px`,
                  "line-clamp": "2",
                  display: "-webkit-box",
                  "-webkit-line-clamp": "2",
                  "-webkit-box-orient": "vertical",
                }}
              >
                {props.album.title}
              </div>
              <div
                class="text-[var(--color-text-muted)] mt-0.5 leading-tight overflow-hidden"
                style={{
                  "font-size": `${Math.max(7, Math.floor(size() / 10))}px`,
                  "line-clamp": "1",
                  display: "-webkit-box",
                  "-webkit-line-clamp": "1",
                  "-webkit-box-orient": "vertical",
                }}
              >
                {props.album.artistName}
              </div>
            </div>
          }
        >
          {/* prefer the structured ImageMetadata path (handles local
           *  blobs, p2p, and charnel-managed remotes via MediaImage's
           *  transport-aware resolver). fall back to the legacy
           *  pre-resolved `imageUrl` string for storybook mocks. */}
          <Show
            when={props.album.image}
            fallback={
              <img
                src={props.album.imageUrl ?? ""}
                alt={`${props.album.title} by ${props.album.artistName}`}
                class="w-full h-full object-cover"
                draggable={false}
              />
            }
          >
            <MediaImage
              images={[props.album.image!]}
              alt={`${props.album.title} by ${props.album.artistName}`}
              thumbnailSize={200}
              domainType="album"
              showFallback={false}
              class="w-full h-full object-cover"
            />
          </Show>
        </Show>
      </div>
      <Show when={props.showLabel}>
        <div class="mt-1 text-center max-w-full" style={{ width: `${size()}px` }}>
          <div class="text-xs font-medium text-[var(--color-text)] truncate">
            {props.album.title}
          </div>
          <div class="text-[10px] text-[var(--color-text-muted)] truncate">
            {props.album.artistName}
          </div>
        </div>
      </Show>
    </div>
  );
}
