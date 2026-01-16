import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TextArea } from "../src/components/forms/TextArea";
import { TextInput } from "../src/components/forms/TextInput";
import { Icon } from "../src/components/icons/registry";

const meta = {
  title: "Components/Forms/Inputs",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// basic text input
export const BasicTextInput: Story = {
  render: () => {
    const [value, setValue] = createSignal("");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md">
          <TextInput
            label="song title"
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            placeholder="enter song title..."
          />
          <div class="mt-4 caption">current value: {value() || "(empty)"}</div>
        </div>
      </div>
    );
  },
};

// text input variants
export const TextInputVariants: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md space-y-4">
        <TextInput
          label="default variant"
          variant="default"
          placeholder="default with border..."
        />
        <TextInput
          label="filled variant"
          variant="filled"
          placeholder="filled background..."
        />
      </div>
    </div>
  ),
};

// text input with icons
export const TextInputWithIcons: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md space-y-4">
        <TextInput
          label="search"
          placeholder="search songs..."
          leftIcon={
            <Icon name="search" size={18} color="var(--color-text-muted)" />
          }
        />
        <TextInput
          label="email"
          type="email"
          placeholder="your@email.com"
          leftIcon={
            <Icon name="user" size={18} color="var(--color-text-muted)" />
          }
        />
        <TextInput
          label="upload file"
          placeholder="select a file..."
          rightIcon={
            <Icon name="upload" size={18} color="var(--color-text-muted)" />
          }
        />
        <TextInput
          label="email"
          type="email"
          placeholder="your@email.com"
          leftIcon={
            <Icon name="user" size={16} color="var(--color-text-muted)" />
          }
        />
      </div>
    </div>
  ),
};

// text input validation states
export const TextInputValidation: Story = {
  render: () => {
    const [email, setEmail] = createSignal("");
    const [submitted, setSubmitted] = createSignal(false);

    const emailError = () => {
      if (!submitted()) return undefined;
      if (!email()) return "email is required";
      if (!email().includes("@")) return "please enter a valid email";
      return undefined;
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md space-y-4">
          <TextInput
            label="email address"
            type="email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            error={emailError()}
            hint="we'll never share your email with anyone"
            placeholder="your@email.com"
          />

          <button
            type="button"
            onClick={() => setSubmitted(true)}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            validate
          </button>

          {!emailError() && submitted() && (
            <div class="p-3 bg-[var(--color-success)] border border-[var(--color-success)] rounded">
              <span class="body-small text-[var(--color-text-on-success)]">
                email is valid!
              </span>
            </div>
          )}
        </div>
      </div>
    );
  },
};

// text input states
export const TextInputStates: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md space-y-4">
        <TextInput label="normal state" placeholder="type something..." />
        <TextInput
          label="disabled state"
          placeholder="cannot edit..."
          disabled
          value="disabled input"
        />
        <TextInput
          label="with error"
          placeholder="invalid input..."
          error="this field is required"
        />
        <TextInput
          label="with hint"
          placeholder="optional field..."
          hint="this field is optional"
        />
      </div>
    </div>
  ),
};

// basic textarea
export const BasicTextArea: Story = {
  render: () => {
    const [value, setValue] = createSignal("");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md">
          <TextArea
            label="description"
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
            placeholder="enter description..."
            rows={4}
          />
          <div class="mt-4 caption">character count: {value().length}</div>
        </div>
      </div>
    );
  },
};

// textarea variants
export const TextAreaVariants: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md space-y-4">
        <TextArea
          label="default variant"
          variant="default"
          placeholder="default with border..."
          rows={3}
        />
        <TextArea
          label="filled variant"
          variant="filled"
          placeholder="filled background..."
          rows={3}
        />
      </div>
    </div>
  ),
};

// textarea resize options
export const TextAreaResize: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md space-y-4">
        <TextArea
          label="no resize"
          resize="none"
          placeholder="cannot resize..."
          rows={3}
        />
        <TextArea
          label="vertical resize (default)"
          resize="vertical"
          placeholder="resize vertically..."
          rows={3}
        />
        <TextArea
          label="horizontal resize"
          resize="horizontal"
          placeholder="resize horizontally..."
          rows={3}
        />
        <TextArea
          label="both directions"
          resize="both"
          placeholder="resize in any direction..."
          rows={3}
        />
      </div>
    </div>
  ),
};

