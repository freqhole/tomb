import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Design System/Typography",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// showcase all heading levels
export const Headings: Story = {
  render: () => (
    <div class="p-8 space-y-6 bg-[var(--color-bg-primary)]">
      <div class="space-y-4">
        <div>
          <div class="caption mb-2">heading 1 - 48px / bold / tight</div>
          <h1 class="heading-1 text-[var(--color-text-primary)]">
            the quick brown fox jumps over the lazy dog
          </h1>
        </div>

        <div>
          <div class="caption mb-2">heading 2 - 36px / bold / tight</div>
          <h2 class="heading-2 text-[var(--color-text-primary)]">
            the quick brown fox jumps over the lazy dog
          </h2>
        </div>

        <div>
          <div class="caption mb-2">heading 3 - 30px / semibold / snug</div>
          <h3 class="heading-3 text-[var(--color-text-primary)]">
            the quick brown fox jumps over the lazy dog
          </h3>
        </div>

        <div>
          <div class="caption mb-2">heading 4 - 24px / semibold / snug</div>
          <h4 class="heading-4 text-[var(--color-text-primary)]">
            the quick brown fox jumps over the lazy dog
          </h4>
        </div>

        <div>
          <div class="caption mb-2">heading 5 - 20px / medium / normal</div>
          <h5 class="heading-5 text-[var(--color-text-primary)]">
            the quick brown fox jumps over the lazy dog
          </h5>
        </div>

        <div>
          <div class="caption mb-2">heading 6 - 18px / medium / normal</div>
          <h6 class="heading-6 text-[var(--color-text-primary)]">
            the quick brown fox jumps over the lazy dog
          </h6>
        </div>
      </div>
    </div>
  ),
};

// showcase body text sizes
export const BodyText: Story = {
  render: () => (
    <div class="p-8 space-y-6 bg-[var(--color-bg-primary)]">
      <div>
        <div class="caption mb-2">body large - 18px / relaxed</div>
        <p class="body-large text-[var(--color-text-primary)] max-w-2xl">
          in music, a phrase is a unit of musical meter that has a complete
          musical sense of its own, built from figures, motifs, and cells, and
          combining to form melodies, periods and larger sections.
        </p>
      </div>

      <div>
        <div class="caption mb-2">body base - 16px / normal (default)</div>
        <p class="body-base text-[var(--color-text-primary)] max-w-2xl">
          in music, a phrase is a unit of musical meter that has a complete
          musical sense of its own, built from figures, motifs, and cells, and
          combining to form melodies, periods and larger sections.
        </p>
      </div>

      <div>
        <div class="caption mb-2">body small - 14px / normal</div>
        <p class="body-small text-[var(--color-text-primary)] max-w-2xl">
          in music, a phrase is a unit of musical meter that has a complete
          musical sense of its own, built from figures, motifs, and cells, and
          combining to form melodies, periods and larger sections.
        </p>
      </div>

      <div>
        <div class="caption mb-2">body xs - 12px / normal</div>
        <p class="body-xs text-[var(--color-text-primary)] max-w-2xl">
          in music, a phrase is a unit of musical meter that has a complete
          musical sense of its own, built from figures, motifs, and cells, and
          combining to form melodies, periods and larger sections.
        </p>
      </div>
    </div>
  ),
};

// showcase specialized text styles
export const SpecializedText: Story = {
  render: () => (
    <div class="p-8 space-y-6 bg-[var(--color-bg-primary)]">
      <div>
        <div class="caption mb-2">label - uppercase / medium / wide</div>
        <div class="label text-[var(--color-text-secondary)]">
          track information
        </div>
      </div>

      <div>
        <div class="caption mb-2">caption - 12px / tertiary color</div>
        <div class="caption">
          this is caption text used for supplementary information
        </div>
      </div>

      <div>
        <div class="caption mb-2">monospace - code / data / timestamps</div>
        <div class="monospace text-[var(--color-text-primary)]">
          const formatDuration = (seconds: number) =&gt;
          `$&#123;seconds&#125;s`;
        </div>
      </div>

      <div>
        <div class="caption mb-2">monospace tabular numbers</div>
        <div class="monospace text-[var(--color-text-primary)] space-y-1">
          <div>01:23</div>
          <div>10:45</div>
          <div>100:00</div>
        </div>
      </div>
    </div>
  ),
};

