import { For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import * as NavigationIcons from "../src/components/icons/navigation";
import * as PlayerIcons from "../src/components/icons/player";
import {
  Icon,
  IconRegistry,
  type IconName,
} from "../src/components/icons/registry";

const meta = {
  title: "Components/Icons",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// showcase all icons organized by category
export const AllIcons: Story = {
  render: () => {
    const categories = {
      "player controls": [
        "play",
        "pause",
        "previous",
        "next",
        "stop",
      ] as IconName[],
      "volume controls": [
        "volume",
        "volumeOff",
        "volumeLow",
        "volumeHigh",
      ] as IconName[],
      "playback modes": [
        "shuffle",
        "repeat",
        "repeatOne",
        "queue",
      ] as IconName[],
      navigation: [
        "music",
        "album",
        "artist",
        "playlist",
        "library",
        "genre",
        "home",
        "discover",
        "recent",
        "search",
      ] as IconName[],
      "layout & view": ["menu", "grid", "list", "filter", "sort"] as IconName[],
      arrows: [
        "arrowUp",
        "arrowDown",
        "arrowLeft",
        "arrowRight",
        "chevronUp",
        "chevronDown",
        "chevronLeft",
        "chevronRight",
      ] as IconName[],
      actions: [
        "add",
        "edit",
        "delete",
        "close",
        "drag",
        "more",
        "favorite",
        "favoriteOutline",
      ] as IconName[],
      "auth & user": ["logout", "user"] as IconName[],
      system: [
        "settings",
        "info",
        "upload",
        "check",
        "x",
        "alertTriangle",
      ] as IconName[],
      brand: ["freqhole"] as IconName[],
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-8">
          <For each={Object.entries(categories)}>
            {([category, icons]) => (
              <div>
                <div class="label text-[var(--color-text-secondary)] mb-4">
                  {category}
                </div>
                <div class="grid grid-cols-6 gap-6">
                  <For each={icons}>
                    {(iconName) => (
                      <div class="flex flex-col items-center gap-2 p-4 bg-[var(--color-bg-secondary)] rounded hover:bg-[var(--color-bg-hover)] transition-colors">
                        <Icon
                          name={iconName}
                          size={24}
                          color="var(--color-text-primary)"
                        />
                        <div class="caption text-center">{iconName}</div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    );
  },
};

// icon sizes
export const Sizes: Story = {
  render: () => {
    const sizes = [
      { name: "xs", size: 12 },
      { name: "sm", size: 14 },
      { name: "md", size: 16 },
      { name: "lg", size: 20 },
      { name: "xl", size: 24 },
      { name: "2xl", size: 32 },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-6">
          <For each={sizes}>
            {(sizeConfig) => (
              <div class="flex items-center gap-4">
                <div class="caption w-16">{sizeConfig.name}</div>
                <div class="caption w-16 text-[var(--color-text-muted)]">
                  {sizeConfig.size}px
                </div>
                <Icon
                  name="music"
                  size={sizeConfig.size}
                  color="var(--color-text-primary)"
                />
              </div>
            )}
          </For>
        </div>
      </div>
    );
  },
};

// icon colors
export const Colors: Story = {
  render: () => {
    const colors = [
      { name: "primary", color: "var(--color-text-primary)" },
      { name: "secondary", color: "var(--color-text-secondary)" },
      { name: "tertiary", color: "var(--color-text-tertiary)" },
      { name: "muted", color: "var(--color-text-muted)" },
      { name: "accent", color: "var(--color-accent-500)" },
      { name: "success", color: "var(--color-success)" },
      { name: "warning", color: "var(--color-warning)" },
      { name: "error", color: "var(--color-error)" },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-4">
          <For each={colors}>
            {(colorConfig) => (
              <div class="flex items-center gap-4">
                <div class="caption w-24">{colorConfig.name}</div>
                <Icon name="music" size={24} color={colorConfig.color} />
                <div
                  class="caption text-[var(--color-text-muted)] monospace"
                  style={{ color: colorConfig.color }}
                >
                  {colorConfig.color}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    );
  },
};

// player controls showcase
export const PlayerControls: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-6">
        <div>
          <div class="caption mb-4">playback controls</div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon
                name="previous"
                size={24}
                color="var(--color-text-primary)"
              />
            </button>
            <button
              type="button"
              class="p-3 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] transition-colors"
            >
              <Icon
                name="play"
                size={32}
                color="var(--color-text-on-accent)"
              />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon name="next" size={24} color="var(--color-text-primary)" />
            </button>
          </div>
        </div>

        <div>
          <div class="caption mb-4">playback modes</div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon
                name="shuffle"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon
                name="repeat"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon
                name="queue"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
          </div>
        </div>

        <div>
          <div class="caption mb-4">volume controls</div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon
                name="volumeOff"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon
                name="volumeLow"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon name="volume" size={20} color="var(--color-text-primary)" />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
            >
              <Icon
                name="volumeHigh"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  ),
};

// navigation icons in context
export const NavigationBar: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="bg-[var(--color-bg-secondary)] rounded-lg p-4">
        <nav class="space-y-2">
          <a
            href="#"
            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Icon name="home" size={20} color="var(--color-accent-500)" />
            <span class="body-small text-[var(--color-text-primary)]">
              home
            </span>
          </a>
          <a
            href="#"
            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Icon name="search" size={20} color="var(--color-text-secondary)" />
            <span class="body-small text-[var(--color-text-secondary)]">
              search
            </span>
          </a>
          <a
            href="#"
            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Icon
              name="library"
              size={20}
              color="var(--color-text-secondary)"
            />
            <span class="body-small text-[var(--color-text-secondary)]">
              library
            </span>
          </a>
          <a
            href="#"
            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Icon name="album" size={20} color="var(--color-text-secondary)" />
            <span class="body-small text-[var(--color-text-secondary)]">
              albums
            </span>
          </a>
          <a
            href="#"
            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Icon name="artist" size={20} color="var(--color-text-secondary)" />
            <span class="body-small text-[var(--color-text-secondary)]">
              artists
            </span>
          </a>
          <a
            href="#"
            class="flex items-center gap-3 p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <Icon
              name="playlist"
              size={20}
              color="var(--color-text-secondary)"
            />
            <span class="body-small text-[var(--color-text-secondary)]">
              playlists
            </span>
          </a>
        </nav>
      </div>
    </div>
  ),
};

// action icons in buttons
export const ActionButtons: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-6">
        <div>
          <div class="caption mb-4">primary actions</div>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] rounded transition-colors"
            >
              <Icon
                name="add"
                size={16}
                color="var(--color-text-on-accent)"
              />
              <span class="body-small text-[var(--color-text-on-accent)]">
                add song
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
            >
              <Icon name="edit" size={16} color="var(--color-text-primary)" />
              <span class="body-small text-[var(--color-text-primary)]">
                edit
              </span>
            </button>
            <button
              type="button"
              class="flex items-center gap-2 px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
            >
              <Icon name="delete" size={16} color="var(--color-error)" />
              <span class="body-small text-[var(--color-error)]">delete</span>
            </button>
          </div>
        </div>

        <div>
          <div class="caption mb-4">icon-only buttons</div>
          <div class="flex gap-2">
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title="more options"
            >
              <Icon name="more" size={20} color="var(--color-text-secondary)" />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title="filter"
            >
              <Icon
                name="filter"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title="sort"
            >
              <Icon name="sort" size={20} color="var(--color-text-secondary)" />
            </button>
            <button
              type="button"
              class="p-2 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title="close"
            >
              <Icon
                name="close"
                size={20}
                color="var(--color-text-secondary)"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  ),
};

// freqhole brand icon
export const BrandIcon: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="space-y-8">
        <div>
          <div class="caption mb-4">default accent color</div>
          <Icon name="freqhole" size={64} color="var(--color-accent-500)" />
        </div>

        <div>
          <div class="caption mb-4">different sizes</div>
          <div class="flex items-end gap-4">
            <Icon name="freqhole" size={16} color="var(--color-accent-500)" />
            <Icon name="freqhole" size={24} color="var(--color-accent-500)" />
            <Icon name="freqhole" size={32} color="var(--color-accent-500)" />
            <Icon name="freqhole" size={48} color="var(--color-accent-500)" />
            <Icon name="freqhole" size={64} color="var(--color-accent-500)" />
          </div>
        </div>

        <div>
          <div class="caption mb-4">with text</div>
          <div class="flex items-center gap-3">
            <Icon name="freqhole" size={32} color="var(--color-accent-500)" />
            <span class="heading-4 text-[var(--color-text-primary)]">
              freqhole
            </span>
          </div>
        </div>
      </div>
    </div>
  ),
};
