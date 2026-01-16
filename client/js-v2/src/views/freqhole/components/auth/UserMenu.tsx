import { createSignal, Show } from "solid-js";
import { useAuth } from "../../../../hooks/auth";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { Popover } from "../ui/Modal";
import { UserIcon, LogoutIcon, MusicIcon, GridIcon } from "../icons";
import { useNavigate } from "@solidjs/router";

export interface UserMenuProps {
  onLogout?: () => void;
}

export const UserMenu = (props: UserMenuProps) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const auth = useAuth();
  const events = useGlobalEvents();
  const navigate = useNavigate();

  const isAdmin = () => auth.role === "admin";

  const handleLogout = async () => {
    await auth.logout();
    setIsOpen(false);
    props.onLogout?.();
    // Reload page after logout
    window.location.reload();
  };

  const [buttonRef, setButtonRef] = createSignal<HTMLButtonElement>();

  return (
    <Show when={auth.isAuthenticated}>
      <div class="relative">
        <button
          ref={setButtonRef}
          onClick={() => setIsOpen(!isOpen())}
          class="p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-magenta-600/20 relative"
          title={`signed in as ${auth.currentUser || "user"}${isAdmin() ? " (admin)" : ""}`}
        >
          <UserIcon size={20} />
        </button>

        <Popover
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          anchorElement={buttonRef()}
          placement="bottom"
        >
          <div class="w-64 bg-transparent border border-gray-700 rounded-lg shadow-xl overflow-hidden">
            {/* User Info Header */}
            <div class="px-4 py-3 border-b border-gray-700 bg-gray-800/50">
              <div class="flex items-center gap-3">
                <div
                  class={`w-8 h-8 ${isAdmin() ? "bg-magenta-600" : "bg-fuchsia-600"} rounded-lg flex items-center justify-center text-white`}
                >
                  <UserIcon size={16} />
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-white font-medium truncate">
                    {auth.currentUser || "user"}
                  </p>
                  <p
                    class={`text-xs ${isAdmin() ? "text-magenta-400" : "text-gray-400"}`}
                  >
                    {isAdmin() ? "administrator" : "authenticated"}
                  </p>
                </div>
              </div>
            </div>

            {/* Menu Actions */}
            <div class="py-2">
              <Show when={isAdmin()}>
                <button
                  onClick={() => {
                    events.emit("modal:open", {
                      modal: "addMusicModal",
                      data: {},
                    });
                    setIsOpen(false);
                  }}
                  class="w-full px-4 py-2 text-left text-gray-300 hover:text-white hover:bg-gray-800 transition-colors duration-200 flex items-center gap-3"
                >
                  <MusicIcon size={16} />
                  <span class="text-sm">add music</span>
                </button>
                <button
                  onClick={() => {
                    navigate("/admin/analytics");
                    setIsOpen(false);
                  }}
                  class="w-full px-4 py-2 text-left text-gray-300 hover:text-white hover:bg-gray-800 transition-colors duration-200 flex items-center gap-3"
                >
                  <GridIcon size={16} />
                  <span class="text-sm">ANAL! y? tics.</span>
                </button>
              </Show>
              <button
                onClick={handleLogout}
                disabled={auth.isLoading}
                class="w-full px-4 py-2 text-left text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-3"
              >
                <Show when={auth.isLoading} fallback={<LogoutIcon size={16} />}>
                  <div class="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                </Show>
                <span class="text-sm">
                  {auth.isLoading ? "signing out..." : "sign out"}
                </span>
              </button>
            </div>
          </div>
        </Popover>
      </div>
    </Show>
  );
};
