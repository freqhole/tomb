// headless re-authentication flow: loading/error state around a single
// injected `authenticate` call, plus a close guard that refuses to close
// while a request is in flight. pairs naturally with `createAuthForm` -
// pass this flow's `isLoading`/`submit` straight through as that
// primitive's `loading`/`onSubmit` deps.

import { createSignal, type Accessor } from "solid-js";
import type { AuthFormData } from "./auth-form.js";

export interface ReauthFlowDeps {
  /** performs the actual re-authentication against whatever transport the
   *  caller is using. resolve with `{ success: false }` (or reject) on
   *  failure - both are treated as failures and surface `error`. */
  authenticate(data: AuthFormData): Promise<{ success: boolean; error?: string }>;
  /** called once `authenticate` resolves with `success: true`. */
  onSuccess(): void;
  /** called from `close()`, but only when not currently loading. */
  onClose(): void;
}

export interface ReauthFlowState {
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  /** runs `authenticate`, calling `onSuccess` on success or setting
   *  `error` on failure. */
  submit(data: AuthFormData): Promise<void>;
  /** clears any error and calls `onClose`, unless a submit is in flight. */
  close(): void;
}

export function createReauthFlow(deps: ReauthFlowDeps): ReauthFlowState {
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function submit(data: AuthFormData): Promise<void> {
    setError(null);
    setIsLoading(true);
    try {
      const result = await deps.authenticate(data);
      if (!result.success) {
        throw new Error(result.error ?? "authentication failed");
      }
      deps.onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "authentication failed");
    } finally {
      setIsLoading(false);
    }
  }

  function close(): void {
    if (isLoading()) return;
    setError(null);
    deps.onClose();
  }

  return { isLoading, error, submit, close };
}
