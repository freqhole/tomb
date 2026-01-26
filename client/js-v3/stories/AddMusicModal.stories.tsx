import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AddMusicModal } from "../src/components/modals/AddMusicModal";

const meta = {
  title: "Components/Overlays/AddMusicModal",
  component: AddMusicModal,
  tags: ["autodocs"],
} satisfies Meta<typeof AddMusicModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    const handleFilesSelected = (files: FileList) => {
      console.log("files selected:", Array.from(files).map((f) => f.name));
      setIsOpen(false);
    };

    const handleUrlsSubmitted = (urls: string[]) => {
      console.log("urls submitted:", urls);
      setIsOpen(false);
    };

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)] p-8">
        <button
          class="px-4 py-2 bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] rounded"
          onClick={() => setIsOpen(true)}
        >
          open add music modal
        </button>

        <AddMusicModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onFilesSelected={handleFilesSelected}
          onUrlsSubmitted={handleUrlsSubmitted}
        />
      </div>
    );
  },
};

export const FilesTab: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)]">
        <AddMusicModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onFilesSelected={(files) =>
            console.log("files:", Array.from(files).map((f) => f.name))
          }
        />
      </div>
    );
  },
};

export const UrlsTab: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(true);

    return (
      <div class="min-h-screen bg-[var(--color-bg-primary)]">
        <AddMusicModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onUrlsSubmitted={(urls) => console.log("urls:", urls)}
        />
      </div>
    );
  },
};
