import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CollectionCard, CollectionCardData } from "../src/components/cards/CollectionCard";
import { formatDuration, mockAlbums, mockArtists, mockGenres } from "./mockData";

const meta = {
  title: "Components/Cards/CollectionCard",
  component: CollectionCard,
  tags: ["autodocs"],
  argTypes: {
    size: {
      control: "select",
      options: ["small", "medium", "large"],
      description: "size variant",
    },
    showGenres: {
      control: "boolean",
      description: "show genres row",
    },
    showDuration: {
      control: "boolean",
      description: "show duration in metadata",
    },
    showYear: {
      control: "boolean",
      description: "show year in metadata",
    },
    showPlayCount: {
      control: "boolean",
      description: "show play count in metadata",
    },
  },
} satisfies Meta<typeof CollectionCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// sample collection data from shared mock data
const album1 = mockAlbums[0];
const sampleAlbum: CollectionCardData = {
  id: album1.id,
  title: album1.title,
  subtitle: null,
  domainType: "album",
  imageUrl: album1.thumbnailUrl,
  artist: album1.artist,
  album: album1.title,
  year: album1.year,
  trackCount: album1.trackCount,
  totalDuration: formatDuration(album1.duration),
  genres: "progressive rock, psychedelic rock, art rock",
  playCount: 1247,
};

const samplePlaylist: CollectionCardData = {
  id: "playlist-1",
  title: "Chill Vibes",
  subtitle: "smooth tunes for late night coding",
  domainType: "playlist",
  imageUrl: "https://picsum.photos/seed/playlist1/300/300",
  trackCount: 47,
  totalDuration: "3:12:45",
  playCount: 89,
};

const artist1 = mockArtists.find((a) => a.name === "Radiohead") || mockArtists[1];
const sampleArtist: CollectionCardData = {
  id: artist1.id,
  title: artist1.name,
  subtitle: null,
  domainType: "artist",
  imageUrl: `https://picsum.photos/seed/artist${artist1.id}/300/300`,
  artist: artist1.name,
  trackCount: artist1.songCount,
  genres: artist1.genres.join(", "),
};

const genre1 = mockGenres[0];
const sampleGenre: CollectionCardData = {
  id: genre1.id,
  title: genre1.name,
  subtitle: null,
  domainType: "genre",
  imageUrl: null,
  trackCount: genre1.songCount,
};

// basic album card
export const AlbumCard: Story = {
  args: {
    collection: sampleAlbum,
    size: "medium",
    showGenres: true,
    showDuration: true,
    showYear: true,
    showPlayCount: true,
  },
};

// playlist card
export const PlaylistCard: Story = {
  args: {
    collection: samplePlaylist,
    size: "medium",
    showDuration: true,
    showPlayCount: true,
  },
};

// artist card
export const ArtistCard: Story = {
  args: {
    collection: sampleArtist,
    size: "medium",
    showGenres: true,
  },
};

// genre card with fallback icon
export const GenreCard: Story = {
  args: {
    collection: sampleGenre,
    size: "medium",
  },
};

// small size
export const SmallSize: Story = {
  args: {
    collection: sampleAlbum,
    size: "small",
    showYear: true,
  },
};

// large size
export const LargeSize: Story = {
  args: {
    collection: sampleAlbum,
    size: "large",
    showGenres: true,
    showDuration: true,
    showYear: true,
  },
};

// without image (fallback icon)
export const NoImage: Story = {
  args: {
    collection: {
      ...sampleAlbum,
      imageUrl: null,
    },
    size: "medium",
    showYear: true,
  },
};

// long title with marquee
export const LongTitle: Story = {
  args: {
    collection: {
      ...sampleAlbum,
      title: "In the Court of the Crimson King: An Observation by King Crimson",
      artist: "King Crimson",
    },
    size: "medium",
    showGenres: true,
  },
};

