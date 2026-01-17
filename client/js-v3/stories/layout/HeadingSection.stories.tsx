import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../../src/components/buttons/Button";
import { IconButton } from "../../src/components/buttons/IconButton";
import { SearchSortControls } from "../../src/components/controls/SearchSortControls";
import { HeadingSection } from "../../src/components/layout/HeadingSection";
import { formatDuration, mockAlbums, mockArtists } from "../mockData";

const meta = {
  title: "Layout/HeadingSection",
  component: HeadingSection,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof HeadingSection>;

export default meta;
type Story = StoryObj<typeof meta>;

// sort fields for examples
const songSortFields = [
  { value: "title", label: "title", description: "sort by song title" },
  { value: "artist", label: "artist", description: "sort by artist name" },
  { value: "album", label: "album", description: "sort by album name" },
  { value: "duration", label: "duration", description: "sort by song length" },
  { value: "rating", label: "rating", description: "sort by rating" },
];

/**
 * complete heading section with title, count, sort controls, and action buttons
 */
export const Complete: Story = {
  render: () => {
    const [sortBy, setSortBy] = createSignal("title");
    const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">(
      "asc",
    );

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "200px",
        }}
      >
        <HeadingSection
          title="songs"
          count={1247}
          controls={
            <SearchSortControls
              sortBy={sortBy()}
              sortDirection={sortDirection()}
              onSortChange={(field, direction) => {
                setSortBy(field);
                setSortDirection(direction);
              }}
              sortFields={songSortFields}
            />
          }
          actions={
            <>
              <Button variant="primary" onClick={() => console.log("play all")}>
                play all
              </Button>
              <Button
                variant="secondary"
                onClick={() => console.log("shuffle")}
              >
                shuffle
              </Button>
              <Button
                variant="secondary"
                onClick={() => console.log("add to queue")}
              >
                add to queue
              </Button>
            </>
          }
        />
      </div>
    );
  },
};

/**
 * basic heading with just title and count
 */
export const BasicWithCount: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "150px",
        }}
      >
        <HeadingSection title="artists" count={156} />
      </div>
    );
  },
};

/**
 * heading with subtitle instead of count
 */
export const WithSubtitle: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "150px",
        }}
      >
        <HeadingSection
          title="recently added"
          subtitle="songs added in the last 7 days"
        />
      </div>
    );
  },
};

/**
 * heading with loading state
 */
export const Loading: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "150px",
        }}
      >
        <HeadingSection title="albums" loading={true} />
      </div>
    );
  },
};

/**
 * heading with sort controls only
 */
export const WithSortControls: Story = {
  render: () => {
    const [sortBy, setSortBy] = createSignal("artist");
    const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">(
      "asc",
    );

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "150px",
        }}
      >
        <HeadingSection
          title="artists"
          count={89}
          controls={
            <SearchSortControls
              sortBy={sortBy()}
              sortDirection={sortDirection()}
              onSortChange={(field, direction) => {
                setSortBy(field);
                setSortDirection(direction);
              }}
              sortFields={[
                {
                  value: "artist",
                  label: "artist",
                  description: "sort by name",
                },
                {
                  value: "song_count",
                  label: "songs",
                  description: "sort by song count",
                },
                {
                  value: "album_count",
                  label: "albums",
                  description: "sort by album count",
                },
              ]}
            />
          }
        />
      </div>
    );
  },
};

/**
 * heading with action buttons only
 */
export const WithActions: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "150px",
        }}
      >
        <HeadingSection
          title="playlist name"
          count={42}
          actions={
            <>
              <Button variant="primary" onClick={() => console.log("play")}>
                play
              </Button>
              <Button
                variant="secondary"
                onClick={() => console.log("shuffle")}
              >
                shuffle
              </Button>
              <IconButton
                icon="favorite"
                variant="ghost"
                aria-label="favorite playlist"
                onClick={() => console.log("favorite")}
              />
              <IconButton
                icon="more"
                variant="ghost"
                aria-label="more options"
                onClick={() => console.log("options")}
              />
            </>
          }
        />
      </div>
    );
  },
};

/**
 * minimal heading (title only)
 */
export const Minimal: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "150px",
        }}
      >
        <HeadingSection title="genres" />
      </div>
    );
  },
};

/**
 * album detail heading example
 */
export const AlbumDetailExample: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "200px",
        }}
      >
        <HeadingSection
          title={mockAlbums[0].title}
          subtitle={`${mockArtists[0].name} · ${mockAlbums[0].year} · ${formatDuration(mockAlbums[0].duration)}`}
          actions={
            <>
              <Button
                variant="primary"
                onClick={() => console.log("play album")}
              >
                play album
              </Button>
              <Button
                variant="secondary"
                onClick={() => console.log("shuffle")}
              >
                shuffle
              </Button>
              <Button
                variant="secondary"
                onClick={() => console.log("add to queue")}
              >
                add to queue
              </Button>
              <IconButton
                icon="favorite"
                variant="ghost"
                aria-label="favorite album"
                onClick={() => console.log("favorite")}
              />
            </>
          }
        />
      </div>
    );
  },
};

/**
 * genre view heading example with count
 */
export const GenreViewExample: Story = {
  render: () => {
    const [sortBy, setSortBy] = createSignal("artist");
    const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">(
      "asc",
    );

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "200px",
        }}
      >
        <HeadingSection
          title="electronic"
          count={847}
          subtitle="songs in this genre"
          controls={
            <SearchSortControls
              sortBy={sortBy()}
              sortDirection={sortDirection()}
              onSortChange={(field, direction) => {
                setSortBy(field);
                setSortDirection(direction);
              }}
              sortFields={songSortFields}
            />
          }
          actions={
            <>
              <Button variant="primary" onClick={() => console.log("play all")}>
                play all
              </Button>
              <Button
                variant="secondary"
                onClick={() => console.log("shuffle")}
              >
                shuffle
              </Button>
            </>
          }
        />
      </div>
    );
  },
};
