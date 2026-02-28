import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Badge } from "../src/components/badges/Badge";
import { Button } from "../src/components/buttons/Button";
import { Alert } from "../src/components/feedback/Alert";
import { mockArtists, mockSongs } from "./mockData";

const meta = {
  title: "Components/Feedback/Alert",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// basic alerts - all variants
export const AllVariants: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl space-y-4">
        <Alert variant="success">changes have been saved successfully</Alert>

        <Alert variant="info">this is some helpful information you might want to know</Alert>

        <Alert variant="warning">session will expire in 5 minutes. please save yr work</Alert>

        <Alert variant="error">
          failed to upload file. please check yr connection and try again
        </Alert>
      </div>
    </div>
  ),
};

// alerts with titles
export const WithTitles: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl space-y-4">
        <Alert variant="success" title="success!">
          a song has been added to the library
        </Alert>

        <Alert variant="info" title="did you know?">
          drag and drop files to upload multiple songs at once
        </Alert>

        <Alert variant="warning" title="heads up">
          some metadata fields are missing. consider filling them out for better organization
        </Alert>

        <Alert variant="error" title="upload failed">
          the file format is not supported. please use mp3, flac, wav, or m4a
        </Alert>
      </div>
    </div>
  ),
};

// alerts with close button
export const Dismissible: Story = {
  render: () => {
    const [showSuccess, setShowSuccess] = createSignal(true);
    const [showInfo, setShowInfo] = createSignal(true);
    const [showWarning, setShowWarning] = createSignal(true);
    const [showError, setShowError] = createSignal(true);

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl space-y-4">
          {showSuccess() && (
            <Alert variant="success" title="songs imported" onClose={() => setShowSuccess(false)}>
              successfully imported 12 songs to the library
            </Alert>
          )}

          {showInfo() && (
            <Alert variant="info" title="new feature" onClose={() => setShowInfo(false)}>
              you can now search by lyrics in addition to song metadata
            </Alert>
          )}

          {showWarning() && (
            <Alert variant="warning" title="storage warning" onClose={() => setShowWarning(false)}>
              you're using 80% of yr storage quota. consider overthrowing the evil empire!
            </Alert>
          )}

          {showError() && (
            <Alert variant="error" title="connection error" onClose={() => setShowError(false)}>
              unable to sync with server. check yr internet connection? go take a walk?!
            </Alert>
          )}

          <div class="pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowSuccess(true);
                setShowInfo(true);
                setShowWarning(true);
                setShowError(true);
              }}
            >
              reset all alerts
            </Button>
          </div>
        </div>
      </div>
    );
  },
};

// alerts without icons
export const WithoutIcons: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl space-y-4">
        <Alert variant="success" icon={false}>
          changes saved
        </Alert>

        <Alert variant="info" icon={false} title="note">
          this feature is currently in beta
        </Alert>

        <Alert variant="warning" icon={false}>
          some fields are required
        </Alert>

        <Alert variant="error" icon={false}>
          invalid email address
        </Alert>
      </div>
    </div>
  ),
};

// alerts with custom icons
export const CustomIcons: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl space-y-4">
        <Alert variant="success" icon="music" title="playlist created">
          "summer vibes 2024" has been created with 24 songs
        </Alert>

        <Alert variant="info" icon="search" title="search tip">
          use quotes for exact phrase matching, e.g. "{mockArtists[0].name}"
        </Alert>

        <Alert variant="warning" icon="upload" title="upload in progress">
          uploading 5 files... please don't close this window
        </Alert>

        <Alert variant="error" icon="x" title="missing artwork">
          no album artwork found for this release
        </Alert>
      </div>
    </div>
  ),
};

// inline validation alerts
export const InlineValidation: Story = {
  render: () => {
    const [email, setEmail] = createSignal("");
    const [submitted, setSubmitted] = createSignal(false);

    const emailError = () => {
      if (!submitted()) return null;
      if (!email()) return "email is required";
      if (!email().includes("@")) return "please enter a valid email address";
      return null;
    };

    const isValid = () => !emailError() && email() && submitted();

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md space-y-4">
          <div>
            <label class="label text-[var(--color-text-secondary)] block mb-2">email address</label>
            <input
              type="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              placeholder="your@email.com"
              class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-opacity-50"
            />
          </div>

          {emailError() && (
            <Alert variant="error" icon="alertTriangle">
              {emailError()}
            </Alert>
          )}

          {isValid() && (
            <Alert variant="success" icon="check">
              email address is valid
            </Alert>
          )}

          <Button variant="primary" onClick={() => setSubmitted(true)}>
            validate
          </Button>
        </div>
      </div>
    );
  },
};

// form submission feedback
export const FormFeedback: Story = {
  render: () => {
    const [status, setStatus] = createSignal<"idle" | "loading" | "success" | "error">("idle");
    const [errorMessage, setErrorMessage] = createSignal("");

    const handleSubmit = () => {
      setStatus("loading");

      // simulate API call
      setTimeout(() => {
        const success = Math.random() > 0.3;
        if (success) {
          setStatus("success");
        } else {
          setStatus("error");
          setErrorMessage("network error: failed to save changes");
        }
      }, 1500);
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-2xl">
          <h2 class="heading-5 text-[var(--color-text-primary)] mb-6">edit song metadata</h2>

          <div class="space-y-4">
            {status() === "loading" && (
              <Alert variant="info" icon="info">
                saving changes...
              </Alert>
            )}

            {status() === "success" && (
              <Alert variant="success" title="changes saved" onClose={() => setStatus("idle")}>
                song metadata has been updated successfully
              </Alert>
            )}

            {status() === "error" && (
              <Alert variant="error" title="failed to save" onClose={() => setStatus("idle")}>
                {errorMessage()}
              </Alert>
            )}

            <div class="space-y-3">
              <input
                type="text"
                placeholder="song title"
                class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)]"
              />
              <input
                type="text"
                placeholder="artist"
                class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)]"
              />
            </div>

            <div class="flex gap-2">
              <Button variant="primary" onClick={handleSubmit} disabled={status() === "loading"}>
                {status() === "loading" ? "saving..." : "save changes"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setStatus("idle")}
                disabled={status() === "loading"}
              >
                cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  },
};

