import { createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Badge } from "../src/components/badges/Badge";

const meta = {
  title: "Components/Badges/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "accent", "success", "warning", "error", "outline"],
      description: "badge style variant",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "badge size",
    },
    removable: {
      control: "boolean",
      description: "show remove button",
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

// basic badge
export const Default: Story = {
  args: {
    children: "rock",
  },
};

// all variants
export const Variants: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-4">
        <div>
          <div class="caption mb-2">default</div>
          <div class="flex gap-2 flex-wrap">
            <Badge>rock</Badge>
            <Badge>alternative</Badge>
            <Badge>indie</Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent</div>
          <div class="flex gap-2 flex-wrap">
            <Badge variant="accent">featured</Badge>
            <Badge variant="accent">new release</Badge>
            <Badge variant="accent">popular</Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">success</div>
          <div class="flex gap-2 flex-wrap">
            <Badge variant="success">verified</Badge>
            <Badge variant="success">completed</Badge>
            <Badge variant="success">synced</Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">warning</div>
          <div class="flex gap-2 flex-wrap">
            <Badge variant="warning">pending</Badge>
            <Badge variant="warning">missing metadata</Badge>
            <Badge variant="warning">needs review</Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">error</div>
          <div class="flex gap-2 flex-wrap">
            <Badge variant="error">failed</Badge>
            <Badge variant="error">corrupted</Badge>
            <Badge variant="error">error</Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">outline</div>
          <div class="flex gap-2 flex-wrap">
            <Badge variant="outline">electronic</Badge>
            <Badge variant="outline">jazz</Badge>
            <Badge variant="outline">classical</Badge>
          </div>
        </div>
      </div>
    </div>
  ),
};

// all sizes
export const Sizes: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-4">
        <div>
          <div class="caption mb-2">small</div>
          <div class="flex gap-2 items-center">
            <Badge size="sm">rock</Badge>
            <Badge size="sm" variant="accent">
              featured
            </Badge>
            <Badge size="sm" variant="success">
              verified
            </Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">medium (default)</div>
          <div class="flex gap-2 items-center">
            <Badge size="md">rock</Badge>
            <Badge size="md" variant="accent">
              featured
            </Badge>
            <Badge size="md" variant="success">
              verified
            </Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">large</div>
          <div class="flex gap-2 items-center">
            <Badge size="lg">rock</Badge>
            <Badge size="lg" variant="accent">
              featured
            </Badge>
            <Badge size="lg" variant="success">
              verified
            </Badge>
          </div>
        </div>
      </div>
    </div>
  ),
};

// with icons
export const WithIcons: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-4">
        <div>
          <div class="caption mb-2">genre tags with icons</div>
          <div class="flex gap-2 flex-wrap">
            <Badge icon="music">rock</Badge>
            <Badge icon="album">alternative</Badge>
            <Badge icon="artist">indie</Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">status badges with icons</div>
          <div class="flex gap-2 flex-wrap">
            <Badge variant="success" icon="check">
              verified
            </Badge>
            <Badge variant="warning" icon="alertTriangle">
              pending
            </Badge>
            <Badge variant="error" icon="x">
              failed
            </Badge>
          </div>
        </div>

        <div>
          <div class="caption mb-2">feature badges with icons</div>
          <div class="flex gap-2 flex-wrap">
            <Badge variant="accent" icon="favorite">
              favorited
            </Badge>
            <Badge variant="accent" icon="playlist">
              in playlist
            </Badge>
            <Badge variant="accent" icon="recent">
              recently played
            </Badge>
          </div>
        </div>
      </div>
    </div>
  ),
};

// removable badges (for tag management)
export const Removable: Story = {
  render: () => {
    const [tags, setTags] = createSignal([
      "rock",
      "alternative",
      "indie",
      "90s",
      "grunge",
    ]);

    const removeTag = (tag: string) => {
      setTags(tags().filter((t) => t !== tag));
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-4">
          <div class="caption">click × to remove tags</div>
          <div class="flex gap-2 flex-wrap">
            <For each={tags()}>
              {(tag) => (
                <Badge removable onRemove={() => removeTag(tag)}>
                  {tag}
                </Badge>
              )}
            </For>
          </div>
          {tags().length === 0 && (
            <div class="body-small text-[var(--color-text-tertiary)]">
              all tags removed
            </div>
          )}
        </div>
      </div>
    );
  },
};

