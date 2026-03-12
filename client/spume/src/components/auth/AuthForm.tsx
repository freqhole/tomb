import { createSignal, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { Alert } from "../feedback/Alert";
import { TextInput } from "../forms/TextInput";
import { isWebAuthnAvailable } from "../../app/services/remotes/authService";

export type AuthMode = "login" | "register";

export interface AuthFormProps {
  /** initial mode: login or register */
  initialMode?: AuthMode;
  /** callback when form is submitted */
  onSubmit?: (data: {
    username: string;
    inviteCode?: string;
    mode: "login" | "register";
  }) => void | Promise<void>;
  /** whether the form is in a loading state */
  loading?: boolean;
  /** error message to display */
  error?: string;
  /** callback when mode is switched */
  onModeChange?: (mode: AuthMode) => void;
  /** whether to show the mode toggle */
  showModeToggle?: boolean;
  /** hide the passkey info text (for P2P or tauri) */
  hidePasskeyInfo?: boolean;
  /** additional classes for the container */
  class?: string;
}

// auth form component with login/register modes
export function AuthForm(props: AuthFormProps) {
  const [mode, setMode] = createSignal<AuthMode>(props.initialMode || "login");
  const [username, setUsername] = createSignal("");
  const [inviteCode, setInviteCode] = createSignal("");

  const showModeToggle = () => props.showModeToggle ?? true;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (props.loading) return;

    const data = {
      username: username(),
      inviteCode: mode() === "register" ? inviteCode() : undefined,
      mode: mode() as "login" | "register",
    };

    await props.onSubmit?.(data);
  };

  const switchMode = () => {
    const newMode = mode() === "login" ? "register" : "login";
    setMode(newMode);
    props.onModeChange?.(newMode);
  };

  const isSubmitDisabled = () => {
    if (props.loading) return true;
    if (!username().trim()) return true;
    if (mode() === "register" && !inviteCode().trim()) return true;
    return false;
  };

  return (
    <div class={`space-y-6 ${props.class || ""}`}>
      {/* error message */}
      <Show when={props.error}>
        <Alert variant="error">{props.error}</Alert>
      </Show>

      {/* auth form */}
      <form onSubmit={handleSubmit} class="space-y-4">
        {/* username input */}
        <TextInput
          label="username"
          type="text"
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
          disabled={props.loading}
          placeholder="enter your username"
          required
          variant="filled"
        />

        {/* invite code input (register only) */}
        <Show when={mode() === "register"}>
          <TextInput
            label="invite code"
            type="text"
            value={inviteCode()}
            onInput={(e) => setInviteCode(e.currentTarget.value)}
            disabled={props.loading}
            placeholder="enter your invite code"
            required
            variant="filled"
            hint="invite codes are required to create new accounts"
          />
        </Show>

        {/* submit button */}
        <Button type="submit" variant="primary" disabled={isSubmitDisabled()} class="w-full">
          <Show when={props.loading} fallback={mode() === "login" ? "sign in" : "create account"}>
            {mode() === "login" ? "signing in..." : "creating account..."}
          </Show>
        </Button>
      </form>

      {/* mode switch */}
      <Show when={showModeToggle()}>
        <div class="text-center border-t border-[var(--color-border-default)] pt-4">
          <p class="body-sm text-[var(--color-text-tertiary)]">
            {mode() === "login" ? "don't have an account?" : "already have an account?"}{" "}
            <button
              type="button"
              onClick={switchMode}
              disabled={props.loading}
              class="text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mode() === "login" ? "create one" : "sign in"}
            </button>
          </p>
        </div>
      </Show>

      {/* info text - hide for P2P/tauri where webauthn isn't used */}
      <Show when={isWebAuthnAvailable() && !props.hidePasskeyInfo}>
        <div class="bg-[var(--color-bg-secondary)] rounded p-4">
          <p class="caption text-[var(--color-text-tertiary)] leading-relaxed">
            <Show
              when={mode() === "login"}
              fallback={
                <>
                  freqhole uses passwordless authentication. you'll use your device's built-in
                  security (fingerprint, face recognition, or security key) to create and access
                  your account.
                </>
              }
            >
              use your device's built-in security (fingerprint, face recognition, or security key)
              to sign in securely.
            </Show>
          </p>
        </div>
      </Show>
    </div>
  );
}
