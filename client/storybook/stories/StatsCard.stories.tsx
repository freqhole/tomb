import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
    StatsCard,
    StatsGrid,
    formatDuration,
    formatNumber,
} from "../src/components/cards/StatsCard";

const meta = {
  title: "Components/Cards/StatsCard",
  component: StatsCard,
  tags: ["autodocs"],
  argTypes: {
    label: {
      control: "text",
      description: "stat label (e.g., 'songs', 'albums')",
    },
    value: {
      control: "text",
      description: "stat value (number or formatted string)",
    },
    loading: {
      control: "boolean",
      description: "whether the card is loading",
    },
    variant: {
      control: "select",
      options: ["default", "compact", "minimal"],
      description: "visual style variant",
    },
  },
} satisfies Meta<typeof StatsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// interactive artist stats example
export const Interactive: Story = {
  render: () => {
    const [songCount, setSongCount] = createSignal(248);
    const [albumCount, setAlbumCount] = createSignal(18);
    const [totalDuration, setTotalDuration] = createSignal(52380); // in seconds
    const [avgRating, setAvgRating] = createSignal(4.3);

    return (
      <div class="p-6 bg-[var(--color-bg-primary)] rounded-lg">
        <div class="mb-6">
          <h3 class="text-[var(--color-text-primary)] text-xl font-semibold mb-2">
            pink floyd
          </h3>
          <p class="text-[var(--color-text-secondary)] text-sm">
            artist statistics
          </p>
        </div>

        <StatsGrid columns={4} gap="md">
          <StatsCard
            label="songs"
            value={formatNumber(songCount())}
            icon="music"
            onClick={() => {
              setSongCount(songCount() + 10);
              console.log("songs clicked");
            }}
          />
          <StatsCard
            label="albums"
            value={formatNumber(albumCount())}
            icon="album"
            onClick={() => {
              setAlbumCount(albumCount() + 1);
              console.log("albums clicked");
            }}
          />
          <StatsCard
            label="duration"
            value={formatDuration(totalDuration())}
            icon="recent"
            subtitle="total playtime"
          />
          <StatsCard
            label="avg rating"
            value={avgRating().toFixed(1)}
            icon="star"
            subtitle="out of 5.0"
          />
        </StatsGrid>

        <div class="mt-6 text-[var(--color-text-tertiary)] text-xs">
          click song or album cards to increment
        </div>
      </div>
    );
  },
};

// artist detail stats (5 columns like the reference)
export const ArtistDetail: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)] rounded-lg">
      <h3 class="text-[var(--color-text-primary)] text-2xl font-bold mb-4">
        led zeppelin
      </h3>

      <StatsGrid columns={5} gap="md">
        <StatsCard label="songs" value="94" icon="music" />
        <StatsCard label="albums" value="9" icon="album" />
        <StatsCard label="duration" value="6h 48m" icon="recent" />
        <StatsCard label="avg rating" value="4.6" icon="star" />
        <StatsCard
          label="genres"
          value="rock"
          subtitle="hard rock, blues rock"
        />
      </StatsGrid>
    </div>
  ),
};

// genre detail stats
export const GenreDetail: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)] rounded-lg">
      <h3 class="text-[var(--color-text-primary)] text-2xl font-bold mb-4">
        progressive rock
      </h3>

      <StatsGrid columns={4} gap="md">
        <StatsCard label="songs" value="1,247" icon="music" />
        <StatsCard label="artists" value="86" icon="artist" />
        <StatsCard label="albums" value="142" icon="album" />
        <StatsCard label="duration" value="104h 32m" icon="recent" />
      </StatsGrid>
    </div>
  ),
};

// playlist stats
export const PlaylistStats: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)] rounded-lg">
      <h3 class="text-[var(--color-text-primary)] text-2xl font-bold mb-4">
        my favorite songs
      </h3>

      <StatsGrid columns={3} gap="md">
        <StatsCard label="songs" value="87" icon="music" />
        <StatsCard label="duration" value="5h 23m" icon="recent" />
        <StatsCard
          label="last updated"
          value="2 days ago"
          icon="recent"
          variant="default"
        />
      </StatsGrid>
    </div>
  ),
};

// compact variant
export const Compact: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={4} gap="sm">
        <StatsCard label="songs" value="42" icon="music" variant="compact" />
        <StatsCard label="albums" value="8" icon="album" variant="compact" />
        <StatsCard
          label="duration"
          value="3h 12m"
          icon="recent"
          variant="compact"
        />
        <StatsCard
          label="rating"
          value="4.2"
          icon="star"
          variant="compact"
        />
      </StatsGrid>
    </div>
  ),
};

// minimal variant
export const Minimal: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={6} gap="sm">
        <StatsCard label="songs" value="1,024" variant="minimal" />
        <StatsCard label="albums" value="96" variant="minimal" />
        <StatsCard label="artists" value="143" variant="minimal" />
        <StatsCard label="genres" value="28" variant="minimal" />
        <StatsCard label="duration" value="72h" variant="minimal" />
        <StatsCard label="rating" value="4.4" variant="minimal" />
      </StatsGrid>
    </div>
  ),
};

// loading states
export const Loading: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={4} gap="md">
        <StatsCard label="songs" value="0" loading={true} />
        <StatsCard label="albums" value="0" loading={true} />
        <StatsCard label="duration" value="0" loading={true} />
        <StatsCard label="rating" value="0" loading={true} />
      </StatsGrid>
    </div>
  ),
};

