import { createSignal, Show } from "solid-js";
import { useAuth } from "../../../../hooks/auth";
import { Popover } from "../ui/Modal";
import { UserIcon, LogoutIcon } from "../icons";

export interface UserMenuProps {
  onLogout?: () => void;
}

export const UserMenu = (props: UserMenuProps) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const auth = useAuth();

  // Debug: Log what UserMenu sees
  console.log("UserMenu auth state:", {
    isAuthenticated: auth.isAuthenticated,
    currentUser: auth.currentUser,
    isLoading: auth.isLoading,
    error: auth.error,
  });

  const handleLogout = async () => {
    await auth.logout();
    setIsOpen(false);
    props.onLogout?.();
  };

  const [buttonRef, setButtonRef] = createSignal<HTMLButtonElement>();

  return (
    <Show when={auth.isAuthenticated}>
      <div class="relative">
        <button
          ref={setButtonRef}
          onClick={() => setIsOpen(!isOpen())}
          class="w-8 h-8 bg-fuchsia-600 hover:bg-fuchsia-700 text-white rounded-lg flex items-center justify-center transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500 focus:ring-offset-2 focus:ring-offset-black"
          title={`Signed in as ${auth.currentUser || "User"}`}
        >
          <UserIcon />
        </button>

        <Popover
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          anchorElement={buttonRef()}
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
          </div>
        </Popover>
      </div>
    </Show>
  );
};
