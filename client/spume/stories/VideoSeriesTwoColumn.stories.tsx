// standalone "series" two-column browser mockup - mirrors the real
// VideoSeriesView.tsx (alphabet nav + master list; a grid of all series
// when nothing's selected, a detail panel once one is picked), pulled out
// into its own story so the layout can be reviewed without the whole
// coach-demo app shell around it.
import { createMemo, createSignal, For, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";
import { IconButton } from "../src/components/buttons/IconButton";
import { HeadingSection } from "../src/components/layout/HeadingSection";
import { ResponsiveMasterDetail } from "../src/components/layout/TwoColumnLayout";
import { AlphabetNav } from "../src/components/navigation/AlphabetNav";
import { StatsCard, StatsGrid, formatDuration } from "../src/components/cards/StatsCard";
import { mockVideos, mockVideoSeries, placeholderImage, type MockVideoSeries } from "./mockData";

const meta = {
  title: "Video/SeriesTwoColumn",
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const seriesEpisodes = (seriesId: string) =>
  mockVideos
    .filter((v) => v.series_id === seriesId)
    .sort((a, b) => (a.episode_number ?? 0) - (b.episode_number ?? 0));

function SeriesBrowser() {
  const [selectedSeries, setSelectedSeries] = createSignal<MockVideoSeries | null>(null);
  const [currentLetter, setCurrentLetter] = createSignal<string | undefined>();
  const disabledLetters = createMemo(() => {
    const enabled = new Set(mockVideoSeries.map((s) => s.title[0]?.toUpperCase() ?? "#"));
    return new Set(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("").filter((letter) => !enabled.has(letter))
    );
  });

  const seriesCard = (series: MockVideoSeries, onClick: () => void) => (
    <div
      class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] overflow-hidden cursor-pointer hover:border-[var(--color-accent-500)] transition-colors"
      onClick={onClick}
    >
      <img
        src={placeholderImage(series.id, series.title)}
        alt=""
        class="w-full aspect-video object-cover"
      />
      <div class="p-3">
        <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {series.title}
        </div>
        <div class="text-xs text-[var(--color-text-tertiary)] mt-0.5 line-clamp-2">
          {series.description}
        </div>
      </div>
    </div>
  );

  return (
    <div class="h-screen bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <ResponsiveMasterDetail<MockVideoSeries>
        items={mockVideoSeries}
        selection={selectedSeries}
        onSelectionChange={setSelectedSeries}
        getItemKey={(s) => s.id}
        alphabetNav={
          <AlphabetNav
            currentLetter={currentLetter()}
            disabledLetters={disabledLetters()}
            onLetterClick={setCurrentLetter}
          />
        }
        renderList={(ctx) => (
          <div class="flex flex-col h-full">
            <div class="flex-1 overflow-y-auto">
              <For each={mockVideoSeries}>
                {(series) => (
                  <button
                    class={`
                      w-full flex items-center gap-3 px-6 py-3 text-left transition-colors border-l-2
                      ${
                        ctx.selectedItem()?.id === series.id
                          ? "bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] border-[var(--color-accent-500)]"
                          : "hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border-transparent"
                      }
                    `}
                    onClick={() => ctx.selectItem(series)}
                  >
                    <img
                      src={placeholderImage(series.id, series.title)}
                      alt=""
                      class="w-10 h-10 rounded object-cover flex-shrink-0"
                    />
                    <div class="min-w-0">
                      <div class="font-medium truncate">{series.title}</div>
                      <div class="text-xs text-[var(--color-text-tertiary)] truncate">
                        {series.seasonCount} season{series.seasonCount === 1 ? "" : "s"} ·{" "}
                        {series.episodeCount} episodes
                      </div>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
        renderDetail={(ctx) => (
          <Show when={ctx.selectedItem()}>
            {(series) => (
              <div class="flex flex-col h-full">
                <HeadingSection
                  title={series().title}
                  variant="detail"
                  sticky
                  border
                  showBackButton={ctx.isNarrow() && ctx.showingDetail()}
                  onBack={() => ctx.onBack()}
                />
                <div class="flex-1 overflow-y-auto">
                  <div class="p-3 wide:p-6">
                    <div class="flex gap-4 mb-4">
                      <img
                        src={placeholderImage(series().id, series().title)}
                        alt=""
                        class="w-32 aspect-video object-cover rounded-lg flex-shrink-0"
                      />
                      <div class="min-w-0">
                        <p class="text-sm text-[var(--color-text-secondary)] mb-2">
                          {series().description}
                        </p>
                        <p class="text-xs text-[var(--color-text-tertiary)]">
                          {series().seasonCount} season{series().seasonCount === 1 ? "" : "s"} ·{" "}
                          {series().episodeCount} episodes · {series().year}
                        </p>
                      </div>
                    </div>
                    <StatsGrid columns={3} gap="md" class="mb-3 wide:mb-6">
                      <StatsCard label="seasons" value={String(series().seasonCount)} />
                      <StatsCard label="episodes" value={String(series().episodeCount)} />
                      <StatsCard label="year" value={String(series().year)} />
                    </StatsGrid>
                  </div>
                  <div class="px-3 wide:px-6 pb-4">
                    <h3 class="text-lg font-semibold mb-3">episodes</h3>
                    <div class="space-y-1">
                      <For each={seriesEpisodes(series().id)}>
                        {(video) => (
                          <div class="flex items-center gap-3 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                            <IconButton
                              icon="play"
                              size="sm"
                              variant="ghost"
                              aria-label="play episode"
                            />
                            <div class="flex-1 min-w-0">
                              <div class="body-small text-[var(--color-text-primary)] truncate">
                                {video.title}
                              </div>
                              <div class="caption truncate">episode {video.episode_number}</div>
                            </div>
                            <div class="monospace caption text-[var(--color-text-muted)]">
                              {formatDuration(video.duration_seconds ?? 0)}
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
                <div class="flex-shrink-0 bg-[var(--color-bg-primary)] border-t border-[var(--color-bg-tertiary)] px-3 wide:px-6 py-2 wide:py-3 flex gap-2 wide:gap-3">
                  <Button variant="primary">play all</Button>
                  <Button variant="ghost">add to queue</Button>
                </div>
              </div>
            )}
          </Show>
        )}
        renderEmpty={() => (
          <div class="h-full overflow-y-auto p-3 wide:p-6">
            <div
              class="grid gap-4"
              style={{ "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))" }}
            >
              <For each={mockVideoSeries}>
                {(series) => seriesCard(series, () => setSelectedSeries(series))}
              </For>
            </div>
          </div>
        )}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <SeriesBrowser />,
};
