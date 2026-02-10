import { createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";
import { toast, ToastRegion } from "../src/components/feedback/Toast";

const meta = {
  title: "Components/Feedback/Toast",
  component: ToastRegion,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ToastRegion>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * interactive demo of all toast variants
 *
 * - success (green)
 * - error (red)
 * - warning (yellow)
 * - info (blue)
 */
export const AllVariants: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "40px",
          "min-height": "400px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <h2
          style={{
            color: "var(--color-text-primary)",
            "font-size": "20px",
            "margin-bottom": "8px",
          }}
        >
          toast notifications
        </h2>
        <p
          style={{
            color: "var(--color-text-secondary)",
            "font-size": "14px",
            "margin-bottom": "16px",
          }}
        >
          click buttons to trigger different toast types
        </p>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <Button
            variant="primary"
            onClick={() => toast.success("operation completed successfully")}
          >
            success toast
          </Button>

          <Button
            variant="danger"
            onClick={() => toast.error("something went wrong")}
          >
            error toast
          </Button>

          <Button
            variant="secondary"
            onClick={() => toast.warning("this action cannot be undone")}
          >
            warning toast
          </Button>

          <Button
            variant="ghost"
            onClick={() => toast.info("processing your request...")}
          >
            info toast
          </Button>

          <Button
            variant="secondary"
            onClick={() =>
              toast.warning("this message won't auto-dismiss", {
                title: "persistent toast",
                persistent: true,
              })
            }
          >
            persistent toast
          </Button>
        </div>

        <Portal>
          <ToastRegion />
        </Portal>
      </div>
    );
  },
};

/**
 * toasts with titles for more context
 */
export const WithTitles: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "40px",
          "min-height": "300px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <Button
            variant="primary"
            onClick={() =>
              toast.success("your playlist has been saved", {
                title: "success",
              })
            }
          >
            success with title
          </Button>

          <Button
            variant="danger"
            onClick={() =>
              toast.error("could not connect to server", {
                title: "connection error",
              })
            }
          >
            error with title
          </Button>
        </div>

        <Portal>
          <ToastRegion />
        </Portal>
      </div>
    );
  },
};

/**
 * custom duration for different scenarios
 */
export const CustomDuration: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "40px",
          "min-height": "300px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <Button
            variant="primary"
            onClick={() => toast.success("quick message", { duration: 2000 })}
          >
            2 seconds
          </Button>

          <Button
            variant="secondary"
            onClick={() => toast.info("standard message", { duration: 5000 })}
          >
            5 seconds (default)
          </Button>

          <Button
            variant="ghost"
            onClick={() =>
              toast.warning("longer message with more info", {
                duration: 10000,
              })
            }
          >
            10 seconds
          </Button>
        </div>

        <Portal>
          <ToastRegion />
        </Portal>
      </div>
    );
  },
};

/**
 * persistent toasts that don't auto-dismiss
 */
export const Persistent: Story = {
  render: () => {
    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "40px",
          "min-height": "300px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <p
          style={{
            color: "var(--color-text-secondary)",
            "font-size": "14px",
            "margin-bottom": "8px",
          }}
        >
          persistent toasts require manual dismissal
        </p>

        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <Button
            variant="primary"
            onClick={() =>
              toast.warning("important: read this carefully", {
                title: "action required",
                persistent: true,
              })
            }
          >
            show persistent toast
          </Button>

          <Button variant="danger" onClick={() => toast.clear()}>
            clear all toasts
          </Button>
        </div>

        <Portal>
          <ToastRegion />
        </Portal>
      </div>
    );
  },
};

/**
 * multiple toasts queuing behavior
 */
export const MultipleToasts: Story = {
  render: () => {
    const showMultiple = () => {
      toast.success("first toast");
      setTimeout(() => toast.info("second toast"), 200);
      setTimeout(() => toast.warning("third toast"), 400);
      setTimeout(() => toast.error("fourth toast"), 600);
      setTimeout(() => toast.success("fifth toast"), 800);
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "40px",
          "min-height": "300px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <p
          style={{
            color: "var(--color-text-secondary)",
            "font-size": "14px",
            "margin-bottom": "8px",
          }}
        >
          shows up to 3 toasts at once, others are queued
        </p>

        <Button variant="primary" onClick={showMultiple}>
          show 5 toasts
        </Button>

        <Portal>
          <ToastRegion />
        </Portal>
      </div>
    );
  },
};

/**
 * real-world usage examples
 */
export const RealWorldExamples: Story = {
  render: () => {
    const [processing, setProcessing] = createSignal(false);

    const simulateUpload = () => {
      setProcessing(true);
      toast.info("uploading file...", { duration: 2000 });

      setTimeout(() => {
        setProcessing(false);
        toast.success("file uploaded successfully", {
          title: "upload complete",
        });
      }, 2000);
    };

    const simulateError = () => {
      toast.error("failed to save changes", {
        title: "save error",
        duration: 7000,
      });
    };

    const addToQueue = () => {
      toast.success('added "bohemian rhapsody" to queue');
    };

    const playlistCreated = () => {
      toast.success("playlist created", {
        title: "summer vibes 2024",
      });
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "40px",
          "min-height": "400px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <h3
          style={{
            color: "var(--color-text-primary)",
            "font-size": "18px",
            "margin-bottom": "8px",
          }}
        >
          typical use cases
        </h3>

        <div
          style={{
            display: "flex",
            gap: "8px",
            "flex-wrap": "wrap",
            "max-width": "500px",
            "justify-content": "center",
          }}
        >
          <Button
            variant="primary"
            onClick={simulateUpload}
            disabled={processing()}
          >
            simulate file upload
          </Button>

          <Button variant="danger" onClick={simulateError}>
            simulate error
          </Button>

          <Button variant="secondary" onClick={addToQueue}>
            add to queue
          </Button>

          <Button variant="ghost" onClick={playlistCreated}>
            playlist created
          </Button>
        </div>

        <Portal>
          <ToastRegion />
        </Portal>
      </div>
    );
  },
};

/**
 * dismissible toasts with manual control
 */
export const ManualControl: Story = {
  render: () => {
    const [toastId, setToastId] = createSignal<number | null>(null);

    const showToast = () => {
      const id = toast.info("this is a controllable toast", {
        persistent: true,
        title: "manual control",
      });
      setToastId(id);
    };

    const dismissToast = () => {
      if (toastId() !== null) {
        toast.dismiss(toastId()!);
        setToastId(null);
      }
    };

    return (
      <div
        style={{
          "background-color": "var(--color-bg-primary)",
          padding: "40px",
          "min-height": "300px",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <p
          style={{
            color: "var(--color-text-secondary)",
            "font-size": "14px",
            "margin-bottom": "8px",
          }}
        >
          programmatically control toast dismissal
        </p>

        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="primary" onClick={showToast}>
            show toast
          </Button>

          <Button
            variant="secondary"
            onClick={dismissToast}
            disabled={toastId() === null}
          >
            dismiss toast
          </Button>

          <Button variant="danger" onClick={() => toast.clear()}>
            clear all
          </Button>
        </div>

        <Portal>
          <ToastRegion />
        </Portal>
      </div>
    );
  },
};
