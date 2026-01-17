import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FavoriteHeart } from "../src/components/ratings/FavoriteHeart";
import { formatDuration, mockSongs } from "./mockData";

const meta = {
  title: "Components/Forms/Favorite Heart",
  component: FavoriteHeart,
  tags: ["autodocs"],
  argTypes: {
    isFavorite: {
      control: "boolean",
      description: "whether the item is favorited",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "size of the heart icon",
    },
    disabled: {
      control: "boolean",
      description: "disables interaction",
    },
    readonly: {
      control: "boolean",
      description: "shows state but prevents interaction",
    },
  },
} satisfies Meta<typeof FavoriteHeart>;

export default meta;
type Story = StoryObj<typeof meta>;

// basic interactive example
export const Default: Story = {
  render: () => {
    const [isFavorite, setIsFavorite] = createSignal(false);
    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <FavoriteHeart
          isFavorite={isFavorite()}
          onToggle={(newValue) => {
            setIsFavorite(newValue);
            console.log("favorite toggled:", newValue);
          }}
        />
      </div>
    );
  },
};

// all sizes
export const Sizes: Story = {
  render: () => {
    const [favorites, setFavorites] = createSignal({
      sm: false,
      md: false,
      lg: false,
    });

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-6">
          <div>
            <div class="caption mb-2">small</div>
            <FavoriteHeart
              size="sm"
              isFavorite={favorites().sm}
              onToggle={(v) => setFavorites({ ...favorites(), sm: v })}
            />
          </div>
          <div>
            <div class="caption mb-2">medium (default)</div>
            <FavoriteHeart
              size="md"
              isFavorite={favorites().md}
              onToggle={(v) => setFavorites({ ...favorites(), md: v })}
            />
          </div>
          <div>
            <div class="caption mb-2">large</div>
            <FavoriteHeart
              size="lg"
              isFavorite={favorites().lg}
              onToggle={(v) => setFavorites({ ...favorites(), lg: v })}
            />
          </div>
        </div>
      </div>
    );
  },
};

// different states
export const States: Story = {
  render: () => {
    const [isFavorite, setIsFavorite] = createSignal(false);

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-6">
          <div>
            <div class="caption mb-2">not favorited - interactive</div>
            <FavoriteHeart
              isFavorite={isFavorite()}
              onToggle={(v) => setIsFavorite(v)}
            />
          </div>

          <div>
            <div class="caption mb-2">favorited - interactive</div>
            <FavoriteHeart isFavorite={true} onToggle={(v) => console.log(v)} />
          </div>

          <div>
            <div class="caption mb-2">disabled - not favorited</div>
            <FavoriteHeart isFavorite={false} disabled={true} />
          </div>

          <div>
            <div class="caption mb-2">disabled - favorited</div>
            <FavoriteHeart isFavorite={true} disabled={true} />
          </div>

          <div>
            <div class="caption mb-2">readonly - not favorited</div>
            <FavoriteHeart isFavorite={false} readonly={true} />
          </div>

          <div>
            <div class="caption mb-2">readonly - favorited</div>
            <FavoriteHeart isFavorite={true} readonly={true} />
          </div>
        </div>
      </div>
    );
  },
};

// in context - song list row
export const InSongList: Story = {
  render: () => {
    const songs = mockSongs.slice(0, 3);
    const [favorites, setFavorites] = createSignal({
      [songs[0].id]: false,
      [songs[1].id]: true,
      [songs[2].id]: false,
    });

    const toggleFavorite = (songId: string) => {
      setFavorites({
        ...favorites(),
        [songId]: !favorites()[songId],
      });
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <div class="caption mb-4">song list with favorite hearts</div>
          <div class="space-y-2">
            {songs.map((song) => (
              <div class="flex items-center gap-4 p-2 bg-[var(--color-bg-secondary)] rounded">
                <FavoriteHeart
                  size="sm"
                  isFavorite={favorites()[song.id]}
                  onToggle={() => toggleFavorite(song.id)}
                />
                <div class="flex-1 body-small text-[var(--color-text-primary)]">
                  {song.title}
                </div>
                <div class="body-xs text-[var(--color-text-tertiary)]">
                  {song.artist}
                </div>
                <div class="monospace body-xs text-[var(--color-text-muted)]">
                  {formatDuration(song.durationSeconds)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },
};

// hover states showcase
export const HoverStates: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-6">
        <div>
          <div class="caption mb-2">hover over these to see transitions</div>
          <div class="flex gap-8 items-center">
            <div class="text-center">
              <FavoriteHeart isFavorite={false} onToggle={() => {}} />
              <div class="caption mt-2">not favorited</div>
            </div>
            <div class="text-center">
              <FavoriteHeart isFavorite={true} onToggle={() => {}} />
              <div class="caption mt-2">favorited</div>
            </div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">readonly has no hover effect</div>
          <div class="flex gap-8 items-center">
            <div class="text-center">
              <FavoriteHeart isFavorite={false} readonly={true} />
              <div class="caption mt-2">readonly off</div>
            </div>
            <div class="text-center">
              <FavoriteHeart isFavorite={true} readonly={true} />
              <div class="caption mt-2">readonly on</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

// grid of hearts showing all combinations
export const AllCombinations: Story = {
  render: () => {
    const [interactive, setInteractive] = createSignal(false);

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="caption mb-4">
          all size and state combinations (click the interactive one)
        </div>
        <div class="grid grid-cols-4 gap-4">
          {/* headers */}
          <div></div>
          <div class="caption text-center">small</div>
          <div class="caption text-center">medium</div>
          <div class="caption text-center">large</div>

          {/* interactive */}
          <div class="caption">interactive</div>
          <div class="flex justify-center">
            <FavoriteHeart
              size="sm"
              isFavorite={interactive()}
              onToggle={setInteractive}
            />
          </div>
          <div class="flex justify-center">
            <FavoriteHeart
              size="md"
              isFavorite={interactive()}
              onToggle={setInteractive}
            />
          </div>
          <div class="flex justify-center">
            <FavoriteHeart
              size="lg"
              isFavorite={interactive()}
              onToggle={setInteractive}
            />
          </div>

          {/* disabled */}
          <div class="caption">disabled</div>
          <div class="flex justify-center">
            <FavoriteHeart size="sm" isFavorite={false} disabled={true} />
          </div>
          <div class="flex justify-center">
            <FavoriteHeart size="md" isFavorite={false} disabled={true} />
          </div>
          <div class="flex justify-center">
            <FavoriteHeart size="lg" isFavorite={false} disabled={true} />
          </div>

          {/* readonly */}
          <div class="caption">readonly</div>
          <div class="flex justify-center">
            <FavoriteHeart size="sm" isFavorite={true} readonly={true} />
          </div>
          <div class="flex justify-center">
            <FavoriteHeart size="md" isFavorite={true} readonly={true} />
          </div>
          <div class="flex justify-center">
            <FavoriteHeart size="lg" isFavorite={true} readonly={true} />
          </div>
        </div>
      </div>
    );
  },
};
