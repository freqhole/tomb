// virtualized video grid — mirrors VirtualAlbumGrid.tsx's structure
// (see components/virtualized/VirtualAlbumGrid.tsx) for the video domain.
// no context-menu / favorite-toggle props — not in scope for this pass.
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  JSX,
  onCleanup,
  onMount,
} from "solid-js";
import { useScrollRestore } from "../../utils/scrollRestore";
import { VideoCard } from "../../video/components/VideoCard";
import type { VideoSummary } from "../../video/data/types";

export interface VirtualVideoGridProps {
  /** array of videos to display */
  videos: VideoSummary[];
  /** number of columns in the grid */
  columns?: number;
  /** callback when a video card is clicked */
  onVideoClick?: (video: VideoSummary) => void;
  /** callback when play button is clicked */
  onVideoPlay?: (video: VideoSummary) => void;
  /** callback when a video card is right-clicked */
  onVideoContextMenu?: (e: MouseEvent, video: VideoSummary) => void;
  /** ids of favorited videos (omit to hide favorite hearts entirely) */
  favoriteVideoIds?: Set<string>;
  /** callback when a video's favorite heart is toggled */
  onVideoFavoriteToggle?: (videoId: string, isFavorite: boolean) => void;
  /** callback when user scrolls near end (for infinite scroll) */
  onNearEnd?: () => void;
  /** height of the container */
  height?: number;
  /** additional css classes */
  class?: string;
  /** unique key for scroll restoration (e.g. 'videos') */
  scrollRestoreKey?: string;
}

export function VirtualVideoGrid(props: VirtualVideoGridProps): JSX.Element {
  let parentRef: HTMLDivElement | undefined;
  const [containerWidth, setContainerWidth] = createSignal(0);
  const gap = 16;

  const { restoreScroll, saveScroll } = useScrollRestore(props.scrollRestoreKey || "video-grid");

  const getColumnsForWidth = (width: number): number => {
    if (props.columns) return props.columns;
    if (width < 480) return 2;
    if (width < 640) return 3;
    if (width < 768) return 4;
    if (width < 1024) return 5;
    if (width < 1280) return 6;
    return 7;
  };

  const columns = () => getColumnsForWidth(containerWidth());

  const textHeight = 100;

  const getCardHeight = () => {
    const width = containerWidth();
    if (width === 0) return 340;
    const cols = getColumnsForWidth(width);
    const effectiveWidth = width - gap * 2;
    const columnWidth = (effectiveWidth - gap * (cols - 1)) / cols;
    return columnWidth + textHeight;
  };

  onMount(() => {
    if (!parentRef) return;

    setContainerWidth(parentRef.clientWidth);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (parentRef) {
          restoreScroll(parentRef);
        }
      });
    });

    let timeoutId: number;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const width = entries[0]?.contentRect.width;
        if (width) setContainerWidth(width);
      }, 16) as unknown as number;
    });

    observer.observe(parentRef);

    const handleScroll = (e: Event) => {
      if (parentRef) {
        saveScroll(parentRef);

        if (props.onNearEnd) {
          const target = e.target as HTMLDivElement;
          const scrollTop = target.scrollTop;
          const scrollHeight = target.scrollHeight;
          const clientHeight = target.clientHeight;

          if (scrollHeight - scrollTop - clientHeight < 300) {
            props.onNearEnd();
          }
        }
      }
    };
    parentRef.addEventListener("scroll", handleScroll, { passive: true });

    onCleanup(() => {
      clearTimeout(timeoutId);
      observer.disconnect();
      if (parentRef) {
        parentRef.removeEventListener("scroll", handleScroll);
      }
    });
  });

  const rowCount = createMemo(() => Math.ceil(props.videos.length / columns()));

  const rowVirtualizer = createVirtualizer({
    get count() {
      return rowCount();
    },
    getScrollElement: () => parentRef ?? null,
    estimateSize: () => getCardHeight() + gap,
    overscan: 2,
  });

  createEffect(() => {
    columns(); // track
    rowVirtualizer.measure();
  });

  return (
    <div
      ref={parentRef!}
      class={`overflow-auto bg-[var(--color-bg-primary)] ${props.class || ""}`}
      style={{ height: `${props.height || 600}px` }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
          padding: `${gap}px`,
        }}
      >
        <For each={rowVirtualizer.getVirtualItems()}>
          {(virtualRow) => {
            const columnIndices = createMemo(() => {
              const startIndex = virtualRow.index * columns();
              return Array.from({ length: columns() }, (_, i) => startIndex + i);
            });

            return (
              <div
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  padding: `0 ${gap}px`,
                }}
              >
                <div
                  class="grid gap-4"
                  style={{
                    "grid-template-columns": `repeat(${columns()}, minmax(0, 1fr))`,
                  }}
                >
                  <Index each={columnIndices()}>
                    {(videoIndexAccessor) => {
                      const video = () => props.videos[videoIndexAccessor()];
                      const hasVideo = () => videoIndexAccessor() < props.videos.length;

                      return (
                        <div class={hasVideo() ? "" : "invisible"}>
                          {hasVideo() && (
                            <VideoCard
                              video={video()!}
                              onClick={props.onVideoClick}
                              onPlay={props.onVideoPlay}
                              onContextMenu={props.onVideoContextMenu}
                              isFavorite={
                                props.favoriteVideoIds
                                  ? props.favoriteVideoIds.has(video()!.id)
                                  : undefined
                              }
                              onFavoriteToggle={props.onVideoFavoriteToggle}
                            />
                          )}
                        </div>
                      );
                    }}
                  </Index>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

export default VirtualVideoGrid;
