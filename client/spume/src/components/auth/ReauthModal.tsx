// re-authentication modal for expired remote sessions
// presents the login-only WebAuthn flow for an existing remote

import { createSignal, Show } from "solid-js";
import { authenticate } from "../../app/services/remotes/authService";
import { Modal } from "../overlays/Modal";
import { AuthForm } from "./AuthForm";
import { Alert } from "../feedback/Alert";

export interface ReauthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  baseUrl: string;
  remoteName: string;
}

// modal that re-authenticates a user to an existing remote via WebAuthn login
export function ReauthModal(props: ReauthModalProps) {
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleAuth = async (data: {
    username: string;
    inviteCode?: string;
    mode: "login" | "register";
  }) => {
    setError(null);
    setIsLoading(true);

    try {
      const result = await authenticate(props.baseUrl, data);

      if (!result.success) {
        throw new Error(result.error ?? "authentication failed");
      }

      // success
      props.onSuccess();
    } catch (err) {
      console.error("re-authentication failed:", err);
      setError(err instanceof Error ? err.message : "authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading()) return;
    setError(null);
    props.onClose();
  };

  return (
    <Modal isOpen={props.isOpen} onClose={handleClose} title={`sign in to ${props.remoteName}`}>
      <div class="space-y-4">
        <Show when={error()}>
          <Alert variant="error">{error()}</Alert>
        </Show>

        <p class="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          your session has expired. sign in again to continue.
        </p>

        <AuthForm
          initialMode="login"
          onSubmit={handleAuth}
          loading={isLoading()}
          error={undefined}
          showModeToggle={true}
        />
      </div>
    </Modal>
  );
}
