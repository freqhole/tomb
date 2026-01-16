import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  PlayerBar,
  type PlayerBarSong,
} from "../src/components/player/PlayerBar";

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

const mockSong: PlayerBarSong = {
  id: "1",
  title:
    "paranoid android - remastered 2009 - extended edition with bonus tracks and live recordings",
  artist: "radiohead",
  album: "ok computer",
  thumbnailUrl:
    "https://lastfm.freetls.fastly.net/i/u/300x300/c6f59c1e5e7240a4c0d427abd71f3dbb.jpg",
  isFavorite: false,
};

const mockSongNoThumbnail: PlayerBarSong = {
  id: "2",
  title: "comfortably numb - live at earls court 1994 - extended version",
  artist: "pink floyd",
  album: "the wall",
  isFavorite: true,
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
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
    queueLength: 8,
  },
};

// paused state
export const Paused: Story = {
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// no thumbnail
export const NoThumbnail: Story = {
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// favorited song
export const Favorited: Story = {
  render: (args) => (
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
    onFavoriteToggle: (id) => console.log("toggle favorite:", id),
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// queue open
export const QueueOpen: Story = {
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
    queueLength: 15,
  },
};

// at start of playlist
export const AtStart: Story = {
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// at end of playlist
export const AtEnd: Story = {
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// muted
export const Muted: Story = {
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// long song title
export const LongTitle: Story = {
  render: (args) => (
    <div class="relative min-h-[120px]">
      <PlayerBar {...args} />
    </div>
  ),
  args: {
    song: {
      id: "3",
      title:
        "the epic song with an extremely long title that should truncate properly",
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};

// no song (should not render)
export const NoSong: Story = {
  render: (args) => (
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
    onSeek: (p) => console.log("seek:", p),
    onVolumeChange: (v) => console.log("volume:", v),
    onQueueToggle: () => console.log("toggle queue"),
  },
};