// interactive tag selector
export const TagSelector: Story = {
  render: () => {
    const availableTags = [
      "rock",
      "alternative",
      "indie",
      "pop",
      "electronic",
      "jazz",
      "classical",
      "metal",
      "hip-hop",
      "folk",
    ];

    const [selectedTags, setSelectedTags] = createSignal<string[]>([
      "rock",
      "alternative",
    ]);

    const toggleTag = (tag: string) => {
      if (selectedTags().includes(tag)) {
        setSelectedTags(selectedTags().filter((t) => t !== tag));
      } else {
        setSelectedTags([...selectedTags(), tag]);
      }
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-4">
          <div>
            <div class="caption mb-2">available tags (click to toggle)</div>
            <div class="flex gap-2 flex-wrap">
              <For each={availableTags}>
                {(tag) => (
                  <button
                    type="button"
                    onClick={() => toggleTag(tag)}
                    class="transition-opacity hover:opacity-80"
                  >
                    <Badge
                      variant={
                        selectedTags().includes(tag) ? "accent" : "outline"
                      }
                    >
                      {tag}
                    </Badge>
                  </button>
                )}
              </For>
            </div>
          </div>

          <div>
            <div class="caption mb-2">
              selected tags ({selectedTags().length})
            </div>
            <div class="flex gap-2 flex-wrap">
              <For each={selectedTags()}>
                {(tag) => (
                  <Badge
                    variant="accent"
                    removable
                    onRemove={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    );
  },
};

// in context - song metadata
export const SongMetadata: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl bg-[var(--color-bg-secondary)] rounded-lg p-6">
        <div class="space-y-4">
          <div>
            <h3 class="heading-4 text-[var(--color-text-primary)] mb-2">
              comfortably numb
            </h3>
            <div class="body-small text-[var(--color-text-secondary)] mb-3">
              pink floyd • the wall • 1979
            </div>
            <div class="flex gap-2 flex-wrap">
              <Badge variant="accent" icon="favorite">
                favorite
              </Badge>
              <Badge>progressive rock</Badge>
              <Badge>rock</Badge>
              <Badge>70s</Badge>
              <Badge variant="success" icon="check">
                high quality
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

// in context - album card
export const AlbumCard: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-sm bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden">
        <div class="aspect-square bg-[var(--color-bg-tertiary)] flex items-center justify-center">
          <span class="caption text-[var(--color-text-muted)]">
            album cover
          </span>
        </div>
        <div class="p-4 space-y-3">
          <div>
            <h4 class="body-base text-[var(--color-text-primary)] mb-1">
              the dark side of the moon
            </h4>
            <div class="caption">pink floyd • 1973</div>
          </div>
          <div class="flex gap-2 flex-wrap">
            <Badge size="sm" variant="accent">
              essential
            </Badge>
            <Badge size="sm">progressive rock</Badge>
            <Badge size="sm">psychedelic</Badge>
          </div>
        </div>
      </div>
    </div>
  ),
};

// in context - search filters
export const SearchFilters: Story = {
  render: () => {
    const [filters, setFilters] = createSignal({
      genres: ["rock", "alternative"],
      years: ["1990s", "2000s"],
      qualities: ["high quality"],
    });

    const removeGenre = (genre: string) => {
      setFilters({
        ...filters(),
        genres: filters().genres.filter((g) => g !== genre),
      });
    };

    const removeYear = (year: string) => {
      setFilters({
        ...filters(),
        years: filters().years.filter((y) => y !== year),
      });
    };

    const removeQuality = (quality: string) => {
      setFilters({
        ...filters(),
        qualities: filters().qualities.filter((q) => q !== quality),
      });
    };

    const clearAll = () => {
      setFilters({ genres: [], years: [], qualities: [] });
    };

    const hasFilters = () =>
      filters().genres.length > 0 ||
      filters().years.length > 0 ||
      filters().qualities.length > 0;

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <div class="flex items-center justify-between mb-4">
            <div class="caption">active filters</div>
            {hasFilters() && (
              <button
                type="button"
                onClick={clearAll}
                class="body-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] transition-colors"
              >
                clear all
              </button>
            )}
          </div>

          {hasFilters() ? (
            <div class="space-y-3">
              {filters().genres.length > 0 && (
                <div>
                  <div class="caption mb-2">genres</div>
                  <div class="flex gap-2 flex-wrap">
                    <For each={filters().genres}>
                      {(genre) => (
                        <Badge removable onRemove={() => removeGenre(genre)}>
                          {genre}
                        </Badge>
                      )}
                    </For>
                  </div>
                </div>
              )}

              {filters().years.length > 0 && (
                <div>
                  <div class="caption mb-2">years</div>
                  <div class="flex gap-2 flex-wrap">
                    <For each={filters().years}>
                      {(year) => (
                        <Badge
                          variant="accent"
                          removable
                          onRemove={() => removeYear(year)}
                        >
                          {year}
                        </Badge>
                      )}
                    </For>
                  </div>
                </div>
              )}

              {filters().qualities.length > 0 && (
                <div>
                  <div class="caption mb-2">quality</div>
                  <div class="flex gap-2 flex-wrap">
                    <For each={filters().qualities}>
                      {(quality) => (
                        <Badge
                          variant="success"
                          icon="check"
                          removable
                          onRemove={() => removeQuality(quality)}
                        >
                          {quality}
                        </Badge>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div class="body-small text-[var(--color-text-tertiary)] text-center py-8">
              no filters applied
            </div>
          )}
        </div>
      </div>
    );
  },
};

// status indicators
export const StatusIndicators: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl space-y-4">
        <div class="flex items-center justify-between p-4 bg-[var(--color-bg-secondary)] rounded">
          <div>
            <div class="body-small text-[var(--color-text-primary)]">
              upload progress
            </div>
            <div class="caption">processing audio files...</div>
          </div>
          <Badge variant="warning" icon="upload">
            processing
          </Badge>
        </div>

        <div class="flex items-center justify-between p-4 bg-[var(--color-bg-secondary)] rounded">
          <div>
            <div class="body-small text-[var(--color-text-primary)]">
              library sync
            </div>
            <div class="caption">all files synced</div>
          </div>
          <Badge variant="success" icon="check">
            synced
          </Badge>
        </div>

        <div class="flex items-center justify-between p-4 bg-[var(--color-bg-secondary)] rounded">
          <div>
            <div class="body-small text-[var(--color-text-primary)]">
              metadata scan
            </div>
            <div class="caption">scan failed - check logs</div>
          </div>
          <Badge variant="error" icon="alertTriangle">
            failed
          </Badge>
        </div>

        <div class="flex items-center justify-between p-4 bg-[var(--color-bg-secondary)] rounded">
          <div>
            <div class="body-small text-[var(--color-text-primary)]">
              account status
            </div>
            <div class="caption">premium features enabled</div>
          </div>
          <Badge variant="accent" icon="check">
            premium
          </Badge>
        </div>
      </div>
    </div>
  ),
};

// playlist tags
export const PlaylistTags: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-6">
        <div class="bg-[var(--color-bg-secondary)] rounded-lg p-4">
          <h4 class="body-base text-[var(--color-text-primary)] mb-3">
            workout vibes
          </h4>
          <div class="flex gap-2 flex-wrap">
            <Badge size="sm" variant="accent">
              high energy
            </Badge>
            <Badge size="sm">electronic</Badge>
            <Badge size="sm">hip-hop</Badge>
            <Badge size="sm">2020s</Badge>
          </div>
        </div>

        <div class="bg-[var(--color-bg-secondary)] rounded-lg p-4">
          <h4 class="body-base text-[var(--color-text-primary)] mb-3">
            chill sunday morning
          </h4>
          <div class="flex gap-2 flex-wrap">
            <Badge size="sm">acoustic</Badge>
            <Badge size="sm">folk</Badge>
            <Badge size="sm">indie</Badge>
            <Badge size="sm" variant="outline">
              relaxing
            </Badge>
          </div>
        </div>

        <div class="bg-[var(--color-bg-secondary)] rounded-lg p-4">
          <h4 class="body-base text-[var(--color-text-primary)] mb-3">
            90s nostalgia
          </h4>
          <div class="flex gap-2 flex-wrap">
            <Badge size="sm">90s</Badge>
            <Badge size="sm">grunge</Badge>
            <Badge size="sm">alternative</Badge>
            <Badge size="sm" variant="accent">
              essential
            </Badge>
          </div>
        </div>
      </div>
    </div>
  ),
};
