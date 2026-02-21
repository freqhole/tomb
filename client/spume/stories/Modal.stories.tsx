import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BodyText, Heading } from "../src/design-system/typography";
import { Alert } from "../src/components/feedback/Alert";
import { Modal, useModal } from "../src/components/overlays/Modal";
import { mockSongs } from "./mockData";

const meta = {
  title: "Components/Overlays/Modal",
  component: Modal,
  tags: ["autodocs"],
  argTypes: {
    isOpen: {
      control: "boolean",
      description: "whether the modal is open",
    },
    size: {
      control: "select",
      options: ["sm", "md", "lg", "xl", "full"],
      description: "modal size",
    },
    showCloseButton: {
      control: "boolean",
      description: "show close button in header",
    },
    closeOnBackdrop: {
      control: "boolean",
      description: "close when clicking outside modal",
    },
    closeOnEscape: {
      control: "boolean",
      description: "close when pressing escape key",
    },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

// basic modal example
export const Default: Story = {
  render: () => {
    const modal = useModal();

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal.open}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
        >
          open modal
        </button>

        <Modal isOpen={modal.isOpen()} onClose={modal.close} title="welcome to freqhole">
          <div class="space-y-4">
            <BodyText size="base" class="text-[var(--color-text-secondary)]">
              this is a basic modal dialog using the native HTML dialog element. it supports
              backdrop clicks and escape key to close.
            </BodyText>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                ok
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};

// all sizes
export const Sizes: Story = {
  render: () => {
    const [openModal, setOpenModal] = createSignal<string | null>(null);

    const sizes = [
      { name: "small", value: "sm" as const },
      { name: "medium", value: "md" as const },
      { name: "large", value: "lg" as const },
      { name: "extra large", value: "xl" as const },
      { name: "full", value: "full" as const },
    ];

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="space-y-3">
          {sizes.map((size) => (
            <>
              <button
                type="button"
                onClick={() => setOpenModal(size.value)}
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors mr-2"
              >
                open {size.name} modal
              </button>

              <Modal
                isOpen={openModal() === size.value}
                onClose={() => setOpenModal(null)}
                title={`${size.name} modal`}
                size={size.value}
              >
                <BodyText size="base" class="text-[var(--color-text-secondary)]">
                  this is a {size.name} modal. the content area adjusts based on the size prop.
                </BodyText>
              </Modal>
            </>
          ))}
        </div>
      </div>
    );
  },
};

// modal with form
export const WithForm: Story = {
  render: () => {
    const modal = useModal();
    const [formData, setFormData] = createSignal({
      name: "",
      email: "",
      message: "",
    });

    const handleSubmit = (e: Event) => {
      e.preventDefault();
      console.log("form submitted:", formData());
      modal.close();
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal.open}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
        >
          open form modal
        </button>

        <Modal isOpen={modal.isOpen()} onClose={modal.close} title="contact us" size="md">
          <form onSubmit={handleSubmit} class="space-y-4">
            <div>
              <label class="label text-[var(--color-text-secondary)] mb-2 block">name</label>
              <input
                type="text"
                value={formData().name}
                onInput={(e) => setFormData({ ...formData(), name: e.currentTarget.value })}
                class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                placeholder="enter your name"
              />
            </div>

            <div>
              <label class="label text-[var(--color-text-secondary)] mb-2 block">email</label>
              <input
                type="email"
                value={formData().email}
                onInput={(e) => setFormData({ ...formData(), email: e.currentTarget.value })}
                class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                placeholder="enter your email"
              />
            </div>

            <div>
              <label class="label text-[var(--color-text-secondary)] mb-2 block">message</label>
              <textarea
                value={formData().message}
                onInput={(e) => setFormData({ ...formData(), message: e.currentTarget.value })}
                class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent resize-none"
                rows="4"
                placeholder="enter your message"
              />
            </div>

            <div class="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors"
              >
                cancel
              </button>
              <button
                type="submit"
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                send message
              </button>
            </div>
          </form>
        </Modal>
      </div>
    );
  },
};

