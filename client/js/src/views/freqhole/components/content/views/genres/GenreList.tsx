import { For, Show, onMount, createSignal } from "solid-js";
import type { GenreStat } from "../../../../../../lib/music/schemas/genre";

interface GenreListProps {
  genres: GenreStat[];
  loading?: boolean;
  selectedGenre?: GenreStat | null;
  onGenreClick: (genre: GenreStat) => void;
  onGenreDoubleClick: (genre: GenreStat) => void;
  sortField: string;
  sortDirection: "asc" | "desc";
  totalCount?: number;
  hasMore?: boolean;
  onLoadMore?: () => Promise<void>;
  class?: string;
}

export function GenreList(props: GenreListProps) {
  const [scrollContainer, setScrollContainer] =
    createSignal<HTMLElement | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);

  // Format count with abbreviations
  const formatCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  // handle infinite scroll
  const handleScroll = async (e: Event) => {
    const target = e.target as HTMLElement;
    if (!target || !props.onLoadMore || loadingMore()) return;

    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    // trigger load more when near bottom (within 200px)
    if (scrollHeight - scrollTop - clientHeight < 200 && props.hasMore) {
      setLoadingMore(true);
      try {
        await props.onLoadMore();
      } catch (error) {
        console.error("failed to load more genres:", error);
      } finally {
        setLoadingMore(false);
      }
    }
  };

  onMount(() => {
    const container = scrollContainer();
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
    return undefined;
  });

  return (
    <div class={`flex flex-col h-full ${props.class || ""}`}>
      <div class="flex-1 overflow-y-auto" ref={setScrollContainer}>
        <Show
          when={props.genres.length > 0}
          fallback={
            <Show when={!props.loading}>
              <div class="p-6 text-center text-gray-400">
                <p class="text-sm">no genres found</p>
              </div>
            </Show>
          }
        >
          <For each={props.genres}>
            {(genre) => (
              <div
                class={`
                  px-6 py-3 border-b border-gray-800/50 cursor-pointer
                  hover:bg-gray-900/50 transition-colors
                  ${
                    props.selectedGenre?.name === genre.name
                      ? "bg-magenta-900/20 border-magenta-800/50"
                      : ""
                  }
                `}
                onClick={() => props.onGenreClick(genre)}
                onDblClick={() => props.onGenreDoubleClick(genre)}
              >
                <div class="flex items-center justify-between">
                  <div class="flex-1 min-w-0">
                    <h3 class="text-white font-medium text-sm truncate">
                      {genre.name}
                    </h3>
                    <div class="flex items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>
                        {formatCount(genre.song_count)} song
                        {genre.song_count !== 1 ? "s" : ""}
                      </span>
                      <span>
                        {formatCount(genre.artist_count)} artist
                        {genre.artist_count !== 1 ? "s" : ""}
                      </span>
                      <span>
                        {formatCount(genre.album_count)} album
                        {genre.album_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </Show>

        {/* Initial loading state */}
        <Show when={props.loading && props.genres.length === 0}>
          <div class="p-6 text-center">
            <div class="text-gray-400 text-sm">loading genres...</div>
          </div>
        </Show>

        {/* Load more indicator */}
        <Show
          when={loadingMore() || (props.loading && props.genres.length > 0)}
        >
          <div class="p-4 text-center border-t border-gray-800/50">
            <div class="text-gray-400 text-xs">loading more genres...</div>
          </div>
        </Show>

        {/* End of list indicator */}
        <Show
          when={!props.hasMore && props.genres.length > 0 && !props.loading}
        >
          <div class="p-4 text-center border-t border-gray-800/50">
            <div class="text-gray-500 text-xs">
              {props.totalCount
                ? `${props.totalCount} genres total`
                : "end of list"}
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
