/* @jsxImportSource solid-js */
import { createSignal, Show } from "solid-js";
import { useAuth } from "../../../../hooks/auth";
import { Modal } from "../ui/Modal";

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

export const AuthModal = (props: AuthModalProps) => {
  const [mode, setMode] = createSignal<"login" | "register">("login");
  const [username, setUsername] = createSignal("");
  const [inviteCode, setInviteCode] = createSignal("");

  const auth = useAuth({
    onAuthSuccess: (_username) => {
      props.onAuthSuccess?.();
      props.onClose();
      setUsername("");
      setInviteCode("");
    },
    onAuthError: (error) => {
      // Error is handled by the hook's error state
      console.error("Auth error:", error);
    },
  });

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (mode() === "login") {
      await auth.login(username());
    } else {
      await auth.register(username(), inviteCode());
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !auth.isLoading) {
      handleSubmit(e);
    }
  };

  const switchMode = () => {
    setMode(mode() === "login" ? "register" : "login");
    auth.clearError();
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      size="sm"
      title={mode() === "login" ? "Sign In" : "Create Account"}
    >
      <div class="space-y-6">
        {/* Error Message */}
        <Show when={auth.error}>
          <div class="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p class="text-red-400 text-sm">{auth.error}</p>
          </div>
        </Show>

        {/* Auth Form */}
        <form onSubmit={handleSubmit} class="space-y-4">
          {/* Username Input */}
          <div>
            <label
              for="username"
              class="block text-sm font-medium text-gray-300 mb-2"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              disabled={auth.isLoading}
              placeholder="Enter your username"
              class="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              required
            />
          </div>

          {/* Invite Code Input (Register only) */}
          <Show when={mode() === "register"}>
            <div>
              <label
                for="inviteCode"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                Invite Code
              </label>
              <input
                id="inviteCode"
                type="text"
                value={inviteCode()}
                onInput={(e) => setInviteCode(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                disabled={auth.isLoading}
                placeholder="Enter your invite code"
                class="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                required
              />
            </div>
          </Show>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={
              auth.isLoading ||
              !username() ||
              (mode() === "register" && !inviteCode())
            }
            class="w-full py-3 px-4 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
          >
            <Show when={auth.isLoading}>
              <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </Show>
            {auth.isLoading
              ? mode() === "login"
                ? "Signing in..."
                : "Creating account..."
              : mode() === "login"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        {/* Mode Switch */}
        <div class="text-center border-t border-gray-700 pt-4">
          <p class="text-gray-400 text-sm">
            {mode() === "login"
              ? "Don't have an account?"
              : "Already have an account?"}{" "}
            <button
              onClick={switchMode}
              disabled={auth.isLoading}
              class="text-fuchsia-400 hover:text-fuchsia-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mode() === "login" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>

        {/* Info Text */}
        <div class="bg-gray-900/50 rounded-lg p-4">
          <p class="text-gray-400 text-xs leading-relaxed">
            <Show
              when={mode() === "login"}
              fallback={
                <>
                  This app uses WebAuthn for secure, passwordless
                  authentication. You'll use your device's built-in security
                  (fingerprint, face recognition, or security key) to create and
                  access your account.
                </>
              }
            >
              Use your device's built-in security (fingerprint, face
              recognition, or security key) to sign in securely.
            </Show>
          </p>
        </div>
      </div>
    </Modal>
  );
};
