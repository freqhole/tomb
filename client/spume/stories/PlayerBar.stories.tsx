import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  PlayerBar,
  type PlayerBarSong,
  type PlayerBarProps,
} from "../src/components/player/PlayerBar";
import { mockSongs } from "./mockData";

const meta = {
  title: "Components/Player/PlayerBar",
  component: PlayerBar,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div class="relative min-h-[120px]">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    isPlaying: {
      control: "boolean",
      description: "whether audio is playing",
    },
    queueOpen: {
      control: "boolean",
      description: "whether queue is open",
    },
  },
} satisfies Meta<typeof PlayerBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// use mock songs from shared data
const mockSong: PlayerBarSong = {
  id: mockSongs[8].id,
  title: mockSongs[8].title,
  artist: mockSongs[8].artist,
  album: mockSongs[8].album,
  thumbnailUrl: mockSongs[8].thumbnailUrl,
  isFavorite: mockSongs[8].isFavorite,
};

const mockSongNoThumbnail: PlayerBarSong = {
  id: mockSongs[0].id,
  title: mockSongs[0].title,
  artist: mockSongs[0].artist,
  album: mockSongs[0].album,
  isFavorite: mockSongs[0].isFavorite,
};

// interactive example
export const Interactive: Story = {
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [currentTime, setCurrentTime] = createSignal(45);
    const [duration] = createSignal(383);
    const [volume, setVolume] = createSignal(0.7);
    const [queueOpen, setQueueOpen] = createSignal(false);
    const [song, setSong] = createSignal(mockSong);
    const [isFavorite, setIsFavorite] = createSignal(false);

    const handlePlayPause = () => {
      setIsPlaying(!isPlaying());
      console.log(isPlaying() ? "playing" : "paused");
    };

    const handlePrevious = () => {
      console.log("previous track");
      setCurrentTime(0);
    };

    const handleNext = () => {
      console.log("next track");
      setCurrentTime(0);
    };

    const handleSeek = (percentage: number) => {
      const newTime = (percentage / 100) * duration();
      setCurrentTime(newTime);
      console.log("seek to:", newTime);
    };

    const handleVolumeChange = (newVolume: number) => {
      setVolume(newVolume);
      console.log("volume:", newVolume);
    };

    const handleQueueToggle = () => {
      setQueueOpen(!queueOpen());
      console.log("queue:", !queueOpen());
    };

    const handleFavoriteToggle = (songId: string) => {
      setIsFavorite(!isFavorite());
      console.log("favorite toggled for:", songId);
    };

    // simulate playback
    const interval = setInterval(() => {
      if (isPlaying()) {
        setCurrentTime((t) => {
          if (t >= duration()) {
            setIsPlaying(false);
            return duration();
          }
          return t + 1;
        });
      }
    }, 1000);

    return (
      <div class="relative min-h-[120px]">
        <PlayerBar
          song={{ ...song(), isFavorite: isFavorite() }}
          isPlaying={isPlaying()}
          currentTime={currentTime()}
          duration={duration()}
          volume={volume()}
          queueOpen={queueOpen()}
          onPlayPause={handlePlayPause}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onFavoriteToggle={handleFavoriteToggle}
          onSeek={handleSeek}
          onVolumeChange={handleVolumeChange}
          onQueueToggle={handleQueueToggle}
          queueLength={12}
        />
      </div>
    );
  },
};

// playing state
export const Playing: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: mockSong,
    isPlaying: true,
    currentTime: 125,
    duration: 383,
    volume: 0.8,
    queueOpen: false,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
    queueLength: 8,
  },
};

// paused state
export const Paused: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: mockSong,
    isPlaying: false,
    currentTime: 0,
    duration: 383,
    volume: 0.8,
    queueOpen: false,
    onPlayPause: () => console.log("play"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// no thumbnail
export const NoThumbnail: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: mockSongNoThumbnail,
    isPlaying: true,
    currentTime: 45,
    duration: 389,
    volume: 0.8,
    queueOpen: false,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// favorited song
export const Favorited: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: { ...mockSong, isFavorite: true },
    isPlaying: true,
    currentTime: 200,
    duration: 383,
    volume: 0.8,
    queueOpen: false,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onFavoriteToggle: (id: string) => console.log("toggle favorite:", id),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// queue open
export const QueueOpen: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: mockSong,
    isPlaying: true,
    currentTime: 125,
    duration: 383,
    volume: 0.8,
    queueOpen: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
    queueLength: 15,
  },
};

// at start of playlist
export const AtStart: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: mockSong,
    isPlaying: true,
    currentTime: 5,
    duration: 383,
    volume: 0.8,
    queueOpen: false,
    canGoPrevious: false,
    canGoNext: true,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// at end of playlist
