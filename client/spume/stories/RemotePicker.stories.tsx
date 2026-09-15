import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { RemotePicker } from "../src/components/forms/RemotePicker";
import type { Remote } from "../src/app/services/storage/schemas/remote";

const meta = {
  title: "Components/Forms/RemotePicker",
  component: RemotePicker,
  tags: ["autodocs"],
} satisfies Meta<typeof RemotePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

function mockRemote(id: string, name: string, overrides: Partial<Remote> = {}): Remote {
  return {
    remote_id: id,
    name,
    is_active: true,
    last_connected_at: Date.now(),
    created_at: Date.now(),
    updated_at: Date.now(),
    description: null,
    image_url: null,
    image_blob_id: null,
    version: null,
    last_info_check: null,
    transport: "http",
    base_url: `https://${id}.example.com`,
    ...overrides,
  } as Remote;
}

const remotes: Remote[] = [
  mockRemote("local", "localfreq", { is_charnel_managed: true }),
  mockRemote("carps-basement", "carp's basement"),
  mockRemote("vinyl-rips", "vinyl rips"),
];

// -------------------------------------------------------------------------
// story: single-select, inline layout — matches AddMediaModal's header
// usage. real online/offline/checking status comes from remoteHealth.ts's
// live probe, which will attempt (and likely fail, since there's no real
// backend in storybook) a network check for each non-charnel-managed
// remote — a fair, honest demonstration of the "checking..." → "offline"
// treatment.
// -------------------------------------------------------------------------

export const SingleSelectInline: Story = {
  render: () => {
    const [value, setValue] = createSignal(new Set(["local"]));
    return (
      <div class="min-h-[280px] bg-[var(--color-bg-primary)] p-8">
        <RemotePicker
          remotes={remotes}
          value={value()}
          onChange={setValue}
          mode="single"
          layout="inline"
        />
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: multi-select, floating layout — matches AggregateFeedView's usage.
// -------------------------------------------------------------------------

export const MultiSelectFloating: Story = {
  render: () => {
    const [value, setValue] = createSignal(new Set(remotes.map((r) => r.remote_id)));
    return (
      <div class="relative min-h-[280px] bg-[var(--color-bg-primary)] p-8">
        <RemotePicker
          remotes={remotes}
          value={value()}
          onChange={setValue}
          mode="multi"
          layout="floating"
        />
      </div>
    );
  },
};

// -------------------------------------------------------------------------
// story: narrow container forces the chip strip to collapse into the
// overflow trigger + flyout.
// -------------------------------------------------------------------------

export const CollapsedFlyout: Story = {
  render: () => {
    const [value, setValue] = createSignal(new Set(["local"]));
    return (
      <div class="min-h-[280px] bg-[var(--color-bg-primary)] p-8">
        <div class="w-40">
          <RemotePicker
            remotes={remotes}
            value={value()}
            onChange={setValue}
            mode="single"
            layout="inline"
          />
        </div>
      </div>
    );
  },
};
