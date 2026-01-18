// storybook story for AlbumSection component
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AlbumSection } from "../src/components/albums/AlbumSection";

const meta = {
  title: "Components/Albums/AlbumSection",
  component: AlbumSection,
  tags: ["autodocs"],
  argTypes: {
    albumTitle: { control: "text" },
    year: { control: "number" },
    playingSongId: { control: "text" },
  },
} satisfies Meta<typeof AlbumSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockSongs = [
  {
    id: "1",
    title: "speak to me",
    trackNumber: 1,
    discNumber: 1,
    duration: 90,
  },
  {
    id: "2",
    title: "breathe (in the air)",
    trackNumber: 2,
    discNumber: 1,
    duration: 163,
  },
  {
    id: "3",
    title: "on the run",
    trackNumber: 3,
    discNumber: 1,
    duration: 216,
  },
  {
    id: "4",
    title: "time",
    trackNumber: 4,
    discNumber: 1,
    duration: 413,
  },
  {
    id: "5",
    title: "the great gig in the sky",
    trackNumber: 5,
    discNumber: 1,
    duration: 284,
  },
];

const multiDiscSongs = [
  {
    id: "1",
    title: "shine on you crazy diamond (parts i-v)",
    trackNumber: 1,
    discNumber: 1,
    duration: 810,
  },
  {
    id: "2",
    title: "welcome to the machine",
    trackNumber: 2,
    discNumber: 1,
    duration: 456,
  },
  {
    id: "3",
    title: "have a cigar",
    trackNumber: 3,
    discNumber: 1,
    duration: 312,
  },
  {
    id: "4",
    title: "wish you were here",
    trackNumber: 1,
    discNumber: 2,
    duration: 334,
  },
  {
    id: "5",
    title: "shine on you crazy diamond (parts vi-ix)",
    trackNumber: 2,
    discNumber: 2,
    duration: 750,
  },
];

export const Default: Story = {
  args: {
    albumId: "album-1",
    albumTitle: "the dark side of the moon",
    year: 1973,
    songs: mockSongs,
  },
};

export const WithPlayingSong: Story = {
  args: {
    albumId: "album-1",
    albumTitle: "the dark side of the moon",
    year: 1973,
    songs: mockSongs,
    playingSongId: "4",
  },
};

export const MultiDisc: Story = {
  args: {
    albumId: "album-2",
    albumTitle: "wish you were here",
    year: 1975,
    songs: multiDiscSongs,
  },
};

export const NoYear: Story = {
  args: {
    albumId: "album-3",
    albumTitle: "unknown album",
    songs: mockSongs.slice(0, 3),
  },
};

export const SingleSong: Story = {
  args: {
    albumId: "album-4",
    albumTitle: "single release",
    year: 2024,
    songs: [
      {
        id: "1",
        title: "the only song",
        trackNumber: 1,
        discNumber: 1,
        duration: 245,
      },
    ],
  },
};

export const LongAlbumTitle: Story = {
  args: {
    albumId: "album-5",
    albumTitle:
      "a very long album title that should truncate nicely in the interface",
    year: 2020,
    songs: mockSongs,
  },
};
