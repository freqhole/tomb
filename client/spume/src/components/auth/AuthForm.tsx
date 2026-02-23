import { createSignal, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { Alert } from "../feedback/Alert";
import { TextInput } from "../forms/TextInput";

export type AuthMode = "login" | "register" | "apikey";

export interface AuthFormProps {
  /** initial mode: login, register, or apikey */
  initialMode?: AuthMode;
  /** callback when form is submitted (login/register modes) */
  onSubmit?: (data: {
    username: string;
    inviteCode?: string;
    mode: "login" | "register";
  }) => void | Promise<void>;
  /** callback when API key is submitted */
  onApiKeySubmit?: (apiKey: string) => void | Promise<void>;
  /** whether the form is in a loading state */
  loading?: boolean;
  /** error message to display */
  error?: string;
  /** callback when mode is switched */
  onModeChange?: (mode: AuthMode) => void;
  /** whether to show the mode toggle */
  showModeToggle?: boolean;
  /** whether to show the API key option */
  showApiKeyOption?: boolean;
  /** additional classes for the container */
  class?: string;
}

// auth form component with login/register/apikey modes
export function AuthForm(props: AuthFormProps) {
  const [mode, setMode] = createSignal<AuthMode>(props.initialMode || "login");
  const [username, setUsername] = createSignal("");
  const [inviteCode, setInviteCode] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");

  const showModeToggle = () => props.showModeToggle ?? true;
  const showApiKeyOption = () => props.showApiKeyOption ?? true;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (props.loading) return;

    if (mode() === "apikey") {
      await props.onApiKeySubmit?.(apiKey());
      return;
    }

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

  const switchToApiKey = () => {
    setMode("apikey");
    props.onModeChange?.("apikey");
  };

  const switchFromApiKey = () => {
    setMode("login");
    props.onModeChange?.("login");
  };

  const isSubmitDisabled = () => {
    if (props.loading) return true;
    if (mode() === "apikey") {
      return !apiKey().trim();
    }
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
        {/* API key input (apikey mode only) */}
        <Show when={mode() === "apikey"}>
          <TextInput
            label="api key"
            type="text"
            value={apiKey()}
            onInput={(e) => setApiKey(e.currentTarget.value)}
            disabled={props.loading}
            placeholder="paste your api key"
            required
            variant="filled"
            hint="get your api key from your account settings on the server"
          />
        </Show>

        {/* username input (login/register modes) */}
        <Show when={mode() !== "apikey"}>
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
        </Show>

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
          <Show
            when={props.loading}
            fallback={
              mode() === "login"
                ? "sign in"
                : mode() === "register"
                  ? "create account"
                  : "connect with api key"
            }
          >
            {mode() === "login"
              ? "signing in..."
              : mode() === "register"
                ? "creating account..."
                : "connecting..."}
          </Show>
        </Button>
      </form>

      {/* mode switch */}
      <Show when={showModeToggle() && mode() !== "apikey"}>
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

      {/* api key option link */}
      <Show when={showApiKeyOption() && mode() !== "apikey"}>
        <div class="text-center">
          <button
            type="button"
            onClick={switchToApiKey}
            disabled={props.loading}
            class="caption text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            use api key instead
          </button>
        </div>
      </Show>

      {/* back from api key mode */}
      <Show when={mode() === "apikey"}>
        <div class="text-center border-t border-[var(--color-border-default)] pt-4">
          <button
            type="button"
            onClick={switchFromApiKey}
            disabled={props.loading}
            class="body-sm text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            back to passkey sign in
          </button>
        </div>
      </Show>

      {/* info text */}
      <div class="bg-[var(--color-bg-secondary)] rounded p-4">
        <p class="caption text-[var(--color-text-tertiary)] leading-relaxed">
          <Show
            when={mode() === "apikey"}
            fallback={
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
            }
          >
            api key authentication works in environments where passkeys aren't supported (like some
            desktop apps). generate an api key from your account settings on the server.
          </Show>
        </p>
      </div>
    </div>
  );
}
