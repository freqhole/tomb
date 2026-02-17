// feed view — shows server activity: recent listens, favorites, new albums
import { useNavigate } from "@solidjs/router";
import { createEffect, For, on, onCleanup, Show } from "solid-js";
import { Icon } from "../../components/icons/registry";
import { MediaThumbnail } from "../../components/media/MediaThumbnail";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { getCurrentRemote } from "../data";
import { useActivityFeedQuery, useTopSongsQuery, useTopArtistsQuery } from "../queries/analytics";
import { routes } from "../utils/routing";
import type { ImageMetadata } from "../services/storage/types";

// adapt feed item images to our ImageMetadata format
function adaptFeedImages(
  images: Array<{ blob_id: string; is_primary: number; blob_type?: string }> | null | undefined
): ImageMetadata[] | undefined {
  if (!images || images.length === 0) return undefined;
  const remote = getCurrentRemote();
  if (!remote) return undefined;

  return images.map((img) => ({
    remote_blob_id: img.blob_id,
    remote_url: `${remote.base_url}/api/blobs/${img.blob_id}`,
    is_primary: img.is_primary === 1,
    blob_type: (img.blob_type as ImageMetadata["blob_type"]) ?? "thumbnail",
  }));
}

// relative time formatting (matching QueueSidebar's timeAgo)
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// feed type badge color/label
function feedTypeInfo(type: string): { label: string; color: string } {
  switch (type) {
    case "RecentListen":
      return { label: "listened", color: "var(--color-accent-500)" };
    case "RecentFavorite":
      return { label: "favorited", color: "#ef4444" };
    case "RecentAlbum":
      return { label: "new album", color: "#22c55e" };
    default:
      return { label: type, color: "var(--color-text-muted)" };
  }
}

