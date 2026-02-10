import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  TopNav,
  type NavMenuItem,
  type NavMenuSection,
  type RecentPlaylist,
} from "../src/components/navigation/TopNav";
import { mockPlaylists } from "./mockData";

const meta = {
  title: "Components/Navigation/TopNav",
  component: TopNav,
  tags: ["autodocs"],
  argTypes: {
    brandName: {
      control: "text",
      description: "brand name",
    },
    brandTagline: {
      control: "text",
      description: "brand tagline/description",
    },
    version: {
      control: "text",
      description: "version text",
    },
    searchPlaceholder: {
      control: "text",
      description: "search input placeholder",
    },
  },
} satisfies Meta<typeof TopNav>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockMainNavSections: NavMenuSection[] = [
  {
    items: [
      {
        label: "feed",
        onClick: () => console.log("navigate to feed"),
      },
      {
        label: "songs",
        onClick: () => console.log("navigate to songs"),
      },
      {
        label: "artists",
        onClick: () => console.log("navigate to artists"),
      },
      {
        label: "albums",
        onClick: () => console.log("navigate to albums"),
      },
      {
        label: "genres",
        onClick: () => console.log("navigate to genres"),
      },
    ],
  },
  {
    items: [
      {
        label: "add music",
        onClick: () => console.log("open add music"),
      },
      {
        label: "analytics",
        onClick: () => console.log("open analytics"),
      },
    ],
  },
  {
    items: [
      {
        label: "logout",
        onClick: () => console.log("logout"),
      },
    ],
  },
];

const mockRecentPlaylists: RecentPlaylist[] = mockPlaylists
  .slice(0, 5)
  .map((playlist, index) => ({
    id: playlist.id,
    name: playlist.name,
    thumbnailUrl: null,
    updatedAt: Date.now() - index * 3600000, // stagger by 1 hour each
    onClick: () => console.log("open playlist:", playlist.name),
  }));

// interactive example with full layout
export const Interactive: Story = {
  render: () => {
    const [searchQuery, setSearchQuery] = createSignal("");

    return (
      <div class="h-screen flex flex-col bg-[var(--color-bg-secondary)]">
        <TopNav
          brandName="freqhole"
          brandTagline="your personal music server"
          version="v0.1.0-alpha"
          searchQuery={searchQuery()}
          onSearchChange={(query) => {
            console.log("search changed:", query);
            setSearchQuery(query);
          }}
          onSearchSubmit={(query) => console.log("search submitted:", query)}
          searchPlaceholder="search artists, albums, songs..."
          mainNavSections={mockMainNavSections}
          recentPlaylists={mockRecentPlaylists}
          onViewAllPlaylists={() => console.log("view all playlists")}
          onCreatePlaylist={() => console.log("create playlist")}
        />

        {/* main content area - two column layout */}
        <div class="flex-1 flex overflow-hidden">
          {/* left column */}
          <div class="flex-1 overflow-y-auto p-8">
            <h1 class="text-2xl font-bold text-[var(--color-text-primary)] my-8">
              artists
            </h1>
            <div class="space-y-2">
              {Array.from({ length: 20 }, (_, i) => (
                <div class="p-4 bg-[var(--color-bg-tertiary)] rounded-lg text-[var(--color-text-primary)]">
                  artist {i + 1}
                </div>
              ))}
            </div>
          </div>

          {/* right column */}
          <div class="flex-1 overflow-y-auto p-8 border-l border-[var(--color-border-default)]">
            <h2 class="text-xl font-bold text-[var(--color-text-primary)] mb-4">
              artist detail
            </h2>
            <div class="space-y-2 text-[var(--color-text-secondary)] text-sm">
              <p>click the brand icon to open 3-column flyout menu</p>
              <p>click the search icon to expand search</p>
              <p>
                current search:{" "}
                <span class="text-[var(--color-accent-500)]">
                  {searchQuery() || "(empty)"}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  },
};