export const AtEnd: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: mockSong,
    isPlaying: false,
    currentTime: 383,
    duration: 383,
    volume: 0.8,
    queueOpen: false,
    canGoPrevious: true,
    canGoNext: false,
    onPlayPause: () => console.log("play"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// muted
export const Muted: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: mockSong,
    isPlaying: true,
    currentTime: 125,
    duration: 383,
    volume: 0,
    queueOpen: false,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// long song title
export const LongTitle: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: {
      id: "3",
      title: "the epic song with an extremely long title that should truncate properly",
      artist: "an artist with a really long name that also needs truncation",
      album: "the album",
      isFavorite: false,
    },
    isPlaying: true,
    currentTime: 180,
    duration: 720,
    volume: 0.8,
    queueOpen: false,
    onPlayPause: () => console.log("pause"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// no song (should not render)
export const NoSong: Story = {
  render: (args: PlayerBarProps) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    queueOpen: false,
    onPlayPause: () => console.log("play"),
    onPrevious: () => console.log("previous"),
    onNext: () => console.log("next"),
    onSeek: (p: number) => console.log("seek:", p),
    onVolumeChange: (v: number) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// ============================================================================
// responsive / narrow viewport stories
// ============================================================================

// narrow viewport - playing
export const NarrowPlaying: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(true);
    const [currentTime, setCurrentTime] = createSignal(125);
    const [queueOpen, setQueueOpen] = createSignal(false);

    return (
      <div class="relative w-[320px] min-h-[100px]">
        <PlayerBar
          song={mockSong}
          isPlaying={isPlaying()}
          currentTime={currentTime()}
          duration={383}
          volume={0.8}
          queueOpen={queueOpen()}
          onPlayPause={() => setIsPlaying(!isPlaying())}
          onPrevious={() => setCurrentTime(0)}
          onNext={() => console.log("next")}
          onFavoriteToggle={(id) => console.log("favorite:", id)}
          onSeek={(p) => setCurrentTime((p / 100) * 383)}
          onVolumeChange={(v) => console.log("volume:", v)}
          onQueueToggle={() => setQueueOpen(!queueOpen())}
          queueLength={8}
        />
      </div>
    );
  },
};

// narrow viewport - long title
export const NarrowLongTitle: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(true);
    const [currentTime, setCurrentTime] = createSignal(180);

    return (
      <div class="relative w-[320px] min-h-[100px]">
        <PlayerBar
          song={{
            id: "long",
            title: "the epic song with an extremely long title that should marquee",
            artist: "an artist with a really long name that also needs marquee animation",
            album: "the album",
            isFavorite: true,
          }}
          isPlaying={isPlaying()}
          currentTime={currentTime()}
          duration={720}
          volume={0.8}
          queueOpen={false}
          onPlayPause={() => setIsPlaying(!isPlaying())}
          onPrevious={() => console.log("previous")}
          onNext={() => console.log("next")}
          onFavoriteToggle={(id) => console.log("favorite:", id)}
          onSeek={(p) => setCurrentTime((p / 100) * 720)}
          onVolumeChange={(v) => console.log("volume:", v)}
          onQueueToggle={() => console.log("queue")}
          queueLength={15}
        />
      </div>
    );
  },
};

// narrow viewport - no song
export const NarrowNoSong: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => (
    <div class="relative w-[320px] min-h-[100px]">
      <PlayerBar
        isPlaying={false}
        currentTime={0}
        duration={0}
        volume={0.8}
        queueOpen={false}
        onPlayPause={() => console.log("play")}
        onPrevious={() => console.log("previous")}
        onNext={() => console.log("next")}
        onSeek={(p) => console.log("seek:", p)}
        onVolumeChange={(v) => console.log("volume:", v)}
        onQueueToggle={() => console.log("queue")}
      />
    </div>
  ),
};

// narrow viewport - with queue badge
export const NarrowWithQueue: Story = {
  parameters: {
    viewport: {
      defaultViewport: "mobile1",
    },
  },
  render: () => {
    const [queueOpen, setQueueOpen] = createSignal(false);

    return (
      <div class="relative w-[320px] min-h-[100px]">
        <PlayerBar
          song={mockSong}
          isPlaying={true}
          currentTime={45}
          duration={383}
          volume={0.8}
          queueOpen={queueOpen()}
          onPlayPause={() => console.log("pause")}
          onPrevious={() => console.log("previous")}
          onNext={() => console.log("next")}
          onFavoriteToggle={(id) => console.log("favorite:", id)}
          onSeek={(p) => console.log("seek:", p)}
          onVolumeChange={(v) => console.log("volume:", v)}
          onQueueToggle={() => setQueueOpen(!queueOpen())}
          queueLength={24}
        />
      </div>
    );
  },
};

// comparison: narrow vs wide side by side
export const ResponsiveComparison: Story = {
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(true);
    const [currentTime, setCurrentTime] = createSignal(125);

    return (
      <div class="space-y-8 p-4">
        <div>
          <h3 class="text-lg font-medium text-[var(--color-text-primary)] mb-2">
            narrow viewport (320px) - 2 rows
          </h3>
          <div class="relative w-[320px] bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden">
            <PlayerBar
              song={mockSong}
              isPlaying={isPlaying()}
              currentTime={currentTime()}
              duration={383}
              volume={0.8}
              queueOpen={false}
              onPlayPause={() => setIsPlaying(!isPlaying())}
              onPrevious={() => setCurrentTime(0)}
              onNext={() => console.log("next")}
              onFavoriteToggle={(id) => console.log("favorite:", id)}
              onSeek={(p) => setCurrentTime((p / 100) * 383)}
              onVolumeChange={(v) => console.log("volume:", v)}
              onQueueToggle={() => console.log("queue")}
              queueLength={8}
              class="!relative"
            />
          </div>
        </div>

        <div>
          <h3 class="text-lg font-medium text-[var(--color-text-primary)] mb-2">
            wide viewport (768px+) - 1 row
          </h3>
          <div class="relative w-[900px] bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden">
            <PlayerBar
              song={mockSong}
              isPlaying={isPlaying()}
              currentTime={currentTime()}
              duration={383}
              volume={0.8}
              queueOpen={false}
              onPlayPause={() => setIsPlaying(!isPlaying())}
              onPrevious={() => setCurrentTime(0)}
              onNext={() => console.log("next")}
              onFavoriteToggle={(id) => console.log("favorite:", id)}
              onSeek={(p) => setCurrentTime((p / 100) * 383)}
              onVolumeChange={(v) => console.log("volume:", v)}
              onQueueToggle={() => console.log("queue")}
              queueLength={8}
              class="!relative"
            />
          </div>
        </div>
      </div>
    );
  },
};
