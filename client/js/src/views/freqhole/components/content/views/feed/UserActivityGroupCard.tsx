import { For, Show } from "solid-js";
import type {
  FeedItem,
  ActivityTile,
} from "../../../../../../lib/analytics/analytics-api";
import { useCollectionInteractions } from "../../../../services/collectionInteractions";
import { apiClient } from "../../../../../../lib/api-client";

interface UserActivityGroupCardProps {
  item: FeedItem;
}

export function UserActivityGroupCard(props: UserActivityGroupCardProps) {
  const { playCollection } = useCollectionInteractions();
  const activity = props.item.metadata.user_activity;

  if (!activity) return null;

  const handleTilePlay = (tile: ActivityTile) => {
    if (tile.domain_type === "song") {
      // handle individual song play - would need song player integration
      console.log("play song:", tile.id);
    } else {
      playCollection(
        tile.domain_type as "album" | "playlist" | "artist" | "genre",
        tile.id,
        {
          total_songs: 0,
          shuffle_enabled: false,
          play_source: "feed_tile",
        }
      );
    }
  };

  const ActivityTileComponent = (props: { tile: ActivityTile }) => {
    return (
      <div
        class="bg-gray-900 aspect-square p-2 hover:bg-magenta-600/10 transition-colors cursor-pointer group"
        onClick={() => handleTilePlay(props.tile)}
      >
        <Show
          when={props.tile.image_url}
          fallback={
            <div class="w-full h-full flex items-center justify-center bg-gray-800 mb-1">
              <span class="text-gray-500 text-sm">
                {props.tile.domain_type === "album"
                  ? "♪"
                  : props.tile.domain_type === "playlist"
                    ? "♭"
                    : props.tile.domain_type === "song"
                      ? "♫"
                      : "♪"}
              </span>
            </div>
          }
        >
          <img
            src={`${apiClient.getBaseUrl()}${props.tile.image_url}`}
            alt={props.tile.title}
            class="w-full aspect-square object-cover mb-1"
            loading="lazy"
          />
        </Show>
        <div class="text-xs text-white truncate font-medium">
          {props.tile.title}
        </div>
        <Show when={props.tile.subtitle}>
          <div class="text-xs text-gray-400 truncate">
            {props.tile.subtitle}
          </div>
        </Show>
      </div>
    );
  };

  return (
    <div class="bg-black p-4 col-span-2 md:col-span-2 lg:col-span-3">
      <div class="mb-4">
        <h3 class="text-white font-medium text-lg">{props.item.title}</h3>
        <Show when={props.item.subtitle}>
          <p class="text-sm text-gray-400">{props.item.subtitle}</p>
        </Show>
      </div>

      {/* recent albums tiles */}
      <Show when={activity.recent_albums.length > 0}>
        <div class="mb-6">
          <h4 class="text-sm text-gray-400 mb-3 uppercase font-medium">
            recent albums
          </h4>
          <div class="grid grid-cols-4 gap-3">
            <For each={activity.recent_albums}>
              {(tile) => <ActivityTileComponent tile={tile} />}
            </For>
          </div>
        </div>
      </Show>

      {/* recent playlists tiles */}
      <Show when={activity.recent_playlists.length > 0}>
        <div class="mb-6">
          <h4 class="text-sm text-gray-400 mb-3 uppercase font-medium">
            recent playlists
          </h4>
          <div class="grid grid-cols-2 gap-3">
            <For each={activity.recent_playlists}>
              {(tile) => <ActivityTileComponent tile={tile} />}
            </For>
          </div>
        </div>
      </Show>

      {/* recent songs tiles */}
      <Show when={activity.recent_songs.length > 0}>
        <div class="mb-4">
          <h4 class="text-sm text-gray-400 mb-3 uppercase font-medium">
            recent songs
          </h4>
          <div class="grid grid-cols-3 gap-3">
            <For each={activity.recent_songs}>
              {(tile) => <ActivityTileComponent tile={tile} />}
            </For>
          </div>
        </div>
      </Show>

      {/* period description */}
      <div class="text-xs text-gray-500 text-center mt-4">
        {activity.period_description}
      </div>
    </div>
  );
}
