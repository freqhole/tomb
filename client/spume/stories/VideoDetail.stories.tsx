// standalone "video detail" mockup - there's no reusable VideoDetailPanel
// component yet (unlike albums/artists), so this is hand-composed the same
// way SuperStory's albumDetailView/seriesView are, just extracted into its
// own story so the layout can be reviewed in isolation.
import { createSignal, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";
import { IconButton } from "../src/components/buttons/IconButton";
import { StatsCard, StatsGrid, formatDuration } from "../src/components/cards/StatsCard";
import type { VideoSummary } from "../src/video/data/types";
import { mockVideos, mockVideoSeries, placeholderImage } from "./mockData";

const meta = {
  title: "Video/VideoDetail",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function seriesFor(video: VideoSummary) {
  return mockVideoSeries.find((s) => s.id === video.series_id) ?? null;
}

function episodesFor(video: VideoSummary): VideoSummary[] {
  if (!video.series_id) return [];
  return mockVideos
    .filter((v) => v.series_id === video.series_id)
    .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0));
}

function VideoDetailBody(props: { initial: VideoSummary }) {
  const [video, setVideo] = createSignal(props.initial);

  return (
    <div class="min-h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <div class="max-w-4xl mx-auto p-6">
        <div class="flex gap-6 mb-6">
          <img
            src={placeholderImage(video().id, video().title)}
            alt=""
            class="w-64 aspect-video object-cover rounded-lg flex-shrink-0"
          />
          <div class="min-w-0 flex flex-col justify-between">
            <div>
              <Show when={seriesFor(video())}>
                {(series) => (
                  <div class="text-xs uppercase tracking-wider text-[var(--color-accent-500,#d63384)] mb-1">
                    {series().title}
                    <Show when={video().episode_number != null}>
                      {" "}
                      · episode {video().episode_number}
                    </Show>
                  </div>
                )}
              </Show>
              <h1 class="text-2xl font-bold mb-2">{video().title}</h1>
              <p class="text-sm text-[var(--color-text-secondary)] max-w-xl">
                {video().description}
              </p>
            </div>
            <div class="flex gap-2 mt-4">
              <Button variant="primary" onClick={() => console.log("play:", video().title)}>
                play
              </Button>
              <IconButton icon="favorite" variant="ghost" aria-label="favorite" />
              <IconButton icon="share" variant="ghost" aria-label="share" />
            </div>
          </div>
        </div>

        <StatsGrid columns={3} gap="md" class="mb-6">
          <StatsCard label="duration" value={formatDuration(video().duration_seconds ?? 0)} />
          <StatsCard label="type" value={video().content_type} />
          <StatsCard label="added" value={new Date(video().added_at * 1000).toLocaleDateString()} />
        </StatsGrid>

        <Show when={episodesFor(video()).length > 0}>
          <h2 class="text-lg font-semibold mb-3">more episodes</h2>
          <div class="space-y-1">
            {episodesFor(video()).map((ep) => (
              <button
                type="button"
                class={`w-full flex items-center gap-3 p-3 rounded text-left transition-colors ${
                  ep.id === video().id
                    ? "bg-[var(--color-accent-500)]/20"
                    : "bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-hover)]"
                }`}
                onClick={() => setVideo(ep)}
              >
                <img
                  src={placeholderImage(ep.id, ep.title)}
                  alt=""
                  class="w-16 aspect-video object-cover rounded flex-shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate">{ep.title}</div>
                  <div class="text-xs text-[var(--color-text-tertiary)]">
                    episode {ep.episode_number}
                  </div>
                </div>
                <div class="text-xs text-[var(--color-text-muted)]">
                  {formatDuration(ep.duration_seconds ?? 0)}
                </div>
              </button>
            ))}
          </div>
        </Show>
      </div>
    </div>
  );
}

export const StandaloneMovie: Story = {
  name: "standalone movie",
  render: () => <VideoDetailBody initial={mockVideos.find((v) => v.content_type === "movie")!} />,
};

export const SeriesEpisode: Story = {
  name: "series episode",
  render: () => <VideoDetailBody initial={mockVideos.find((v) => v.series_id)!} />,
};
