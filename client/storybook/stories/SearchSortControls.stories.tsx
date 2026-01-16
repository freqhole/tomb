import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SearchSortControls } from "../src/components/controls/SearchSortControls";

const meta = {
  title: "Components/SearchSortControls",
  component: SearchSortControls,
  tags: ["autodocs"],
  argTypes: {
    sortBy: {
      control: "select",
      options: ["title", "artist", "album", "date"],
      description: "current sort field",
    },
    sortDirection: {
      control: "select",
      options: ["asc", "desc"],
      description: "current sort direction",
    },
    directionStyle: {
      control: "select",
      options: ["arrows", "text"],
      description: "how to display the direction toggle",
    },
    disabled: {
      control: "boolean",
      description: "whether the controls are disabled",
    },
  },
} satisfies Meta<typeof SearchSortControls>;

export default meta;
type Story = StoryObj<typeof meta>;

// sample sort fields for music
const musicSortFields = [
  { value: "title", label: "Title", description: "sort by song title" },
  { value: "artist", label: "Artist", description: "sort by artist name" },
  { value: "album", label: "Album", description: "sort by album name" },
  { value: "date", label: "Date Added", description: "sort by date added" },
  { value: "duration", label: "Duration", description: "sort by song length" },
];

// basic example with arrows
export const Default: Story = {
  args: {
    sortFields: musicSortFields,
    sortBy: "title",
    sortDirection: "desc",
    directionStyle: "arrows",
  },
};

// with text labels instead of arrows
export const TextDirection: Story = {
  args: {
    sortFields: musicSortFields,
    sortBy: "artist",
    sortDirection: "asc",
    directionStyle: "text",
  },
};

// disabled state
export const Disabled: Story = {
  args: {
    sortFields: musicSortFields,
    sortBy: "album",
    sortDirection: "desc",
    disabled: true,
  },
};

// interactive example with state
export const Interactive: Story = {
  render: () => {
    const [sortBy, setSortBy] = createSignal("title");
    const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("desc");

    return (
      <div class="p-4">
        <div class="mb-4 text-gray-300 text-sm">
          <p>current sort: <span class="text-magenta-400">{sortBy()}</span></p>
          <p>direction: <span class="text-magenta-400">{sortDirection()}</span></p>
        </div>
        <SearchSortControls
          sortFields={musicSortFields}
          sortBy={sortBy()}
          sortDirection={sortDirection()}
          onSortByChange={setSortBy}
          onSortDirectionChange={setSortDirection}
        />
      </div>
    );
  },
};

// combined callback example
export const CombinedCallback: Story = {
  render: () => {
    const [sortBy, setSortBy] = createSignal("date");
    const [sortDirection, setSortDirection] = createSignal<"asc" | "desc">("asc");
    const [log, setLog] = createSignal<string[]>([]);

    const handleSortChange = (field: string, direction: "asc" | "desc") => {
      setSortBy(field);
      setSortDirection(direction);
      setLog([...log(), `sort changed: ${field} ${direction}`]);
    };

    return (
      <div class="p-4 space-y-4">
        <SearchSortControls
          sortFields={musicSortFields}
          sortBy={sortBy()}
          sortDirection={sortDirection()}
          onSortChange={handleSortChange}
        />
        <div class="mt-4 p-3 bg-dark-800 rounded text-xs text-gray-400">
          <div class="font-medium mb-2">event log:</div>
          {log().length === 0 ? (
            <div>no events yet</div>
          ) : (
            <ul class="space-y-1">
              {log().map((entry, i) => (
                <li>
                  {i + 1}. {entry}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  },
};

// minimal fields
export const MinimalFields: Story = {
  args: {
    sortFields: [
      { value: "name", label: "Name" },
      { value: "date", label: "Date" },
    ],
    sortBy: "name",
    sortDirection: "asc",
  },
};
