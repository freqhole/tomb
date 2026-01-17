import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { StarRatingCompact } from "../src/components/ratings/StarRatingCompact";
import { formatDuration, mockSongs } from "./mockData";

const meta = {
  title: "Components/Forms/Star Rating Compact",
  component: StarRatingCompact,
  tags: ["autodocs"],
  argTypes: {
    rating: {
      control: { type: "number", min: 0, max: 5, step: 1 },
      description: "current rating value (0-5)",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg"],
      description: "size of the rating bars",
    },
    disabled: {
      control: "boolean",
      description: "disables interaction",
    },
    selected: {
      control: "boolean",
      description: "uses alternate colors for selected rows",
    },
  },
} satisfies Meta<typeof StarRatingCompact>;

export default meta;
type Story = StoryObj<typeof meta>;

// basic interactive example - cycles 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 0
export const Default: Story = {
  render: () => {
    const [rating, setRating] = createSignal(0);
    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-4">
          <StarRatingCompact
            rating={rating()}
            onRatingChange={(newRating) => {
              setRating(newRating);
              console.log("rating changed:", newRating);
            }}
          />
          <div class="caption">
            current rating: {rating()} / 5 (click to cycle through values)
          </div>
        </div>
      </div>
    );
  },
};

// all sizes
export const Sizes: Story = {
  render: () => {
    const [ratings, setRatings] = createSignal({
      sm: 3,
      md: 3,
      lg: 3,
    });

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-6">
          <div>
            <div class="caption mb-2">small</div>
            <StarRatingCompact
              size="sm"
              rating={ratings().sm}
              onRatingChange={(v) => setRatings({ ...ratings(), sm: v })}
            />
          </div>
          <div>
            <div class="caption mb-2">medium (default)</div>
            <StarRatingCompact
              size="md"
              rating={ratings().md}
              onRatingChange={(v) => setRatings({ ...ratings(), md: v })}
            />
          </div>
          <div>
            <div class="caption mb-2">large</div>
            <StarRatingCompact
              size="lg"
              rating={ratings().lg}
              onRatingChange={(v) => setRatings({ ...ratings(), lg: v })}
            />
          </div>
        </div>
      </div>
    );
  },
};

// all rating values
export const AllRatings: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-4">
        <div>
          <div class="caption mb-2">unrated (0)</div>
          <StarRatingCompact rating={0} />
        </div>
        <div>
          <div class="caption mb-2">1 star</div>
          <StarRatingCompact rating={1} />
        </div>
        <div>
          <div class="caption mb-2">2 stars</div>
          <StarRatingCompact rating={2} />
        </div>
        <div>
          <div class="caption mb-2">3 stars</div>
          <StarRatingCompact rating={3} />
        </div>
        <div>
          <div class="caption mb-2">4 stars</div>
          <StarRatingCompact rating={4} />
        </div>
        <div>
          <div class="caption mb-2">5 stars</div>
          <StarRatingCompact rating={5} />
        </div>
      </div>
    </div>
  ),
};

// different states
export const States: Story = {
  render: () => {
    const [rating, setRating] = createSignal(3);

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-6">
          <div>
            <div class="caption mb-2">interactive</div>
            <StarRatingCompact
              rating={rating()}
              onRatingChange={(v) => setRating(v)}
            />
          </div>

          <div>
            <div class="caption mb-2">disabled</div>
            <StarRatingCompact rating={3} disabled={true} />
          </div>

          <div>
            <div class="caption mb-2">selected row variant</div>
            <div class="bg-[var(--color-bg-hover)] p-2 inline-block rounded">
              <StarRatingCompact rating={4} selected={true} />
            </div>
          </div>

          <div>
            <div class="caption mb-2">normal row variant</div>
            <div class="bg-[var(--color-bg-primary)] p-2 inline-block rounded">
              <StarRatingCompact rating={4} selected={false} />
            </div>
          </div>
        </div>
      </div>
    );
  },
};

