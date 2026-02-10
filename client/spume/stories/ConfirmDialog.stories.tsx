import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";
import { ConfirmDialog } from "../src/components/dialogs/ConfirmDialog";

const meta = {
  title: "Components/Overlays/ConfirmDialog",
  component: ConfirmDialog,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "danger"],
      description: "confirm button variant",
    },
    alertVariant: {
      control: "select",
      options: ["info", "warning", "error", "success"],
      description: "optional alert variant",
    },
    loading: {
      control: "boolean",
      description: "loading state",
    },
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// basic confirmation
export const Basic: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>show confirmation</Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={() => {
            console.log("confirmed!");
            setIsOpen(false);
          }}
          message="are you sure you want to proceed with this action?"
        />
      </div>
    );
  },
};

// delete confirmation (destructive)
export const DeleteConfirmation: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button variant="danger" onClick={() => setIsOpen(true)}>
          delete playlist
        </Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={() => {
            console.log("deleted!");
            setIsOpen(false);
          }}
          title="delete playlist"
          message='are you sure you want to delete "my favorite songs"? this action cannot be undone.'
          confirmText="delete"
          cancelText="keep it"
          variant="danger"
          alertVariant="error"
        />
      </div>
    );
  },
};

// with warning
export const WithWarning: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>clear queue</Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={() => {
            console.log("queue cleared!");
            setIsOpen(false);
          }}
          title="clear queue"
          message="this will remove all songs from your current queue. you can always add them back later."
          confirmText="clear queue"
          variant="danger"
          alertVariant="warning"
        />
      </div>
    );
  },
};

// with info
export const WithInfo: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>export playlist</Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={() => {
            console.log("exporting...");
            setIsOpen(false);
          }}
          title="export playlist"
          message="this will create a downloadable file containing all songs in this playlist."
          confirmText="export"
          alertVariant="info"
        />
      </div>
    );
  },
};

// with loading state
export const WithLoading: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);
    const [loading, setLoading] = createSignal(false);

    const handleConfirm = async () => {
      setLoading(true);
      // simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setLoading(false);
      setIsOpen(false);
      console.log("completed!");
    };

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>upload files</Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={handleConfirm}
          loading={loading()}
          title="upload files"
          message="ready to upload 15 files to your library?"
          confirmText="upload"
          variant="primary"
        />
      </div>
    );
  },
};

// custom text
export const CustomText: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>leave page</Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={() => {
            console.log("leaving...");
            setIsOpen(false);
          }}
          title="unsaved changes"
          message="you have unsaved changes. are you sure you want to leave?"
          confirmText="leave anyway"
          cancelText="stay"
          variant="danger"
          alertVariant="warning"
        />
      </div>
    );
  },
};

// multiple dialogs
export const MultipleActions: Story = {
  render: () => {
    const [deleteOpen, setDeleteOpen] = createSignal(false);
    const [clearOpen, setClearOpen] = createSignal(false);
    const [exportOpen, setExportOpen] = createSignal(false);

    return (
      <div class="space-y-4">
        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          <div class="body-sm text-[var(--color-text-secondary)] mb-4">
            playlist actions
          </div>
          <div class="flex gap-3">
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              delete
            </Button>
            <Button variant="ghost" onClick={() => setClearOpen(true)}>
              clear songs
            </Button>
            <Button onClick={() => setExportOpen(true)}>export</Button>
          </div>
        </div>

        <ConfirmDialog
          isOpen={deleteOpen()}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => {
            console.log("deleted!");
            setDeleteOpen(false);
          }}
          title="delete playlist"
          message="permanently delete this playlist?"
          confirmText="delete"
          variant="danger"
          alertVariant="error"
        />

        <ConfirmDialog
          isOpen={clearOpen()}
          onClose={() => setClearOpen(false)}
          onConfirm={() => {
            console.log("cleared!");
            setClearOpen(false);
          }}
          title="clear playlist"
          message="remove all songs from this playlist?"
          confirmText="clear"
          variant="danger"
          alertVariant="warning"
        />

        <ConfirmDialog
          isOpen={exportOpen()}
          onClose={() => setExportOpen(false)}
          onConfirm={() => {
            console.log("exported!");
            setExportOpen(false);
          }}
          title="export playlist"
          message="export playlist as JSON file?"
          confirmText="export"
          alertVariant="info"
        />
      </div>
    );
  },
};

// with JSX message
export const WithJSXMessage: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button variant="danger" onClick={() => setIsOpen(true)}>
          delete account
        </Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={() => {
            console.log("account deleted!");
            setIsOpen(false);
          }}
          title="delete account"
          message={
            <div class="space-y-2">
              <p class="body-sm text-[var(--color-text-secondary)]">
                this will permanently delete your account and all associated
                data:
              </p>
              <ul class="list-disc list-inside body-sm text-[var(--color-text-tertiary)] space-y-1">
                <li>all playlists and favorites</li>
                <li>listening history</li>
                <li>uploaded music files</li>
              </ul>
              <p class="body-sm text-[var(--color-text-secondary)] font-medium">
                this action cannot be undone.
              </p>
            </div>
          }
          confirmText="delete my account"
          variant="danger"
        />
      </div>
    );
  },
};

// simple yes/no
export const SimpleYesNo: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>shuffle play</Button>
        <ConfirmDialog
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          onConfirm={() => {
            console.log("shuffling!");
            setIsOpen(false);
          }}
          title="shuffle playlist"
          message="play all songs in random order?"
          confirmText="yes"
          cancelText="no"
        />
      </div>
    );
  },
};
