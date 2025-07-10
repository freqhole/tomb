/* @jsxImportSource solid-js */
import { createSignal, Show } from "solid-js";
import { useAuth } from "../../../../hooks/auth";
import { Popover } from "../ui/Modal";

export interface UserMenuProps {
  onLogout?: () => void;
}

export const UserMenu = (props: UserMenuProps) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const auth = useAuth({
    onLogout: () => {
      setIsOpen(false);
      props.onLogout?.();
    },
  });

  const handleLogout = async () => {
    await auth.logout();
  };

  const UserIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );

  const LogoutIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
    </svg>
  );

  return (
    <Show when={auth.isAuthenticated}>
      <div class="relative">
        <button
          onClick={() => setIsOpen(!isOpen())}
          class="w-8 h-8 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg flex items-center justify-center transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:ring-offset-2 focus:ring-offset-black"
          title={`Signed in as ${auth.currentUser || "User"}`}
        >
          <UserIcon />
        </button>

        <Popover
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          placement="bottom"
        >
          <div class="w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
            {/* User Info Header */}
            <div class="px-4 py-3 border-b border-gray-700 bg-gray-800/50">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-fuchsia-600 rounded-lg flex items-center justify-center text-white">
                  <UserIcon />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-white font-medium truncate">
                    {auth.currentUser || "User"}
                  </p>
                  <p class="text-gray-400 text-xs">Authenticated</p>
                </div>
              </div>
            </div>

            {/* Menu Actions */}
            <div class="py-2">
              <button
                onClick={handleLogout}
                disabled={auth.isLoading}
                class="w-full px-4 py-2 text-left text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-3"
              >
                <Show when={auth.isLoading} fallback={<LogoutIcon />}>
                  <div class="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                </Show>
                <span class="text-sm">
                  {auth.isLoading ? "Signing out..." : "Sign Out"}
                </span>
              </button>
            </div>

            {/* Footer Info */}
            <div class="px-4 py-2 border-t border-gray-700 bg-gray-800/30">
              <p class="text-xs text-gray-500">
                WebAuthn authenticated session
              </p>
            </div>
          </div>
        </Popover>
      </div>
    </Show>
  );
};
