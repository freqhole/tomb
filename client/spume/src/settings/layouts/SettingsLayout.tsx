// settings layout - wrapper for all settings pages with navigation
import { JSX, For, onMount } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { routes } from "../../music/utils/routing";
import { isCharnelMode, setWindowTitle } from "../../app/services/charnel";

interface SettingsNavItem {
  path: string;
  label: string;
  icon: string;
}

// note: charnel-only items are filtered at render time below.
const navItems: SettingsNavItem[] = [
  { path: "/settings/storage", label: "storage", icon: "" },
  { path: "/settings/remotes", label: "remotes", icon: "" },
  { path: "/settings/federation", label: "federation", icon: "" },
  // charnel-only — radio station admin needs a local broadcaster.
  { path: "/settings/radio", label: "radio", icon: "" },
  // future items:
  // { path: "/settings/playback", label: "playback", icon: "" },
  // { path: "/settings/appearance", label: "appearance", icon: "" },
];

const CHARNEL_ONLY_PATHS = new Set(["/settings/radio"]);

export function SettingsLayout(props: { children: JSX.Element }) {
  const location = useLocation();

  // filter out charnel-only items when running in the web bundle.
  const visibleNavItems = () =>
    navItems.filter((item) => isCharnelMode() || !CHARNEL_ONLY_PATHS.has(item.path));

  // set window/document title for settings
  onMount(() => {
    const title = "freqhole ▸ settings";

    document.title = title;
    if (isCharnelMode()) {
      setWindowTitle(title);
    }
  });

  return (
    <div
      data-allow-select
      class="min-h-screen bg-[var(--color-bg-primary)]"
      style={{ "padding-top": "env(safe-area-inset-top, 0px)" }}
    >
      {/* mobile header */}
      <div class="lg:hidden border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
        <div class="p-4">
          <A
            href={routes.songs()}
            class="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            ← back
          </A>
        </div>
        <nav class="flex overflow-x-auto px-4 pb-2 gap-2">
          <For each={visibleNavItems()}>
            {(item) => (
              <A
                href={item.path}
                class={`flex-shrink-0 px-3 py-2 text-sm rounded-lg whitespace-nowrap transition-colors ${
                  location.pathname === item.path
                    ? "bg-[var(--color-accent-500)] text-black font-medium"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
                }`}
              >
                <span class="mr-1.5">{item.icon}</span>
                {item.label}
              </A>
            )}
          </For>
        </nav>
      </div>

      <div class="lg:flex">
        {/* desktop sidebar */}
        <aside class="hidden lg:block w-64 min-h-screen border-r border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
          <div class="p-4 border-b border-[var(--color-border-subtle)]">
            <A
              href={routes.songs()}
              class="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              ← back to library
            </A>
          </div>
          <div class="p-4">
            <h2 class="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-3 tracking-wider">
              settings
            </h2>
            <nav class="space-y-1">
              <For each={visibleNavItems()}>
                {(item) => (
                  <A
                    href={item.path}
                    class={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                      location.pathname === item.path
                        ? "bg-[var(--color-accent-500)] text-black font-medium"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
                    }`}
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </A>
                )}
              </For>
            </nav>
          </div>
        </aside>

        {/* main content */}
        <main class="flex-1 min-w-0">{props.children}</main>
      </div>
    </div>
  );
}
