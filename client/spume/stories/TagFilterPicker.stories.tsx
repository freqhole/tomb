import { createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Badge } from "../src/components/badges/Badge";
import {
  TagFilterPicker,
  type TagFilter,
  type TagOption,
} from "../src/components/forms/TagFilterPicker";
import { mockTags } from "./mockData";

const meta = {
  title: "Components/Forms/TagFilterPicker",
  component: TagFilterPicker,
  tags: ["autodocs"],
} satisfies Meta<typeof TagFilterPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * interactive tag filter picker with include/exclude functionality
 *
 * - click tag to add it (defaults to include/green)
 * - click badge to toggle between include/exclude
 * - click × to remove tag
 */
export const Interactive: Story = {
  render: () => {
    const [selectedFilters, setSelectedFilters] = createSignal<TagFilter[]>([]);

    const handleAddTag = (tag: string) => {
      setSelectedFilters([...selectedFilters(), { tag, mode: "include" }]);
      console.log(`added tag: ${tag} (include)`);
    };

    const handleRemoveTag = (tag: string) => {
      setSelectedFilters(selectedFilters().filter((f) => f.tag !== tag));
      console.log(`removed tag: ${tag}`);
    };

    const handleToggleMode = (tag: string) => {
      setSelectedFilters(
        selectedFilters().map((f) =>
          f.tag === tag
            ? {
                tag: f.tag,
                mode: (f.mode === "include" ? "exclude" : "include") as
                  | "include"
                  | "exclude",
              }
            : f,
        ),
      );
      const filter = selectedFilters().find((f) => f.tag === tag);
      if (filter) {
        const newMode = filter.mode === "include" ? "exclude" : "include";
        console.log(`toggled ${tag}: ${filter.mode} → ${newMode}`);
      }
    };

    const handleClearAll = () => {
      setSelectedFilters([]);
      console.log("cleared all tags");
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "20px",
          "min-height": "400px",
        }}
      >
        <div style={{ "margin-bottom": "20px" }}>
          <h2
            style={{
              color: "var(--color-text-primary)",
              "font-size": "18px",
              "margin-bottom": "8px",
            }}
          >
            filter by tags
          </h2>
          <p
            style={{
              color: "var(--color-text-secondary)",
              "font-size": "14px",
              "margin-bottom": "16px",
            }}
          >
            click tag to add (green/include), then click badge to toggle to
            exclude (red)
          </p>

          <TagFilterPicker
            availableTags={mockTags}
            selectedFilters={selectedFilters()}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onToggleMode={handleToggleMode}
            onClearAll={handleClearAll}
          />
        </div>

        <div
          style={{
            "margin-top": "24px",
            padding: "16px",
            "background-color": "var(--color-bg-secondary)",
            "border-radius": "8px",
          }}
        >
          <h3
            style={{
              color: "var(--color-text-primary)",
              "font-size": "14px",
              "margin-bottom": "12px",
              "font-weight": "600",
            }}
          >
            current filters:
          </h3>
          {selectedFilters().length === 0 ? (
            <p
              style={{
                color: "var(--color-text-tertiary)",
                "font-size": "14px",
              }}
            >
              no filters selected
            </p>
          ) : (
            <div style={{ "font-size": "14px" }}>
              {selectedFilters().map((filter) => (
                <div
                  style={{
                    color: "var(--color-text-secondary)",
                    "margin-bottom": "4px",
                  }}
                >
                  <span
                    style={{
                      color:
                        filter.mode === "include"
                          ? "var(--color-success-400)"
                          : "var(--color-error-400)",
                      "font-weight": "600",
                    }}
                  >
                    {filter.mode === "include" ? "include" : "exclude"}
                  </span>
                  : {filter.tag}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  },
};

/**
 * pre-selected tags with both include and exclude modes
 */
export const WithSelectedTags: Story = {
  render: () => {
    const [selectedFilters, setSelectedFilters] = createSignal<TagFilter[]>([
      { tag: "rock", mode: "include" },
      { tag: "metal", mode: "include" },
      { tag: "pop", mode: "exclude" },
    ]);

    const handleAddTag = (tag: string) => {
      setSelectedFilters([...selectedFilters(), { tag, mode: "include" }]);
    };

    const handleRemoveTag = (tag: string) => {
      setSelectedFilters(selectedFilters().filter((f) => f.tag !== tag));
    };

    const handleToggleMode = (tag: string) => {
      setSelectedFilters(
        selectedFilters().map((f) =>
          f.tag === tag
            ? {
                tag: f.tag,
                mode: (f.mode === "include" ? "exclude" : "include") as
                  | "include"
                  | "exclude",
              }
            : f,
        ),
      );
    };

    const handleClearAll = () => {
      setSelectedFilters([]);
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "20px",
        }}
      >
        <TagFilterPicker
          availableTags={mockTags}
          selectedFilters={selectedFilters()}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onToggleMode={handleToggleMode}
          onClearAll={handleClearAll}
        />
      </div>
    );
  },
};

/**
 * compact mode (smaller text and buttons)
 */
export const CompactMode: Story = {
  render: () => {
    const [selectedFilters, setSelectedFilters] = createSignal<TagFilter[]>([
      { tag: "jazz", mode: "include" },
      { tag: "classical", mode: "include" },
    ]);

    const handleAddTag = (tag: string) => {
      setSelectedFilters([...selectedFilters(), { tag, mode: "include" }]);
    };

    const handleRemoveTag = (tag: string) => {
      setSelectedFilters(selectedFilters().filter((f) => f.tag !== tag));
    };

    const handleToggleMode = (tag: string) => {
      setSelectedFilters(
        selectedFilters().map((f) =>
          f.tag === tag
            ? {
                tag: f.tag,
                mode: (f.mode === "include" ? "exclude" : "include") as
                  | "include"
                  | "exclude",
              }
            : f,
        ),
      );
    };

    const handleClearAll = () => {
      setSelectedFilters([]);
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "20px",
        }}
      >
        <TagFilterPicker
          availableTags={mockTags}
          selectedFilters={selectedFilters()}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onToggleMode={handleToggleMode}
          onClearAll={handleClearAll}
          compact={true}
        />
      </div>
    );
  },
};

