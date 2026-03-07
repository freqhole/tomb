import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  PlayerBar,
  type PlayerBarSong,
  type PlayerBarProps,
} from "../src/components/player/PlayerBar";
import { mockSongs } from "./mockData";
import waveformImage from "../../../assets/waveform.webp";

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
  images: [
    { remote_url: mockSongs[8].thumbnailUrl, is_primary: true, blob_type: "thumbnail" },
    { remote_url: waveformImage, is_primary: false, blob_type: "waveform" },
  ],
};

// interactive example
export const Interactive: Story = {
  render: () => {
    const [isPlaying, setIsPlaying] = createSignal(false);
    const [isLoading, setIsLoading] = createSignal(false);
    const [currentTime, setCurrentTime] = createSignal(45);
    const [duration] = createSignal(383);
    const [volume, setVolume] = createSignal(0.7);
    const [queueOpen, setQueueOpen] = createSignal(false);
    const [song, setSong] = createSignal(mockSong);
    const [isFavorite, setIsFavorite] = createSignal(false);
    void setSong; // may be used for dynamic song switching later

    const handlePlayPause = () => {
      if (isLoading()) return;
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

    // simulate loading delay
    const simulateLoading = () => {
      setIsLoading(true);
      setIsPlaying(false);
      setTimeout(() => {
        setIsLoading(false);
        setIsPlaying(true);
      }, 3000);
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
    void interval; // tracked for cleanup

    return (
      <div class="relative min-h-[200px]">
        {/* control buttons for story */}
        <div class="mb-4 p-4 bg-[var(--color-bg-secondary)] rounded-lg flex gap-4 items-center">
          <button
            onClick={() => setIsLoading(!isLoading())}
            class={`px-3 py-1.5 rounded text-sm transition-colors ${
              isLoading()
                ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
            }`}
          >
            loading: {isLoading() ? "on" : "off"}
          </button>
          <button
            onClick={simulateLoading}
            class="px-3 py-1.5 bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] rounded text-sm transition-colors"
          >
            simulate 3s load
          </button>
          <span class="text-xs text-[var(--color-text-muted)]">
            {isLoading() ? "loading song..." : isPlaying() ? "playing" : "paused"}
          </span>
        </div>

        <PlayerBar
          song={{ ...song(), isFavorite: isFavorite() }}
          isPlaying={isPlaying()}
          isLoading={isLoading()}
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