// confirmation dialog
export const ConfirmationDialog: Story = {
  render: () => {
    const modal = useModal();
    const [confirmed, setConfirmed] = createSignal(false);

    const handleConfirm = () => {
      setConfirmed(true);
      modal.close();
      setTimeout(() => setConfirmed(false), 3000);
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal.open}
          class="px-4 py-2 bg-[var(--color-error)] hover:opacity-90 text-white rounded transition-opacity"
        >
          delete song
        </button>

        {confirmed() && (
          <div class="mt-4">
            <Alert variant="success">song deleted successfully</Alert>
          </div>
        )}

        <Modal isOpen={modal.isOpen()} onClose={modal.close} title="confirm deletion" size="sm">
          <div class="space-y-4">
            <BodyText size="base" class="text-[var(--color-text-secondary)]">
              are you sure you want to delete this song? this action cannot be undone.
            </BodyText>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                class="px-4 py-2 bg-[var(--color-error)] hover:opacity-90 text-white rounded transition-opacity"
              >
                delete
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};

// scrollable content
export const ScrollableContent: Story = {
  render: () => {
    const modal = useModal();

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal.open}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
        >
          open scrollable modal
        </button>

        <Modal isOpen={modal.isOpen()} onClose={modal.close} title="terms of service" size="lg">
          <div class="space-y-4">
            {Array.from({ length: 20 }, (_, i) => (
              <div>
                <Heading level={6} class="text-[var(--color-text-primary)] mb-2">
                  section {i + 1}
                </Heading>
                <BodyText size="small" class="text-[var(--color-text-secondary)]">
                  lorem ipsum dolor sit amet, consectetur adipiscing elit. sed do eiusmod tempor
                  incididunt ut labore et dolore magna aliqua. ut enim ad minim veniam, quis nostrud
                  exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
                </BodyText>
              </div>
            ))}
            <div class="flex gap-2 justify-end pt-4">
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors"
              >
                decline
              </button>
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                accept
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};

// no close button
export const NoCloseButton: Story = {
  render: () => {
    const modal = useModal();

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal.open}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
        >
          open modal without close button
        </button>

        <Modal
          isOpen={modal.isOpen()}
          onClose={modal.close}
          title="action required"
          size="sm"
          showCloseButton={false}
        >
          <div class="space-y-4">
            <BodyText size="base" class="text-[var(--color-text-secondary)]">
              you must choose an option to continue. clicking outside or pressing escape will still
              close the modal.
            </BodyText>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                continue
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};

// no backdrop close
export const NoBackdropClose: Story = {
  render: () => {
    const modal = useModal();

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal.open}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
        >
          open modal (no backdrop close)
        </button>

        <Modal
          isOpen={modal.isOpen()}
          onClose={modal.close}
          title="important notice"
          size="sm"
          closeOnBackdrop={false}
        >
          <div class="space-y-4">
            <BodyText size="base" class="text-[var(--color-text-secondary)]">
              clicking outside this modal will not close it. you must use the close button or press
              escape.
            </BodyText>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                got it
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};

// nested modals
export const NestedModals: Story = {
  render: () => {
    const modal1 = useModal();
    const modal2 = useModal();

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal1.open}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
        >
          open first modal
        </button>

        <Modal isOpen={modal1.isOpen()} onClose={modal1.close} title="first modal" size="md">
          <div class="space-y-4">
            <BodyText size="base" class="text-[var(--color-text-secondary)]">
              this is the first modal. you can open another modal on top of this one.
            </BodyText>
            <button
              type="button"
              onClick={modal2.open}
              class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
            >
              open second modal
            </button>
          </div>
        </Modal>

        <Modal isOpen={modal2.isOpen()} onClose={modal2.close} title="second modal" size="sm">
          <div class="space-y-4">
            <BodyText size="base" class="text-[var(--color-text-secondary)]">
              this is a nested modal. close this to return to the first modal.
            </BodyText>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                onClick={modal2.close}
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                close
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};

// song edit modal example
export const SongEditModal: Story = {
  render: () => {
    const modal = useModal();

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <button
          type="button"
          onClick={modal.open}
          class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
        >
          edit song
        </button>

        <Modal isOpen={modal.isOpen()} onClose={modal.close} title="edit song metadata" size="lg">
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="label text-[var(--color-text-secondary)] mb-2 block">title</label>
                <input
                  type="text"
                  value={mockSongs[0].title}
                  class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                />
              </div>
              <div>
                <label class="label text-[var(--color-text-secondary)] mb-2 block">artist</label>
                <input
                  type="text"
                  value={mockSongs[0].artist}
                  class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="label text-[var(--color-text-secondary)] mb-2 block">album</label>
                <input
                  type="text"
                  value="the dark side of the moon"
                  class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                />
              </div>
              <div>
                <label class="label text-[var(--color-text-secondary)] mb-2 block">year</label>
                <input
                  type="text"
                  value="1973"
                  class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                />
              </div>
            </div>

            <div class="grid grid-cols-3 gap-4">
              <div>
                <label class="label text-[var(--color-text-secondary)] mb-2 block">track</label>
                <input
                  type="text"
                  value="1"
                  class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                />
              </div>
              <div>
                <label class="label text-[var(--color-text-secondary)] mb-2 block">disc</label>
                <input
                  type="text"
                  value="1"
                  class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                />
              </div>
              <div>
                <label class="label text-[var(--color-text-secondary)] mb-2 block">genre</label>
                <input
                  type="text"
                  value="progressive rock"
                  class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] focus:border-transparent"
                />
              </div>
            </div>

            <div class="flex gap-2 justify-end pt-4">
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors"
              >
                cancel
              </button>
              <button
                type="button"
                onClick={modal.close}
                class="px-4 py-2 bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] rounded transition-colors"
              >
                save changes
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};
