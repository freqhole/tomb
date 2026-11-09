import { describe, expect, it } from "vitest";
import { feedEpisodeDetails, feedVideoLabel } from "./feedPresentation";

const video = { video_id: "video" };

describe("feed video labels", () => {
  it("uses episode wording and season/episode numbers for series", () => {
    const episode = {
      ...video,
      video_content_type: "movie",
      series_id: "series",
      season_number: 0,
      episode_number: 2,
    };
    expect(feedVideoLabel(episode)).toBe("an episode");
    expect(feedEpisodeDetails(episode)).toBe("season 0 \u00b7 episode 2");
  });

  it.each([
    ["movie", "a movie"],
    ["music_video", "a music video"],
    ["interview", "an interview"],
    [null, "a video"],
  ])("labels non-series %s videos by their type", (video_content_type, label) => {
    expect(feedVideoLabel({ ...video, video_content_type })).toBe(label);
    expect(feedEpisodeDetails({ ...video, video_content_type, episode_number: 2 })).toBe("");
  });

  it("handles absent episode numbers and non-video items", () => {
    expect(feedEpisodeDetails({ ...video, video_content_type: "series" })).toBe("");
    expect(feedEpisodeDetails({ ...video, series_id: "series", episode_number: 3 })).toBe(
      "episode 3"
    );
    expect(feedVideoLabel({ video_id: null })).toBeUndefined();
  });
});