// in context - song list
export const InSongList: Story = {
  render: () => {
    const songs = mockSongs.slice(0, 3);
    const [ratings, setRatings] = createSignal({
      [songs[0].id]: 0,
      [songs[1].id]: 4,
      [songs[2].id]: 5,
    });

    const updateRating = (songId: string, newRating: number) => {
      setRatings({
        ...ratings(),
        [songId]: newRating,
      });
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <div class="caption mb-4">song list with star ratings</div>
          <div class="space-y-2">
            {songs.map((song) => (
              <div class="flex items-center gap-4 p-2 bg-[var(--color-bg-secondary)] rounded">
                <div class="flex-1 body-small text-[var(--color-text-primary)]">
                  {song.title}
                </div>
                <div class="body-xs text-[var(--color-text-tertiary)]">
                  {song.artist}
                </div>
                <StarRatingCompact
                  size="sm"
                  rating={ratings()[song.id]}
                  onRatingChange={(v) => updateRating(song.id, v)}
                />
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
          <div class="caption mb-2">
            hover over these to see scale transition
          </div>
          <div class="flex gap-8 items-center">
            <div class="text-center">
              <StarRatingCompact rating={0} onRatingChange={() => {}} />
              <div class="caption mt-2">unrated</div>
            </div>
            <div class="text-center">
              <StarRatingCompact rating={3} onRatingChange={() => {}} />
              <div class="caption mt-2">3 stars</div>
            </div>
            <div class="text-center">
              <StarRatingCompact rating={5} onRatingChange={() => {}} />
              <div class="caption mt-2">5 stars</div>
            </div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">disabled has no hover effect</div>
          <div class="flex gap-8 items-center">
            <div class="text-center">
              <StarRatingCompact rating={0} disabled={true} />
              <div class="caption mt-2">disabled 0</div>
            </div>
            <div class="text-center">
              <StarRatingCompact rating={3} disabled={true} />
              <div class="caption mt-2">disabled 3</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
};

// cycling behavior demo
export const CyclingBehavior: Story = {
  render: () => {
    const [rating, setRating] = createSignal(0);
    const [history, setHistory] = createSignal<number[]>([0]);

    const handleRatingChange = (newRating: number) => {
      setRating(newRating);
      setHistory([...history(), newRating]);
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-4">
          <div>
            <div class="caption mb-2">
              click to cycle: 0 → 1 → 2 → 3 → 4 → 5 → 0
            </div>
            <StarRatingCompact
              rating={rating()}
              onRatingChange={handleRatingChange}
            />
          </div>

          <div>
            <div class="caption mb-2">current value</div>
            <div class="body-base text-[var(--color-text-primary)]">
              {rating()} / 5
            </div>
          </div>

          <div>
            <div class="caption mb-2">click history</div>
            <div class="monospace text-[var(--color-text-secondary)] body-small">
              {history().join(" → ")}
            </div>
          </div>
        </div>
      </div>
    );
  },
};

// grid showing all combinations
export const AllCombinations: Story = {
  render: () => {
    const [interactive, setInteractive] = createSignal(3);

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="caption mb-4">
          all size and rating combinations (top row is interactive)
        </div>
        <div class="grid grid-cols-7 gap-4 items-center">
          {/* headers */}
          <div></div>
          <div class="caption text-center">0</div>
          <div class="caption text-center">1</div>
          <div class="caption text-center">2</div>
          <div class="caption text-center">3</div>
          <div class="caption text-center">4</div>
          <div class="caption text-center">5</div>

          {/* small */}
          <div class="caption">sm</div>
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <div class="flex justify-center">
              <StarRatingCompact
                size="sm"
                rating={r === 3 ? interactive() : r}
                onRatingChange={r === 3 ? setInteractive : undefined}
              />
            </div>
          ))}

          {/* medium */}
          <div class="caption">md</div>
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <div class="flex justify-center">
              <StarRatingCompact size="md" rating={r} />
            </div>
          ))}

          {/* large */}
          <div class="caption">lg</div>
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <div class="flex justify-center">
              <StarRatingCompact size="lg" rating={r} />
            </div>
          ))}
        </div>
      </div>
    );
  },
};

// combined with favorite heart
export const WithFavoriteHeart: Story = {
  render: () => {
    const [songs, setSongs] = createSignal(
      mockSongs.slice(0, 4).map((s, i) => ({
        id: s.id,
        title: s.title,
        rating: [0, 4, 5, 5][i],
        favorite: [false, true, false, true][i],
      })),
    );

    const updateRating = (id: string, rating: number) => {
      setSongs(songs().map((s) => (s.id === id ? { ...s, rating } : s)));
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <div class="caption mb-4">ratings and favorites together</div>
          <div class="space-y-2">
            {songs().map((song) => (
              <div class="flex items-center gap-4 p-3 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                <div class="flex-1 body-small text-[var(--color-text-primary)]">
                  {song.title}
                </div>
                <StarRatingCompact
                  size="sm"
                  rating={song.rating}
                  onRatingChange={(v) => updateRating(song.id, v)}
                />
                <div
                  class={`w-3 h-3 rounded-full ${
                    song.favorite
                      ? "bg-[var(--color-accent-500)]"
                      : "bg-[var(--color-border-default)]"
                  }`}
                  title={song.favorite ? "favorited" : "not favorited"}
                />
              </div>
            ))}
          </div>
          <div class="caption mt-4">
            click the star ratings to cycle through values
          </div>
        </div>
      </div>
    );
  },
};