export function FeedView() {
  const navigate = useNavigate();
  const feedQuery = useActivityFeedQuery(100);
  const topSongsQuery = useTopSongsQuery(5);
  const topArtistsQuery = useTopArtistsQuery(5);

  const remote = getCurrentRemote();

  // set page info
  createEffect(
    on(
      () => feedQuery.data,
      () => {
        const total = feedQuery.data?.total ?? 0;
        setPageInfo({ title: "feed", count: total });
      }
    )
  );
  onCleanup(() => clearPageInfo());

  return (
    <div class="h-full overflow-y-auto">
      <div class="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {/* no remote connected */}
        <Show when={!remote}>
          <div class="flex flex-col items-center justify-center py-16 text-center">
            <Icon name="discover" size={48} color="var(--color-text-muted)" />
            <p class="text-[var(--color-text-secondary)] mt-4 text-sm">
              connect to a server to see activity feed
            </p>
          </div>
        </Show>

        <Show when={remote}>
          {/* activity feed */}
          <section>
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
              recent activity
            </h2>

            <Show
              when={!feedQuery.isLoading}
              fallback={
                <div class="flex items-center justify-center py-12">
                  <Icon name="loader" size={24} color="var(--color-text-muted)" />
                  <span class="text-[var(--color-text-muted)] ml-2 text-sm">loading feed...</span>
                </div>
              }
            >
              <Show
                when={feedQuery.data && feedQuery.data.items.length > 0}
                fallback={
                  <div class="text-center py-12">
                    <Icon name="recent" size={32} color="var(--color-text-muted)" />
                    <p class="text-[var(--color-text-muted)] mt-2 text-sm">
                      no activity yet — start listening to build your feed
                    </p>
                  </div>
                }
              >
                <div class="space-y-1">
                  <For each={feedQuery.data!.items}>
                    {(item) => {
                      const typeInfo = feedTypeInfo(item.feed_type);
                      const images = adaptFeedImages(item.images);
                      const createdAt =
                        typeof item.created_at === "number"
                          ? item.created_at * 1000 // convert from seconds to ms if needed
                          : item.created_at;

                      return (
                        <div
                          class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-accent-500)]/5 cursor-pointer transition-colors"
                          onClick={() => {
                            if (item.album_id) {
                              navigate(routes.album(item.album_id));
                            } else if (item.artist_id) {
                              navigate(routes.artist(item.artist_id));
                            }
                          }}
                        >
                          {/* thumbnail */}
                          <div class="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-[var(--color-accent-500)]/10 flex items-center justify-center">
                            <Show
                              when={images && images.length > 0}
                              fallback={
                                <Icon name="music" size={20} color="var(--color-accent-500)" />
                              }
                            >
                              <MediaThumbnail images={images} size={40} hideIndex />
                            </Show>
                          </div>

                          {/* content */}
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                                {item.title}
                              </span>
                              <span
                                class="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
                                style={{
                                  background: `${typeInfo.color}20`,
                                  color: typeInfo.color,
                                }}
                              >
                                {typeInfo.label}
                              </span>
                            </div>
                            <div class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                              <Show when={item.subtitle}>
                                <span class="truncate">{item.subtitle}</span>
                                <span>&middot;</span>
                              </Show>
                              <Show when={item.username}>
                                <span>{item.username}</span>
                                <span>&middot;</span>
                              </Show>
                              <span class="flex-shrink-0">{timeAgo(createdAt)}</span>
                              <Show when={item.play_count && item.play_count > 1}>
                                <span>&middot;</span>
                                <span>{item.play_count} plays</span>
                              </Show>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Show>
          </section>

          {/* top songs sidebar */}
          <Show when={topSongsQuery.data && topSongsQuery.data.length > 0}>
            <section>
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-4">top songs</h2>
              <div class="space-y-1">
                <For each={topSongsQuery.data}>
                  {(song, index) => {
                    const images = adaptFeedImages(song.images);
                    return (
                      <div class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-accent-500)]/5 transition-colors">
                        <span class="text-[var(--color-text-muted)] text-sm font-mono w-5 text-right flex-shrink-0">
                          {index() + 1}
                        </span>
                        <div class="w-8 h-8 flex-shrink-0 rounded overflow-hidden bg-[var(--color-accent-500)]/10 flex items-center justify-center">
                          <Show
                            when={images && images.length > 0}
                            fallback={
                              <Icon name="music" size={16} color="var(--color-accent-500)" />
                            }
                          >
                            <MediaThumbnail images={images} size={32} hideIndex />
                          </Show>
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-sm text-[var(--color-text-primary)] truncate m-0">
                            {song.title}
                          </p>
                          <Show when={song.artist_name}>
                            <p class="text-xs text-[var(--color-text-secondary)] truncate m-0">
                              {song.artist_name}
                            </p>
                          </Show>
                        </div>
                        <span class="text-xs text-[var(--color-text-muted)] flex-shrink-0">
                          {song.play_count} {song.play_count === 1 ? "play" : "plays"}
                        </span>
                      </div>
                    );
                  }}
                </For>
              </div>
            </section>
          </Show>

          {/* top artists */}
          <Show when={topArtistsQuery.data && topArtistsQuery.data.length > 0}>
            <section>
              <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                top artists
              </h2>
              <div class="space-y-1">
                <For each={topArtistsQuery.data}>
                  {(artist, index) => (
                    <div
                      class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--color-accent-500)]/5 cursor-pointer transition-colors"
                      onClick={() => navigate(routes.artist(artist.artist_id))}
                    >
                      <span class="text-[var(--color-text-muted)] text-sm font-mono w-5 text-right flex-shrink-0">
                        {index() + 1}
                      </span>
                      <div class="w-8 h-8 flex-shrink-0 rounded-full overflow-hidden bg-[var(--color-accent-500)]/10 flex items-center justify-center">
                        <Icon name="artist" size={16} color="var(--color-accent-500)" />
                      </div>
                      <div class="flex-1 min-w-0">
                        <p class="text-sm text-[var(--color-text-primary)] truncate m-0">
                          {artist.name}
                        </p>
                        <p class="text-xs text-[var(--color-text-secondary)] m-0">
                          {artist.total_plays} plays &middot; {artist.song_count} songs
                        </p>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>
        </Show>
      </div>
    </div>
  );
}