// upload status alerts
export const UploadStatus: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-2xl space-y-4">
        <Alert variant="info" icon="upload" title="preparing upload">
          analyzing 3 files...
        </Alert>

        <Alert variant="warning" icon="alertTriangle" title="duplicate found">
          "bohemian rhapsody.mp3" already exists in the library. would you like to replace it?
        </Alert>

        <Alert variant="success" icon="check" title="upload complete">
          successfully uploaded 3 songs. 2 new songs added, 1 skipped (duplicate)
        </Alert>

        <Alert variant="error" icon="x" title="upload failed">
          failed to upload "large_file.flac" - file exceeds 1GB size limit
        </Alert>
      </div>
    </div>
  ),
};

// stacked alerts (notification center style)
export const StackedAlerts: Story = {
  render: () => {
    const [alerts, setAlerts] = createSignal([
      {
        id: 1,
        variant: "success" as const,
        title: "song added",
        message: `added '${mockSongs[0].title}' to playlist`,
      },
      {
        id: 2,
        variant: "info" as const,
        title: "now playing",
        message: `${mockSongs[1].title} - ${mockSongs[1].artist}`,
      },
      {
        id: 3,
        variant: "warning" as const,
        title: "low storage",
        message: "only 2GB of storage remaining",
      },
    ]);

    const removeAlert = (id: number) => {
      setAlerts(alerts().filter((alert) => alert.id !== id));
    };

    return (
      <div class="p-8 bg-[var(--color-bg-primary)]">
        <div class="max-w-md space-y-3">
          {alerts().map((alert) => (
            <Alert
              variant={alert.variant}
              title={alert.title}
              onClose={() => removeAlert(alert.id)}
            >
              {alert.message}
            </Alert>
          ))}

          {alerts().length === 0 && (
            <div class="text-center py-8 text-[var(--color-text-tertiary)]">no alerts</div>
          )}
        </div>
      </div>
    );
  },
};

// compact inline alerts
export const CompactInline: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-md space-y-6">
        <div>
          <input
            type="text"
            placeholder="username"
            class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] mb-2"
          />
          <Alert variant="error" icon={false}>
            username is already taken
          </Alert>
        </div>

        <div>
          <input
            type="password"
            placeholder="password"
            class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] mb-2"
          />
          <Alert variant="warning" icon={false}>
            password must be at least 8 characters
          </Alert>
        </div>

        <div>
          <input
            type="email"
            value="valid@email.com"
            class="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] mb-2"
          />
          <Alert variant="success" icon={false}>
            email is valid
          </Alert>
        </div>
      </div>
    </div>
  ),
};

// solid vs translucent comparison
export const SolidVsTranslucent: Story = {
  render: () => (
    <div class="p-8 bg-[var(--color-bg-primary)]">
      <div class="max-w-3xl space-y-8">
        <div>
          <h3 class="heading-5 text-[var(--color-text-primary)] mb-4">
            translucent alerts (default)
          </h3>
          <p class="body-small text-[var(--color-text-secondary)] mb-4">
            translucent backgrounds with white text - used for inline messages and notifications
          </p>
          <div class="space-y-3">
            <Alert variant="success" title="success">
              translucent green background with white text
            </Alert>
            <Alert variant="warning" title="warning">
              translucent orange background with white text
            </Alert>
            <Alert variant="error" title="error">
              translucent red background with white text
            </Alert>
            <Alert variant="info" title="info">
              translucent blue background with white text
            </Alert>
          </div>
        </div>

        <div>
          <h3 class="heading-5 text-[var(--color-text-primary)] mb-4">
            solid badges (for comparison)
          </h3>
          <p class="body-small text-[var(--color-text-secondary)] mb-4">
            solid backgrounds with appropriate text colors - success/warning/info use black text,
            error uses white text
          </p>
          <div class="flex gap-3 flex-wrap">
            <Badge variant="success">success badge</Badge>
            <Badge variant="warning">warning badge</Badge>
            <Badge variant="error">error badge</Badge>
            <Badge variant="accent">accent badge</Badge>
          </div>
        </div>

        <div class="border border-[var(--color-border-default)] rounded-lg p-6 bg-[var(--color-bg-secondary)]">
          <h4 class="heading-6 text-[var(--color-text-primary)] mb-3">color usage guide</h4>
          <div class="space-y-2 body-small text-[var(--color-text-secondary)]">
            <p>
              <strong class="text-[var(--color-text-primary)]">translucent (alerts):</strong> all
              variants use white text because translucent colors on black backgrounds need high
              contrast
            </p>
            <p>
              <strong class="text-[var(--color-text-primary)]">solid (badges/buttons):</strong>{" "}
              success/warning/info use black text on bright backgrounds, error/accent use white text
              on dark backgrounds
            </p>
            <p class="caption text-[var(--color-text-tertiary)] pt-2">
              these pairings are defined in <code class="monospace">design-system/colors.ts</code>{" "}
              to prevent bugs
            </p>
          </div>
        </div>
      </div>
    </div>
  ),
};
