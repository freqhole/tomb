import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MediaImage } from "../src/components/media/MediaImage";

const meta = {
  title: "Components/Media/MediaImage",
  component: MediaImage,
  tags: ["autodocs"],
  argTypes: {
    imageUrl: {
      control: "text",
      description: "direct image url (can be null)",
    },
    alt: {
      control: "text",
      description: "alt text for accessibility",
    },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "size variant",
    },
    domainType: {
      control: "select",
      options: ["song", "album", "artist", "genre", "playlist"],
      description: "domain type for appropriate fallback icon",
    },
    enableAlbumHover: {
      control: "boolean",
      description: "enable album card hover effect (bg-cover → bg-contain + scale)",
    },
    showFallback: {
      control: "boolean",
      description: "show fallback icon when no image",
    },
  },
} satisfies Meta<typeof MediaImage>;

export default meta;
type Story = StoryObj<typeof meta>;

// sample album art url
const sampleAlbumUrl = "https://picsum.photos/400/400";
const sampleArtistUrl = "https://picsum.photos/400/401";

// default with image
export const Default: Story = {
  args: {
    imageUrl: sampleAlbumUrl,
    alt: "album artwork",
    size: "md",
    enableAlbumHover: false,
    showFallback: true,
  },
};

// with hover effect
export const WithHover: Story = {
  args: {
    imageUrl: sampleAlbumUrl,
    alt: "album artwork",
    size: "lg",
    enableAlbumHover: true,
    showFallback: true,
  },
};

// all sizes
export const AllSizes: Story = {
  render: () => (
    <div class="p-4 space-y-4">
      <div class="text-gray-300 text-xs uppercase tracking-wide mb-2">
        size variants
      </div>
      <div class="flex gap-4 items-end flex-wrap">
        <div class="space-y-1">
          <MediaImage
            imageUrl={sampleAlbumUrl}
            alt="extra small"
            size="xs"
          />
          <div class="text-xs text-gray-400 text-center">xs</div>
        </div>
        <div class="space-y-1">
          <MediaImage
            imageUrl={sampleAlbumUrl}
            alt="small"
            size="sm"
          />
          <div class="text-xs text-gray-400 text-center">sm</div>
        </div>
        <div class="space-y-1">
          <MediaImage
            imageUrl={sampleAlbumUrl}
            alt="medium"
            size="md"
          />
          <div class="text-xs text-gray-400 text-center">md</div>
        </div>
        <div class="space-y-1">
          <MediaImage
            imageUrl={sampleAlbumUrl}
            alt="large"
            size="lg"
          />
          <div class="text-xs text-gray-400 text-center">lg</div>
        </div>
        <div class="space-y-1">
          <MediaImage
            imageUrl={sampleAlbumUrl}
            alt="extra large"
            size="xl"
          />
          <div class="text-xs text-gray-400 text-center">xl</div>
        </div>
      </div>
    </div>
  ),
};

// fallback icons for different domain types
export const FallbackIcons: Story = {
  render: () => (
    <div class="p-4 space-y-4">
      <div class="text-gray-300 text-xs uppercase tracking-wide mb-2">
        fallback icons by domain type
      </div>
      <div class="flex gap-4 flex-wrap">
        <div class="space-y-2 text-center">
          <MediaImage
            imageUrl={null}
            alt="song"
            size="lg"
            domainType="song"
            showFallback={true}
          />
          <div class="text-xs text-gray-400">song</div>
        </div>
        <div class="space-y-2 text-center">
          <MediaImage
            imageUrl={null}
            alt="album"
            size="lg"
            domainType="album"
            showFallback={true}
          />
          <div class="text-xs text-gray-400">album</div>
        </div>
        <div class="space-y-2 text-center">
          <MediaImage
            imageUrl={null}
            alt="artist"
            size="lg"
            domainType="artist"
            showFallback={true}
          />
          <div class="text-xs text-gray-400">artist</div>
        </div>
        <div class="space-y-2 text-center">
          <MediaImage
            imageUrl={null}
            alt="playlist"
            size="lg"
            domainType="playlist"
            showFallback={true}
          />
          <div class="text-xs text-gray-400">playlist</div>
        </div>
        <div class="space-y-2 text-center">
          <MediaImage
            imageUrl={null}
            alt="genre"
            size="lg"
            domainType="genre"
            showFallback={true}
          />
          <div class="text-xs text-gray-400">genre</div>
        </div>
      </div>
    </div>
  ),
};

// no fallback (just background)
export const NoFallback: Story = {
  args: {
    imageUrl: null,
    alt: "no image",
    size: "lg",
    showFallback: false,
  },
};

// loading state simulation
export const LoadingState: Story = {
  render: () => {
    const [imageUrl, setImageUrl] = createSignal<string | null>(null);
    const [loading, setLoading] = createSignal(false);

    const loadImage = () => {
      setLoading(true);
      setImageUrl(null);
      setTimeout(() => {
        setImageUrl(`${sampleAlbumUrl}?t=${Date.now()}`);
        setLoading(false);
      }, 2000);
    };

    return (
      <div class="p-4 space-y-4">
        <div class="text-gray-300 text-sm">
          {loading() ? "loading..." : "image loaded"}
        </div>
        <MediaImage
          imageUrl={imageUrl()}
          alt="loading test"
          size="xl"
          domainType="album"
        />
        <button
          onClick={loadImage}
          disabled={loading()}
          class="px-4 py-2 bg-magenta-500 text-white rounded hover:bg-magenta-600 disabled:opacity-50"
        >
          {loading() ? "loading..." : "load image"}
        </button>
      </div>
    );
  },
};

// error handling (invalid url)
export const ErrorHandling: Story = {
  args: {
    imageUrl: "https://invalid-url-that-will-fail.example/image.jpg",
    alt: "broken image",
    size: "lg",
    domainType: "album",
    showFallback: true,
  },
};

// in grid layout
export const InGrid: Story = {
  render: () => (
    <div class="p-4">
      <div class="text-gray-300 text-xs uppercase tracking-wide mb-4">
        grid of album covers
      </div>
      <div class="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <MediaImage
            imageUrl={i % 3 === 0 ? null : `https://picsum.photos/200/200?random=${i}`}
            alt={`album ${i + 1}`}
            size="lg"
            domainType="album"
            enableAlbumHover={true}
          />
        ))}
      </div>
    </div>
  ),
};

// different aspect ratios with custom classes
export const CustomClasses: Story = {
  render: () => (
    <div class="p-4 space-y-4">
      <div class="text-gray-300 text-xs uppercase tracking-wide mb-2">
        custom styling
      </div>
      <div class="flex gap-4 flex-wrap">
        <MediaImage
          imageUrl={sampleAlbumUrl}
          alt="rounded full"
          size="lg"
          class="rounded-full"
        />
        <MediaImage
          imageUrl={sampleAlbumUrl}
          alt="with border"
          size="lg"
          class="border-4 border-magenta-500"
        />
        <MediaImage
          imageUrl={sampleAlbumUrl}
          alt="with shadow"
          size="lg"
          class="shadow-2xl"
        />
      </div>
    </div>
  ),
};