// with icons
export const WithIcons: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={5} gap="md">
        <StatsCard label="songs" value="523" icon="music" />
        <StatsCard label="albums" value="42" icon="album" />
        <StatsCard label="artists" value="87" icon="artist" />
        <StatsCard label="playlists" value="12" icon="playlist" />
        <StatsCard label="favorites" value="156" icon="favorite" />
      </StatsGrid>
    </div>
  ),
};

// without icons
export const WithoutIcons: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={4} gap="md">
        <StatsCard label="songs" value="248" />
        <StatsCard label="albums" value="18" />
        <StatsCard label="duration" value="14h 36m" />
        <StatsCard label="avg rating" value="4.3" />
      </StatsGrid>
    </div>
  ),
};

// with subtitles
export const WithSubtitles: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={3} gap="md">
        <StatsCard
          label="songs"
          value="1,247"
          icon="music"
          subtitle="in library"
        />
        <StatsCard
          label="duration"
          value="87h 32m"
          icon="recent"
          subtitle="total playtime"
        />
        <StatsCard
          label="rating"
          value="4.6"
          icon="star"
          subtitle="average score"
        />
      </StatsGrid>
    </div>
  ),
};

// clickable cards
export const Clickable: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <p class="text-[var(--color-text-secondary)] text-sm mb-4">
        hover over cards to see interactive state
      </p>

      <StatsGrid columns={3} gap="md">
        <StatsCard
          label="songs"
          value="248"
          icon="music"
          onClick={() => console.log("view all songs")}
        />
        <StatsCard
          label="albums"
          value="18"
          icon="album"
          onClick={() => console.log("view all albums")}
        />
        <StatsCard
          label="playlists"
          value="5"
          icon="playlist"
          onClick={() => console.log("view all playlists")}
        />
      </StatsGrid>
    </div>
  ),
};

// large numbers
export const LargeNumbers: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={4} gap="md">
        <StatsCard
          label="songs"
          value={formatNumber(15234)}
          icon="music"
        />
        <StatsCard
          label="artists"
          value={formatNumber(2847)}
          icon="artist"
        />
        <StatsCard
          label="albums"
          value={formatNumber(4192)}
          icon="album"
        />
        <StatsCard
          label="duration"
          value="1,024h"
          icon="recent"
        />
      </StatsGrid>
    </div>
  ),
};

// single column mobile-like layout
export const MobileLayout: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)] max-w-sm">
      <h3 class="text-[var(--color-text-primary)] text-xl font-bold mb-4">
        queen
      </h3>

      <StatsGrid columns={1} gap="sm">
        <StatsCard label="songs" value="184" icon="music" />
        <StatsCard label="albums" value="15" icon="album" />
        <StatsCard label="duration" value="12h 48m" icon="recent" />
        <StatsCard label="avg rating" value="4.7" icon="star" />
      </StatsGrid>
    </div>
  ),
};

// two column layout
export const TwoColumn: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsGrid columns={2} gap="lg">
        <StatsCard
          label="total songs"
          value="12,847"
          icon="music"
          subtitle="across all genres"
        />
        <StatsCard
          label="total duration"
          value="892h 15m"
          icon="recent"
          subtitle="of music"
        />
        <StatsCard
          label="total artists"
          value="1,543"
          icon="artist"
          subtitle="in collection"
        />
        <StatsCard
          label="total albums"
          value="2,194"
          icon="album"
          subtitle="in library"
        />
      </StatsGrid>
    </div>
  ),
};

// single stat card
export const SingleCard: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)]">
      <StatsCard
        label="total library size"
        value="12,847 songs"
        icon="library"
        subtitle="892 hours of music"
        onClick={() => console.log("view library")}
      />
    </div>
  ),
};

// mixed variants
export const MixedVariants: Story = {
  render: () => (
    <div class="p-6 bg-[var(--color-bg-primary)] space-y-6">
      <div>
        <h4 class="text-[var(--color-text-primary)] text-sm font-semibold mb-2">
          default variant
        </h4>
        <StatsGrid columns={3} gap="md">
          <StatsCard label="songs" value="248" icon="music" />
          <StatsCard label="albums" value="18" icon="album" />
          <StatsCard label="duration" value="14h 36m" icon="recent" />
        </StatsGrid>
      </div>

      <div>
        <h4 class="text-[var(--color-text-primary)] text-sm font-semibold mb-2">
          compact variant
        </h4>
        <StatsGrid columns={3} gap="sm">
          <StatsCard label="songs" value="248" icon="music" variant="compact" />
          <StatsCard label="albums" value="18" icon="album" variant="compact" />
          <StatsCard label="duration" value="14h 36m" icon="recent" variant="compact" />
        </StatsGrid>
      </div>

      <div>
        <h4 class="text-[var(--color-text-primary)] text-sm font-semibold mb-2">
          minimal variant
        </h4>
        <StatsGrid columns={3} gap="sm">
          <StatsCard label="songs" value="248" variant="minimal" />
          <StatsCard label="albums" value="18" variant="minimal" />
          <StatsCard label="duration" value="14h 36m" variant="minimal" />
        </StatsGrid>
      </div>
    </div>
  ),
};
