// storybook story for SongRow component
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SongRow } from "../src/components/songs/SongRow";

const meta = {
  title: "Components/Songs/SongRow",
  component: SongRow,
  tags: ["autodocs"],
  argTypes: {
    title: { control: "text" },
    trackNumber: { control: "text" },
    duration: { control: "text" },
    isSelected: { control: "boolean" },
    isPlaying: { control: "boolean" },
    showPlayOnHover: { control: "boolean" },
  },
} satisfies Meta<typeof SongRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "bohemian rhapsody",
    trackNumber: "1",
    duration: "5:55",
  },
};

export const WithDiscNumber: Story = {
  args: {
    title: "in the court of the crimson king",
    trackNumber: "2-3",
    duration: "9:23",
  },
};

export const Selected: Story = {
  args: {
    title: "stairway to heaven",
    trackNumber: "4",
    duration: "8:02",
    isSelected: true,
  },
};

export const Playing: Story = {
  args: {
    title: "comfortably numb",
    trackNumber: "6",
    duration: "6:23",
    isPlaying: true,
  },
};

export const WithPlayOnHover: Story = {
  args: {
    title: "shine on you crazy diamond",
    trackNumber: "1",
    duration: "13:31",
    showPlayOnHover: true,
  },
};

export const LongTitle: Story = {
  args: {
    title: "the greatest adventure is what lies ahead (from the hobbit)",
    trackNumber: "12",
    duration: "4:15",
  },
};

export const NoTrackNumber: Story = {
  args: {
    title: "untitled track",
    duration: "2:34",
  },
};