// interactive click handlers
export const Interactive: Story = {
  render: () => {
    const [lastAction, setLastAction] = createSignal("");

    return (
      <div class="p-4 space-y-4">
        <div class="text-gray-300 text-sm space-y-1">
          <p>
            last action: <span class="text-magenta-400">{lastAction() || "none"}</span>
          </p>
        </div>
        <div class="w-48">
          <CollectionCard
            collection={sampleAlbum}
            size="medium"
            showGenres={true}
            showYear={true}
            onClick={(col) => setLastAction(`clicked: ${col.title}`)}
            onPlay={(col) => setLastAction(`play: ${col.title}`)}
            onContextMenu={(_e, col) => setLastAction(`context menu: ${col.title}`)}
          />
        </div>
        <div class="text-gray-500 text-xs">
          click the card, hover and click play button, or right-click for context menu
        </div>
      </div>
    );
  },
};

// grid of cards
export const Grid: Story = {
  render: () => {
    const albums: CollectionCardData[] = [
      sampleAlbum,
      { ...samplePlaylist, imageUrl: "https://picsum.photos/400/403" },
      { ...sampleArtist, imageUrl: "https://picsum.photos/400/404" },
      {
        ...sampleAlbum,
        id: "5",
        title: "OK Computer",
        year: 1997,
        imageUrl: "https://picsum.photos/400/405",
      },
      {
        ...sampleAlbum,
        id: "6",
        title: "Kid A",
        year: 2000,
        imageUrl: "https://picsum.photos/400/406",
      },
      {
        ...sampleAlbum,
        id: "7",
        title: "Remain in Light",
        artist: "Talking Heads",
        year: 1980,
        imageUrl: null,
      },
      {
        ...sampleAlbum,
        id: "8",
        title: "Selected Ambient Works 85-92",
        artist: "Aphex Twin",
        year: 1992,
        imageUrl: "https://picsum.photos/400/407",
      },
      {
        ...sampleAlbum,
        id: "9",
        title: "Lift Your Skinny Fists",
        artist: "Godspeed You! Black Emperor",
        year: 2000,
        imageUrl: null,
      },
    ];

    return (
      <div class="p-4">
        <div class="text-gray-300 text-xs uppercase tracking-wide mb-4">album grid</div>
        <div class="grid grid-cols-4 gap-4">
          {albums.map((album) => (
            <CollectionCard collection={album} size="medium" showYear={true} showGenres={false} />
          ))}
        </div>
      </div>
    );
  },
};

// minimal metadata
export const MinimalMetadata: Story = {
  args: {
    collection: {
      id: "10",
      title: "Untitled",
      domainType: "album",
      imageUrl: "https://picsum.photos/400/408",
    },
    size: "medium",
  },
};

// all metadata visible
export const AllMetadata: Story = {
  args: {
    collection: {
      ...sampleAlbum,
      subtitle: "remastered edition",
    },
    size: "medium",
    showGenres: true,
    showDuration: true,
    showYear: true,
    showPlayCount: true,
  },
};

// comparison of sizes
export const SizeComparison: Story = {
  render: () => (
    <div class="p-4 space-y-6">
      <div class="space-y-2">
        <div class="text-gray-300 text-xs uppercase tracking-wide">small</div>
        <div class="w-32">
          <CollectionCard collection={sampleAlbum} size="small" showYear={true} />
        </div>
      </div>
      <div class="space-y-2">
        <div class="text-gray-300 text-xs uppercase tracking-wide">medium</div>
        <div class="w-48">
          <CollectionCard collection={sampleAlbum} size="medium" showYear={true} />
        </div>
      </div>
      <div class="space-y-2">
        <div class="text-gray-300 text-xs uppercase tracking-wide">large</div>
        <div class="w-64">
          <CollectionCard collection={sampleAlbum} size="large" showYear={true} />
        </div>
      </div>
    </div>
  ),
};

// different domain types side by side
export const DomainTypes: Story = {
  render: () => (
    <div class="p-4">
      <div class="text-gray-300 text-xs uppercase tracking-wide mb-4">domain types</div>
      <div class="grid grid-cols-4 gap-4">
        <CollectionCard collection={sampleAlbum} size="medium" showYear={true} />
        <CollectionCard collection={samplePlaylist} size="medium" />
        <CollectionCard collection={sampleArtist} size="medium" />
        <CollectionCard collection={sampleGenre} size="medium" />
      </div>
    </div>
  ),
};