/**
 * loading state
 */
export const Loading: Story = {
  render: () => {
    const [selectedFilters, setSelectedFilters] = createSignal<TagFilter[]>([]);

    const handleAddTag = (tag: string) => {
      setSelectedFilters([...selectedFilters(), { tag, mode: "include" }]);
    };

    const handleRemoveTag = (tag: string) => {
      setSelectedFilters(selectedFilters().filter((f) => f.tag !== tag));
    };

    const handleToggleMode = (tag: string) => {
      setSelectedFilters(
        selectedFilters().map((f) =>
          f.tag === tag
            ? {
                tag: f.tag,
                mode: (f.mode === "include" ? "exclude" : "include") as
                  | "include"
                  | "exclude",
              }
            : f,
        ),
      );
    };

    const handleClearAll = () => {
      setSelectedFilters([]);
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "20px",
        }}
      >
        <TagFilterPicker
          availableTags={[]}
          selectedFilters={selectedFilters()}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onToggleMode={handleToggleMode}
          onClearAll={handleClearAll}
          loading={true}
        />
      </div>
    );
  },
};

/**
 * no tags available
 */
export const NoTags: Story = {
  render: () => {
    const [selectedFilters, setSelectedFilters] = createSignal<TagFilter[]>([]);

    const handleAddTag = (tag: string) => {
      setSelectedFilters([...selectedFilters(), { tag, mode: "include" }]);
    };

    const handleRemoveTag = (tag: string) => {
      setSelectedFilters(selectedFilters().filter((f) => f.tag !== tag));
    };

    const handleToggleMode = (tag: string) => {
      setSelectedFilters(
        selectedFilters().map((f) =>
          f.tag === tag
            ? {
                tag: f.tag,
                mode: (f.mode === "include" ? "exclude" : "include") as
                  | "include"
                  | "exclude",
              }
            : f,
        ),
      );
    };

    const handleClearAll = () => {
      setSelectedFilters([]);
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "20px",
        }}
      >
        <TagFilterPicker
          availableTags={[]}
          selectedFilters={selectedFilters()}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onToggleMode={handleToggleMode}
          onClearAll={handleClearAll}
        />
      </div>
    );
  },
};

/**
 * in music list context (demonstrates usage with heading section)
 */
export const InMusicListContext: Story = {
  render: () => {
    const [selectedFilters, setSelectedFilters] = createSignal<TagFilter[]>([
      { tag: "rock", mode: "include" },
      { tag: "pop", mode: "exclude" },
    ]);

    const handleAddTag = (tag: string) => {
      setSelectedFilters([...selectedFilters(), { tag, mode: "include" }]);
    };

    const handleRemoveTag = (tag: string) => {
      setSelectedFilters(selectedFilters().filter((f) => f.tag !== tag));
    };

    const handleToggleMode = (tag: string) => {
      setSelectedFilters(
        selectedFilters().map((f) =>
          f.tag === tag
            ? {
                tag: f.tag,
                mode: (f.mode === "include" ? "exclude" : "include") as
                  | "include"
                  | "exclude",
              }
            : f,
        ),
      );
    };

    const handleClearAll = () => {
      setSelectedFilters([]);
    };

    // calculate filtered count based on mock data
    const getFilteredCount = () => {
      let count = 342; // base rock count
      const excludePop = selectedFilters().find((f) => f.tag === "pop");
      if (excludePop?.mode === "exclude") {
        count -= 50; // simulate removing pop songs
      }
      return count;
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          "min-height": "400px",
        }}
      >
        <div
          style={{
            padding: "20px",
            "border-bottom": "1px solid var(--color-border-default)",
          }}
        >
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              "margin-bottom": "16px",
            }}
          >
            <div>
              <h1
                style={{
                  "font-size": "24px",
                  "font-weight": "600",
                  color: "var(--color-text-primary)",
                  "margin-bottom": "8px",
                }}
              >
                songs
              </h1>
              <p
                style={{
                  "font-size": "14px",
                  color: "var(--color-text-secondary)",
                }}
              >
                {getFilteredCount()} songs
              </p>
            </div>
          </div>

          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <TagFilterPicker
              availableTags={mockTags}
              selectedFilters={selectedFilters()}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              onToggleMode={handleToggleMode}
              onClearAll={handleClearAll}
              compact={true}
            />
          </div>
        </div>

        <div style={{ padding: "20px" }}>
          <div
            style={{
              color: "var(--color-text-tertiary)",
              "font-size": "14px",
              "text-align": "center",
              padding: "40px",
            }}
          >
            song list would appear here...
          </div>
        </div>
      </div>
    );
  },
};
