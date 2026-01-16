import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Design System/Colors",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// background colors
export const Backgrounds: Story = {
  render: () => (
    <div class="p-8 space-y-4">
      <div class="space-y-3">
        <div>
          <div class="caption mb-2">bg-primary - main background</div>
          <div
            class="h-20 rounded border border-[var(--color-border-default)]"
            style={{ "background-color": "var(--color-bg-primary)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#0d0d0d</div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">bg-secondary - cards, panels</div>
          <div
            class="h-20 rounded border border-[var(--color-border-default)]"
            style={{ "background-color": "var(--color-bg-secondary)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#1a1a1a</div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">bg-tertiary - elevated surfaces</div>
          <div
            class="h-20 rounded border border-[var(--color-border-default)]"
            style={{ "background-color": "var(--color-bg-tertiary)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#202124</div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">bg-elevated - modals, dropdowns</div>
          <div
            class="h-20 rounded border border-[var(--color-border-default)]"
            style={{ "background-color": "var(--color-bg-elevated)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#2a2a2a</div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">bg-hover - hover states</div>
          <div
            class="h-20 rounded border border-[var(--color-border-default)]"
            style={{ "background-color": "var(--color-bg-hover)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#3c4043</div>
          </div>
        </div>
      </div>
    </div>
  ),
};

// border colors
export const Borders: Story = {
  render: () => (
    <div class="p-8 space-y-4 bg-[var(--color-bg-primary)]">
      <div class="space-y-3">
        <div>
          <div class="caption mb-2">border-subtle - very subtle dividers</div>
          <div
            class="h-20 rounded bg-[var(--color-bg-secondary)]"
            style={{ border: "2px solid var(--color-border-subtle)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#2a2a2a</div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">border-default - standard borders</div>
          <div
            class="h-20 rounded bg-[var(--color-bg-secondary)]"
            style={{ border: "2px solid var(--color-border-default)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#3c4043</div>
          </div>
        </div>

        <div>
          <div class="caption mb-2">border-strong - emphasized borders</div>
          <div
            class="h-20 rounded bg-[var(--color-bg-secondary)]"
            style={{ border: "2px solid var(--color-border-strong)" }}
          >
            <div class="p-4 text-[var(--color-text-primary)]">#5f6368</div>
          </div>
        </div>
      </div>
    </div>
  ),
};

// text colors
export const TextColors: Story = {
  render: () => (
    <div class="p-8 space-y-4 bg-[var(--color-bg-primary)]">
      <div class="space-y-3">
        <div
          class="p-4 rounded"
          style={{ "background-color": "var(--color-bg-secondary)" }}
        >
          <div class="body-small text-[var(--color-text-primary)]">
            text-primary (#ffffff) - main content, headings
          </div>
        </div>

        <div
          class="p-4 rounded"
          style={{ "background-color": "var(--color-bg-secondary)" }}
        >
          <div class="body-small text-[var(--color-text-secondary)]">
            text-secondary (#e8eaed) - body text, descriptions
          </div>
        </div>

        <div
          class="p-4 rounded"
          style={{ "background-color": "var(--color-bg-secondary)" }}
        >
          <div class="body-small text-[var(--color-text-tertiary)]">
            text-tertiary (#9aa0a6) - supporting text, metadata
          </div>
        </div>

        <div
          class="p-4 rounded"
          style={{ "background-color": "var(--color-bg-secondary)" }}
        >
          <div class="body-small text-[var(--color-text-muted)]">
            text-muted (#80868b) - de-emphasized text
          </div>
        </div>

        <div
          class="p-4 rounded"
          style={{ "background-color": "var(--color-bg-secondary)" }}
        >
          <div class="body-small text-[var(--color-text-disabled)]">
            text-disabled (#5f6368) - disabled state
          </div>
        </div>
      </div>
    </div>
  ),
};

// accent colors (magenta)
export const AccentColors: Story = {
  render: () => (
    <div class="p-8 space-y-4 bg-[var(--color-bg-primary)]">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="caption mb-2">accent-50</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-50)" }}
          >
            <span class="text-black">#fdf4ff</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-100</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-100)" }}
          >
            <span class="text-black">#fae8ff</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-200</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-200)" }}
          >
            <span class="text-black">#f5d0fe</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-300</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-300)" }}
          >
            <span class="text-black">#f0abfc</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-400</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-400)" }}
          >
            <span class="text-black">#e879f9</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-500 (primary)</div>
          <div
            class="h-16 rounded flex items-center justify-center border-2 border-white"
            style={{ "background-color": "var(--color-accent-500)" }}
          >
            <span class="text-white font-bold">#d946ef</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-600</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-600)" }}
          >
            <span class="text-white">#c026d3</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-700</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-700)" }}
          >
            <span class="text-white">#a21caf</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-800</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-800)" }}
          >
            <span class="text-white">#86198f</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">accent-900</div>
          <div
            class="h-16 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-accent-900)" }}
          >
            <span class="text-white">#701a75</span>
          </div>
        </div>
      </div>
    </div>
  ),
};

// semantic colors
export const SemanticColors: Story = {
  render: () => (
    <div class="p-8 space-y-4 bg-[var(--color-bg-primary)]">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="caption mb-2">success</div>
          <div
            class="h-20 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-success)" }}
          >
            <span class="text-black font-medium">#34d399</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">warning</div>
          <div
            class="h-20 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-warning)" }}
          >
            <span class="text-black font-medium">#fbbf24</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">error</div>
          <div
            class="h-20 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-error)" }}
          >
            <span class="text-white font-medium">#ef4444</span>
          </div>
        </div>

        <div>
          <div class="caption mb-2">info</div>
          <div
            class="h-20 rounded flex items-center justify-center"
            style={{ "background-color": "var(--color-info)" }}
          >
            <span class="text-black font-medium">#60a5fa</span>
          </div>
        </div>
      </div>
    </div>
  ),
};

// usage examples
export const UsageExamples: Story = {
  render: () => (
    <div class="p-8 space-y-8 bg-[var(--color-bg-primary)]">
      {/* buttons */}
      <div class="space-y-3">
        <div class="label text-[var(--color-text-secondary)]">buttons</div>
        <div class="flex gap-3 flex-wrap">
          <button
            class="px-4 py-2 rounded text-white font-medium"
            style={{ "background-color": "var(--color-accent-500)" }}
          >
            primary action
          </button>
          <button
            class="px-4 py-2 rounded text-white font-medium"
            style={{ "background-color": "var(--color-bg-elevated)" }}
          >
            secondary action
          </button>
          <button
            class="px-4 py-2 rounded font-medium"
            style={{
              color: "var(--color-accent-500)",
              border: "1px solid var(--color-accent-500)",
            }}
          >
            ghost action
          </button>
        </div>
      </div>

      {/* cards */}
      <div class="space-y-3">
        <div class="label text-[var(--color-text-secondary)]">cards</div>
        <div class="grid grid-cols-2 gap-4">
          <div
            class="p-4 rounded"
            style={{
              "background-color": "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-default)",
            }}
          >
            <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
              card title
            </h3>
            <p class="body-small text-[var(--color-text-tertiary)]">
              card content with supporting text
            </p>
          </div>

          <div
            class="p-4 rounded"
            style={{
              "background-color": "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-strong)",
            }}
          >
            <h3 class="heading-6 text-[var(--color-text-primary)] mb-2">
              elevated card
            </h3>
            <p class="body-small text-[var(--color-text-tertiary)]">
              used for modals and dropdowns
            </p>
          </div>
        </div>
      </div>

      {/* status indicators */}
      <div class="space-y-3">
        <div class="label text-[var(--color-text-secondary)]">
          status indicators
        </div>
        <div class="flex gap-3 flex-wrap">
          <div
            class="px-3 py-1 rounded-full body-small font-medium text-black"
            style={{ "background-color": "var(--color-success)" }}
          >
            online
          </div>
          <div
            class="px-3 py-1 rounded-full body-small font-medium text-black"
            style={{ "background-color": "var(--color-warning)" }}
          >
            warning
          </div>
          <div
            class="px-3 py-1 rounded-full body-small font-medium text-white"
            style={{ "background-color": "var(--color-error)" }}
          >
            error
          </div>
          <div
            class="px-3 py-1 rounded-full body-small font-medium text-black"
            style={{ "background-color": "var(--color-info)" }}
          >
            info
          </div>
        </div>
      </div>

      {/* links and interactive */}
      <div class="space-y-3">
        <div class="label text-[var(--color-text-secondary)]">
          links & interactive
        </div>
        <div class="space-y-2">
          <div>
            <a
              href="#"
              class="body-base"
              style={{ color: "var(--color-accent-500)" }}
            >
              this is a link
            </a>
          </div>
          <div>
            <span class="body-base text-[var(--color-text-primary)]">
              regular text with{" "}
              <a href="#" style={{ color: "var(--color-accent-500)" }}>
                inline link
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  ),
};

// complete palette overview
export const CompletePalette: Story = {
  render: () => (
    <div class="p-8 space-y-8 bg-[var(--color-bg-primary)]">
      <div>
        <h2 class="heading-4 text-[var(--color-text-primary)] mb-4">
          freqhole dark theme palette
        </h2>
        <p class="body-base text-[var(--color-text-tertiary)] mb-6">
          a comprehensive color system designed for dark mode music applications
        </p>
      </div>

      <div class="space-y-6">
        <div>
          <h3 class="heading-6 text-[var(--color-text-primary)] mb-3">
            backgrounds
          </h3>
          <div class="flex gap-2">
            {[
              "primary",
              "secondary",
              "tertiary",
              "elevated",
              "hover",
            ].map((name) => (
              <div class="flex-1">
                <div
                  class="h-16 rounded mb-1"
                  style={{
                    "background-color": `var(--color-bg-${name})`,
                    border: "1px solid var(--color-border-default)",
                  }}
                />
                <div class="caption text-center">{name}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 class="heading-6 text-[var(--color-text-primary)] mb-3">
            borders
          </h3>
          <div class="flex gap-2">
            {["subtle", "default", "strong"].map((name) => (
              <div class="flex-1">
                <div
                  class="h-16 rounded mb-1 bg-[var(--color-bg-secondary)]"
                  style={{
                    border: `3px solid var(--color-border-${name})`,
                  }}
                />
                <div class="caption text-center">{name}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 class="heading-6 text-[var(--color-text-primary)] mb-3">text</h3>
          <div class="flex gap-2">
            {[
              "primary",
              "secondary",
              "tertiary",
              "muted",
              "disabled",
            ].map((name) => (
              <div class="flex-1">
                <div
                  class="h-16 rounded mb-1 flex items-center justify-center bg-[var(--color-bg-secondary)]"
                  style={{
                    color: `var(--color-text-${name})`,
                  }}
                >
                  <span class="font-bold">Aa</span>
                </div>
                <div class="caption text-center">{name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  ),
};
