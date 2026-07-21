// headless auth-form state: mode switching (login/register), field
// signals, submit-disabled logic, and the submit/passkey handlers - all
// with zero markup or styling opinions. consumers render whatever inputs/
// buttons they like and wire them to the returned signals/handlers.

import { createSignal, type Accessor, type Setter } from "solid-js";

export type AuthMode = "login" | "register";

export interface AuthFormData {
  username: string;
  inviteCode?: string;
  mode: AuthMode;
}

export interface AuthFormDeps {
  /** starting mode. defaults to "login". */
  initialMode?: AuthMode;
  /** reactive read of the current loading state (e.g. `() => isLoading()`).
   *  while true, submit and passkey handlers no-op instead of firing
   *  another request. defaults to `() => false`. */
  loading?: () => boolean;
  onSubmit?: (data: AuthFormData) => void | Promise<void>;
  onPasskeyClick?: (data: AuthFormData) => void | Promise<void>;
  onModeChange?: (mode: AuthMode) => void;
}

export interface AuthFormState {
  mode: Accessor<AuthMode>;
  username: Accessor<string>;
  setUsername: Setter<string>;
  inviteCode: Accessor<string>;
  setInviteCode: Setter<string>;
  /** true when the current field values don't satisfy submission
   *  (blank username, or register mode with a blank invite code) or the
   *  form is loading. */
  isSubmitDisabled: Accessor<boolean>;
  /** flips between login and register, notifying `onModeChange`. */
  switchMode(): void;
  /** builds the current `AuthFormData` and calls `onSubmit`. no-ops while
   *  loading. `event?.preventDefault()` is called if an event is passed,
   *  so this can be wired directly to a `<form onSubmit>`. */
  handleSubmit(event?: { preventDefault(): void }): Promise<void>;
  /** same shape as `handleSubmit`, but calls `onPasskeyClick`. */
  handlePasskeyClick(event?: { preventDefault(): void }): Promise<void>;
}

export function createAuthForm(deps: AuthFormDeps = {}): AuthFormState {
  const isLoading = deps.loading ?? (() => false);
  const [mode, setMode] = createSignal<AuthMode>(deps.initialMode ?? "login");
  const [username, setUsername] = createSignal("");
  const [inviteCode, setInviteCode] = createSignal("");

  function currentData(): AuthFormData {
    return {
      username: username(),
      inviteCode: mode() === "register" ? inviteCode() : undefined,
      mode: mode(),
    };
  }

  function isSubmitDisabled(): boolean {
    if (isLoading()) return true;
    if (!username().trim()) return true;
    if (mode() === "register" && !inviteCode().trim()) return true;
    return false;
  }

  function switchMode(): void {
    const next = mode() === "login" ? "register" : "login";
    setMode(next);
    deps.onModeChange?.(next);
  }

  async function handleSubmit(event?: { preventDefault(): void }): Promise<void> {
    event?.preventDefault();
    if (isLoading()) return;
    await deps.onSubmit?.(currentData());
  }

  async function handlePasskeyClick(event?: { preventDefault(): void }): Promise<void> {
    event?.preventDefault();
    if (isLoading()) return;
    await deps.onPasskeyClick?.(currentData());
  }

  return {
    mode,
    username,
    setUsername,
    inviteCode,
    setInviteCode,
    isSubmitDisabled,
    switchMode,
    handleSubmit,
    handlePasskeyClick,
  };
}