// showcase text color hierarchy
export const TextColors: Story = {
  render: () => (
    <div class="p-8 space-y-4 bg-[var(--color-bg-primary)]">
      <div>
        <div class="caption mb-2">primary - main content</div>
        <p class="body-base text-[var(--color-text-primary)]">
          this is primary text used for main content
        </p>
      </div>

      <div>
        <div class="caption mb-2">secondary - slightly less emphasis</div>
        <p class="body-base text-[var(--color-text-secondary)]">
          this is secondary text with slightly reduced emphasis
        </p>
      </div>

      <div>
        <div class="caption mb-2">tertiary - supporting text</div>
        <p class="body-base text-[var(--color-text-tertiary)]">
          this is tertiary text for supporting information
        </p>
      </div>

      <div>
        <div class="caption mb-2">muted - de-emphasized</div>
        <p class="body-base text-[var(--color-text-muted)]">
          this is muted text for de-emphasized content
        </p>
      </div>

      <div>
        <div class="caption mb-2">disabled - inactive state</div>
        <p class="body-base text-[var(--color-text-disabled)]">
          this is disabled text for inactive elements
        </p>
      </div>

      <div>
        <div class="caption mb-2">accent - interactive elements</div>
        <p class="body-base text-[var(--color-accent-500)]">
          this is accent text for links and interactive elements
        </p>
      </div>
    </div>
  ),
};

// showcase font weights
export const FontWeights: Story = {
  render: () => (
    <div class="p-8 space-y-4 bg-[var(--color-bg-primary)]">
      <div class="text-[var(--color-text-primary)] body-base space-y-2">
        <div style={{ "font-weight": "var(--font-weight-light)" }}>
          light (300) - the quick brown fox jumps over the lazy dog
        </div>
        <div style={{ "font-weight": "var(--font-weight-normal)" }}>
          normal (400) - the quick brown fox jumps over the lazy dog
        </div>
        <div style={{ "font-weight": "var(--font-weight-medium)" }}>
          medium (500) - the quick brown fox jumps over the lazy dog
        </div>
        <div style={{ "font-weight": "var(--font-weight-semibold)" }}>
          semibold (600) - the quick brown fox jumps over the lazy dog
        </div>
        <div style={{ "font-weight": "var(--font-weight-bold)" }}>
          bold (700) - the quick brown fox jumps over the lazy dog
        </div>
      </div>
    </div>
  ),
};

// showcase complete type scale with sizes
export const TypeScale: Story = {
  render: () => (
    <div class="p-8 space-y-3 bg-[var(--color-bg-primary)]">
      <div class="grid grid-cols-[100px_1fr] gap-4 items-baseline">
        <span class="caption text-right">5xl / 48px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-5xl)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">4xl / 36px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-4xl)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">3xl / 30px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-3xl)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">2xl / 24px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-2xl)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">xl / 20px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-xl)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">lg / 18px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-lg)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">base / 16px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-base)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">sm / 14px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-sm)" }}
        >
          freqhole
        </span>

        <span class="caption text-right">xs / 12px</span>
        <span
          class="text-[var(--color-text-primary)]"
          style={{ "font-size": "var(--font-size-xs)" }}
        >
          freqhole
        </span>
      </div>
    </div>
  ),
};

// real-world example
export const RealWorldExample: Story = {
  render: () => (
    <div class="p-8 max-w-3xl bg-[var(--color-bg-primary)]">
      <h2 class="heading-2 text-[var(--color-text-primary)] mb-2">
        dark side of the moon
      </h2>
      <p class="body-small text-[var(--color-text-tertiary)] mb-6">
        pink floyd • 1973 • progressive rock
      </p>

      <div class="space-y-4">
        <div>
          <h3 class="heading-5 text-[var(--color-text-primary)] mb-2">
            about this album
          </h3>
          <p class="body-base text-[var(--color-text-secondary)] leading-relaxed">
            the dark side of the moon is the eighth studio album by the english
            rock band pink floyd, released on 1 march 1973. the album is known
            for its philosophical and introspective lyrics, complex musical
            arrangements, and innovative use of studio effects.
          </p>
        </div>

        <div>
          <div class="label text-[var(--color-text-secondary)] mb-3">
            track listing
          </div>
          <div class="space-y-2">
            <div class="flex justify-between items-center body-small text-[var(--color-text-primary)]">
              <span>1. speak to me</span>
              <span class="monospace text-[var(--color-text-muted)]">1:13</span>
            </div>
            <div class="flex justify-between items-center body-small text-[var(--color-text-primary)]">
              <span>2. breathe (in the air)</span>
              <span class="monospace text-[var(--color-text-muted)]">2:43</span>
            </div>
            <div class="flex justify-between items-center body-small text-[var(--color-text-primary)]">
              <span>3. on the run</span>
              <span class="monospace text-[var(--color-text-muted)]">3:30</span>
            </div>
          </div>
        </div>

        <div class="caption pt-4">total duration: 42:49 • 10 tracks</div>
      </div>
    </div>
  ),
};
