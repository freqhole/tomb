// entity images stories
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EntityImages } from "../src/components/layout/EntityImages";
import type { ImageMetadata } from "../src/music/services/storage/types";

const meta = {
  title: "Components/Layout/EntityImages",
  component: EntityImages,
  tags: ["autodocs"],
} satisfies Meta<typeof EntityImages>;

export default meta;
type Story = StoryObj<typeof meta>;

// mock images for testing
const mockImages: ImageMetadata[] = [
  {
    local_blob_id: null,
    remote_url: "https://picsum.photos/seed/1/200",
    is_primary: true,
    blob_type: "thumbnail",
  },
  {
    local_blob_id: null,
    remote_url: "https://picsum.photos/seed/2/200",
    is_primary: false,
    blob_type: "thumbnail",
  },
  {
    local_blob_id: null,
    remote_url: "https://picsum.photos/seed/3/200",
    is_primary: false,
    blob_type: "thumbnail",
  },
  {
    local_blob_id: null,
    remote_url: "https://picsum.photos/seed/4/200",
    is_primary: false,
    blob_type: "thumbnail",
  },
  {
    local_blob_id: null,
    remote_url: "https://picsum.photos/seed/5/200",
    is_primary: false,
    blob_type: "thumbnail",
  },
];

export const Empty: Story = {
  render: () => {
    const [images, setImages] = createSignal<ImageMetadata[]>([]);
    const [uploading, setUploading] = createSignal(false);

    const handleUpload = async (file: File) => {
      console.log("uploading:", file.name);
      setUploading(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setImages([
        ...images(),
        {
          local_blob_id: null,
          remote_url: `https://picsum.photos/seed/${Date.now()}/200`,
          is_primary: images().length === 0,
          blob_type: "thumbnail",
        },
      ]);
      setUploading(false);
    };

    return (
      <div class="p-8 max-w-2xl">
        <EntityImages
          images={images()}
          onUpload={handleUpload}
          uploading={uploading()}
        />
      </div>
    );
  },
};

export const WithImages: Story = {
  render: () => {
    const [images, setImages] = createSignal<ImageMetadata[]>([...mockImages]);
    const [uploading, setUploading] = createSignal(false);

    const handleUpload = async (file: File) => {
      console.log("uploading:", file.name);
      setUploading(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setImages([
        ...images(),
        {
          local_blob_id: null,
          remote_url: `https://picsum.photos/seed/${Date.now()}/200`,
          is_primary: false,
          blob_type: "thumbnail" as const,
        },
      ]);
      setUploading(false);
    };

    const handleDelete = async (index: number) => {
      console.log("deleting image at index:", index);
      const newImages = [...images()];
      newImages.splice(index, 1);
      setImages(newImages);
    };

    const handleSetPrimary = async (index: number) => {
      console.log("setting primary at index:", index);
      const newImages = images().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setImages(newImages);
    };

    return (
      <div class="p-8 max-w-2xl">
        <EntityImages
          images={images()}
          onUpload={handleUpload}
          onDelete={handleDelete}
          onSetPrimary={handleSetPrimary}
          uploading={uploading()}
        />
      </div>
    );
  },
};

export const Compact: Story = {
  render: () => {
    const [images, setImages] = createSignal<ImageMetadata[]>([...mockImages]);
    const [uploading, setUploading] = createSignal(false);

    const handleUpload = async (file: File) => {
      console.log("uploading:", file.name);
      setUploading(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setImages([
        ...images(),
        {
          local_blob_id: null,
          remote_url: `https://picsum.photos/seed/${Date.now()}/200`,
          is_primary: false,
          blob_type: "thumbnail",
        },
      ]);
      setUploading(false);
    };

    const handleDelete = async (index: number) => {
      console.log("deleting image at index:", index);
      const newImages = [...images()];
      newImages.splice(index, 1);
      setImages(newImages);
    };

    const handleSetPrimary = async (index: number) => {
      console.log("setting primary at index:", index);
      const newImages = images().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setImages(newImages);
    };

    return (
      <div class="p-8 max-w-2xl">
        <EntityImages
          images={images()}
          onUpload={handleUpload}
          onDelete={handleDelete}
          onSetPrimary={handleSetPrimary}
          uploading={uploading()}
          compact={true}
        />
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => {
    return (
      <div class="p-8 max-w-2xl">
        <EntityImages images={mockImages} disabled={true} />
      </div>
    );
  },
};

export const Uploading: Story = {
  render: () => {
    const [progress, setProgress] = createSignal(0);

    // simulate upload progress
    setInterval(() => {
      setProgress((p) => (p >= 100 ? 0 : p + 10));
    }, 200);

    return (
      <div class="p-8 max-w-2xl">
        <EntityImages
          images={mockImages}
          onUpload={async () => {}}
          uploading={true}
          uploadProgress={progress()}
        />
      </div>
    );
  },
};
