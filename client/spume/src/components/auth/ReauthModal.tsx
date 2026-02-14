// re-authentication modal for expired remote sessions
// presents the login-only WebAuthn flow for an existing remote

import { createSignal, Show } from "solid-js";
import * as apiClient from "freqhole-api-client";
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
      const baseUrl = props.baseUrl;

      if (data.mode === "register") {
        // registration with invite code
        if (!data.inviteCode) {
          throw new Error("invite code required for registration");
        }

        const startResult = await apiClient.auth.registerStart(baseUrl, {
          username: data.username,
          invite_code: data.inviteCode,
        });

        if (!startResult.success) {
          throw new Error("failed to start registration");
        }

        const credentialOptions = apiClient.webauthn.prepareRegistrationOptions(startResult.data);
        const credential = (await navigator.credentials.create(credentialOptions)) as PublicKeyCredential;

        if (!credential) {
          throw new Error("failed to create credential");
        }

        const serializedCredential = apiClient.webauthn.serializeRegistrationCredential(credential);
        const finishResult = await apiClient.auth.registerFinish(baseUrl, serializedCredential);

        if (!finishResult.success) {
          throw new Error("failed to complete registration");
        }
      } else {
        // login flow with WebAuthn
        const startResult = await apiClient.auth.loginStart(baseUrl, {
          username: data.username,
        });

        if (!startResult.success) {
          throw new Error("failed to start login");
        }

        const credentialOptions = apiClient.webauthn.prepareAuthenticationOptions(startResult.data);
        const credential = (await navigator.credentials.get(credentialOptions)) as PublicKeyCredential;

        if (!credential) {
          throw new Error("failed to get credential");
        }

        const serializedCredential = apiClient.webauthn.serializeAuthenticationCredential(credential);
        const finishResult = await apiClient.auth.loginFinish(baseUrl, serializedCredential);

        if (!finishResult.success) {
          throw new Error("failed to complete login");
        }
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
