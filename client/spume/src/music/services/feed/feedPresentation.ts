import type { FeedItem } from "../../data/types";

type VideoLabel = Pick<
  FeedItem,
  "video_id" | "video_content_type" | "series_id" | "season_number" | "episode_number"
>;

export function feedVideoLabel(item: VideoLabel): string | undefined {
  if (!item.video_id) return;
  if (item.series_id || item.video_content_type === "series") return "an episode";
  const type = item.video_content_type?.replaceAll("_", " ") || "video";
  return `${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}`;
}

export function feedEpisodeDetails(item: VideoLabel): string {
  if (!item.video_id || !(item.series_id || item.video_content_type === "series")) return "";
  const parts: string[] = [];
  if (item.season_number != null) parts.push(`season ${item.season_number}`);
  if (item.episode_number != null) parts.push(`episode ${item.episode_number}`);
  return parts.join(" \u00b7 ");
}
