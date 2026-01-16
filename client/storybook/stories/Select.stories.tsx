import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Select } from "../src/components/forms/Select";

const meta = {
  title: "Components/Forms/Select",
  component: Select,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "filled"],
      description: "visual style variant",
    },
    disabled: {
      control: "boolean",
      description: "whether the select is disabled",
    },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const musicGenres = [
  { value: "rock", label: "rock" },
  { value: "jazz", label: "jazz" },
  { value: "electronic", label: "electronic" },
  { value: "classical", label: "classical" },
  { value: "hip-hop", label: "hip-hop" },
  { value: "metal", label: "metal" },
  { value: "folk", label: "folk" },
  { value: "indie", label: "indie" },
];

const sortOptions = [
  { value: "title", label: "title" },
  { value: "artist", label: "artist" },
  { value: "album", label: "album" },
  { value: "year", label: "year" },
  { value: "date-added", label: "date added" },
  { value: "play-count", label: "play count" },
];

// basic select
export const Basic: Story = {
  args: {
    label: "favorite genre",
    options: musicGenres,
    placeholder: "choose a genre",
  },
};

// with default value
export const WithDefaultValue: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md">
        <Select
          label="sort by"
          options={sortOptions}
          value="title"
          onChange={(e) => console.log("selected:", e.currentTarget.value)}
        />
      </div>
    </div>
  ),
};

// filled variant
export const FilledVariant: Story = {
  args: {
    label: "genre filter",
    variant: "filled",
    options: musicGenres,
    placeholder: "select genre",
  },
};

// disabled state
export const Disabled: Story = {
  args: {
    label: "disabled select",
    options: musicGenres,
    disabled: true,
    value: "rock",
  },
};

// with error
export const WithError: Story = {
  args: {
    label: "required field",
    options: musicGenres,
    placeholder: "select a genre",
    error: "please select a genre",
  },
};

// with hint text
export const WithHint: Story = {
  args: {
    label: "primary genre",
    options: musicGenres,
    placeholder: "choose a genre",
    hint: "select the genre that best describes your music library",
  },
};

// with disabled options
export const WithDisabledOptions: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md">
        <Select
          label="available genres"
          options={[
            { value: "rock", label: "rock" },
            { value: "jazz", label: "jazz (unavailable)", disabled: true },
            { value: "electronic", label: "electronic" },
            {
              value: "classical",
              label: "classical (unavailable)",
              disabled: true,
            },
            { value: "hip-hop", label: "hip-hop" },
          ]}
          placeholder="choose a genre"
          hint="some genres are not available in your region"
        />
      </div>
    </div>
  ),
};

// interactive example with state
export const Interactive: Story = {
  render: () => {
    const [selectedGenre, setSelectedGenre] = createSignal("");
    const [sortBy, setSortBy] = createSignal("title");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md space-y-6">
          <div>
            <Select
              label="filter by genre"
              options={[
                { value: "", label: "all genres" },
                ...musicGenres,
              ]}
              value={selectedGenre()}
              onChange={(e) => setSelectedGenre(e.currentTarget.value)}
            />
          </div>

          <div>
            <Select
              label="sort by"
              options={sortOptions}
              value={sortBy()}
              onChange={(e) => setSortBy(e.currentTarget.value)}
            />
          </div>

          <div class="bg-[var(--color-bg-elevated)] rounded-lg p-4">
            <div class="body-small space-y-2">
              <p class="text-[var(--color-text-primary)]">
                <strong>current selection:</strong>
              </p>
              <p class="text-[var(--color-text-secondary)]">
                genre:{" "}
                <span class="text-[var(--color-accent-500)]">
                  {selectedGenre() || "all"}
                </span>
              </p>
              <p class="text-[var(--color-text-secondary)]">
                sort:{" "}
                <span class="text-[var(--color-accent-500)]">{sortBy()}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  },
};

// form validation example
export const FormValidation: Story = {
  render: () => {
    const [genre, setGenre] = createSignal("");
    const [submitted, setSubmitted] = createSignal(false);

    const error = () => {
      if (submitted() && !genre()) {
        return "please select a genre";
      }
      return undefined;
    };

    const handleSubmit = (e: Event) => {
      e.preventDefault();
      setSubmitted(true);

      if (genre()) {
        alert(`submitted: ${genre()}`);
        setGenre("");
        setSubmitted(false);
      }
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md">
          <form onSubmit={handleSubmit} class="space-y-4">
            <Select
              label="favorite genre"
              options={musicGenres}
              placeholder="select a genre"
              value={genre()}
              onChange={(e) => {
                setGenre(e.currentTarget.value);
                setSubmitted(false);
              }}
              error={error()}
              hint="this field is required"
            />

            <button
              type="submit"
              class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded text-sm font-medium transition-colors"
            >
              submit
            </button>
          </form>
        </div>
      </div>
    );
  },
};

// all variants showcase
export const AllVariants: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl space-y-6">
        <div>
          <h3 class="heading-6 text-[var(--color-text-primary)] mb-4">
            variants
          </h3>
          <div class="space-y-4">
            <Select
              label="default variant"
              options={musicGenres}
              placeholder="select a genre"
            />
            <Select
              label="filled variant"
              variant="filled"
              options={musicGenres}
              placeholder="select a genre"
            />
          </div>
        </div>

        <div>
          <h3 class="heading-6 text-[var(--color-text-primary)] mb-4">
            states
          </h3>
          <div class="space-y-4">
            <Select
              label="normal state"
              options={musicGenres}
              placeholder="select a genre"
            />
            <Select
              label="with hint"
              options={musicGenres}
              placeholder="select a genre"
              hint="helpful hint text appears here"
            />
            <Select
              label="with error"
              options={musicGenres}
              placeholder="select a genre"
              error="this field is required"
            />
            <Select
              label="disabled"
              options={musicGenres}
              value="rock"
              disabled
            />
          </div>
        </div>
      </div>
    </div>
  ),
};
