import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EntityUrlz, type EntityUrlFormItem } from "../src/components/forms/EntityUrlz";

const meta = {
  title: "Components/Forms/EntityUrlz",
  component: EntityUrlz,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div class="p-8 bg-[var(--color-bg-primary)] min-h-[400px]">
        <div class="max-w-md">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof EntityUrlz>;

export default meta;
type Story = StoryObj<typeof meta>;

// empty state
export const Empty: Story = {
  render: () => {
    const [urls, setUrls] = createSignal<EntityUrlFormItem[]>([]);
    return <EntityUrlz urls={urls()} onChange={setUrls} />;
  },
};

// with existing links
export const WithLinks: Story = {
  render: () => {
    const [urls, setUrls] = createSignal<EntityUrlFormItem[]>([
      { id: "1", name: "wikipedia", url: "https://en.wikipedia.org/wiki/Example" },
      { id: "2", name: "discogs", url: "https://www.discogs.com/artist/123" },
      { id: "3", name: "bandcamp", url: "https://example.bandcamp.com" },
    ]);
    return <EntityUrlz urls={urls()} onChange={setUrls} />;
  },
};

// with various states
export const MixedStates: Story = {
  render: () => {
    const [urls, setUrls] = createSignal<EntityUrlFormItem[]>([
      { id: "1", name: "existing link", url: "https://example.com/existing" },
      { name: "new link", url: "https://example.com/new", isNew: true },
      { id: "2", name: "deleted link", url: "https://example.com/deleted", isDeleted: true },
    ]);
    return (
      <div class="space-y-4">
        <p class="text-sm text-[var(--color-text-secondary)]">
          shows existing, new (highlighted), and deleted (below separator) items
        </p>
        <EntityUrlz urls={urls()} onChange={setUrls} />
      </div>
    );
  },
};

// disabled state
export const Disabled: Story = {
  render: () => {
    const [urls, setUrls] = createSignal<EntityUrlFormItem[]>([
      { id: "1", name: "spotify", url: "https://open.spotify.com/artist/example" },
      { id: "2", name: "apple music", url: "https://music.apple.com/us/artist/example" },
    ]);
    return (
      <div class="space-y-4">
        <p class="text-sm text-[var(--color-text-secondary)]">disabled mode - read only</p>
        <EntityUrlz urls={urls()} onChange={setUrls} disabled />
      </div>
    );
  },
};

// with max limit
export const WithMaxLimit: Story = {
  render: () => {
    const [urls, setUrls] = createSignal<EntityUrlFormItem[]>([
      { id: "1", name: "link 1", url: "https://example.com/1" },
      { id: "2", name: "link 2", url: "https://example.com/2" },
    ]);
    return (
      <div class="space-y-4">
        <p class="text-sm text-[var(--color-text-secondary)]">max 3 links allowed (2 of 3 used)</p>
        <EntityUrlz urls={urls()} onChange={setUrls} maxUrls={3} />
      </div>
    );
  },
};

// interactive demo
export const Interactive: Story = {
  render: () => {
    const [urls, setUrls] = createSignal<EntityUrlFormItem[]>([
      { id: "1", name: "official website", url: "https://example.com" },
    ]);
    return (
      <div class="space-y-6">
        <EntityUrlz urls={urls()} onChange={setUrls} />
        <div class="p-3 bg-[var(--color-bg-elevated)] rounded text-xs font-mono whitespace-pre-wrap">
          {JSON.stringify(urls(), null, 2)}
        </div>
      </div>
    );
  },
};

// in a form context
export const InFormContext: Story = {
  render: () => {
    const [urls, setUrls] = createSignal<EntityUrlFormItem[]>([
      { id: "1", name: "musicbrainz", url: "https://musicbrainz.org/artist/123" },
    ]);
    return (
      <form class="space-y-6" onsubmit={(e) => e.preventDefault()}>
        <div>
          <label class="block text-sm text-[var(--color-text-primary)] mb-1">artist name</label>
          <input
            type="text"
            value="The Beatles"
            class="w-full px-3 py-2 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)]"
            readonly
          />
        </div>
        <EntityUrlz urls={urls()} onChange={setUrls} />
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2 text-sm bg-[var(--color-accent-500)] text-white rounded hover:bg-[var(--color-accent-600)]"
          >
            save
          </button>
        </div>
      </form>
    );
  },
};