// textarea validation
export const TextAreaValidation: Story = {
  render: () => {
    const [bio, setBio] = createSignal("");
    const [submitted, setSubmitted] = createSignal(false);

    const bioError = () => {
      if (!submitted()) return undefined;
      if (!bio()) return "bio is required";
      if (bio().length < 10) return "bio must be at least 10 characters";
      return undefined;
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md space-y-4">
          <TextArea
            label="bio"
            value={bio()}
            onInput={(e) => setBio(e.currentTarget.value)}
            error={bioError()}
            hint={`${bio().length} / 500 characters`}
            placeholder="tell us about yourself..."
            rows={4}
            maxLength={500}
          />

          <button
            type="button"
            onClick={() => setSubmitted(true)}
            class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
          >
            validate
          </button>

          {!bioError() && submitted() && (
            <div class="p-3 bg-[var(--color-success)] border border-[var(--color-success)] rounded">
              <span class="body-small text-[var(--color-text-on-success)]">
                bio is valid!
              </span>
            </div>
          )}
        </div>
      </div>
    );
  },
};

// complete form example
export const CompleteForm: Story = {
  render: () => {
    const [formData, setFormData] = createSignal({
      title: "",
      artist: "",
      album: "",
      year: "",
      genre: "",
      notes: "",
    });
    const [errors, setErrors] = createSignal<Record<string, string>>({});

    const validate = () => {
      const newErrors: Record<string, string> = {};
      const data = formData();

      if (!data.title) newErrors.title = "title is required";
      if (!data.artist) newErrors.artist = "artist is required";
      if (data.year && !/^\d{4}$/.test(data.year)) {
        newErrors.year = "year must be 4 digits";
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e: Event) => {
      e.preventDefault();
      if (validate()) {
        console.log("form submitted:", formData());
      }
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <h2 class="heading-4 text-[var(--color-text-primary)] mb-6">
            edit song metadata
          </h2>

          <form onSubmit={handleSubmit} class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <TextInput
                label="title"
                value={formData().title}
                onInput={(e) =>
                  setFormData({ ...formData(), title: e.currentTarget.value })
                }
                error={errors().title}
                placeholder="song title"
              />
              <TextInput
                label="artist"
                value={formData().artist}
                onInput={(e) =>
                  setFormData({ ...formData(), artist: e.currentTarget.value })
                }
                error={errors().artist}
                placeholder="artist name"
              />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <TextInput
                label="album"
                value={formData().album}
                onInput={(e) =>
                  setFormData({ ...formData(), album: e.currentTarget.value })
                }
                placeholder="album name"
              />
              <TextInput
                label="year"
                type="number"
                value={formData().year}
                onInput={(e) =>
                  setFormData({ ...formData(), year: e.currentTarget.value })
                }
                error={errors().year}
                placeholder="2024"
              />
            </div>

            <TextInput
              label="genre"
              value={formData().genre}
              onInput={(e) =>
                setFormData({ ...formData(), genre: e.currentTarget.value })
              }
              placeholder="rock, alternative, indie..."
            />

            <TextArea
              label="notes"
              value={formData().notes}
              onInput={(e) =>
                setFormData({ ...formData(), notes: e.currentTarget.value })
              }
              placeholder="additional notes..."
              hint="optional field for extra information"
              rows={3}
            />

            <div class="flex gap-2 justify-end pt-4">
              <button
                type="button"
                class="px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors"
              >
                cancel
              </button>
              <button
                type="submit"
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                save changes
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  },
};

// input types showcase
export const InputTypes: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md space-y-4">
        <TextInput label="text" type="text" placeholder="text input..." />
        <TextInput label="email" type="email" placeholder="email@example.com" />
        <TextInput label="password" type="password" placeholder="password" />
        <TextInput label="number" type="number" placeholder="123" />
        <TextInput label="url" type="url" placeholder="https://example.com" />
        <TextInput label="date" type="date" />
        <TextInput label="time" type="time" />
      </div>
    </div>
  ),
};

// search input example
export const SearchInput: Story = {
  render: () => {
    const [search, setSearch] = createSignal("");

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md">
          <TextInput
            placeholder="search songs, albums, artists..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            leftIcon={
              <Icon name="search" size={18} color="var(--color-text-muted)" />
            }
            variant="filled"
          />
          {search() && (
            <div class="mt-4 space-y-2">
              <div class="caption">search results for: {search()}</div>
              <div class="p-3 bg-[var(--color-bg-secondary)] rounded">
                <div class="body-small text-[var(--color-text-primary)]">
                  no results found
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
};
