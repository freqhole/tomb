import { For } from "solid-js";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";

interface NavigationSectionsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export function NavigationSections(props: NavigationSectionsProps) {
  const events = useGlobalEvents();

  const navItems = [
    { path: "/songs", label: "songs" },
    { path: "/artists", label: "artists" },
    { path: "/albums", label: "albums" },
    { path: "/genres", label: "genres" },
  ];

  const handleNavClick = (path: string, label: string) => {
    props.onNavigate(path);
    events.emit("nav:change", { view: label });
  };

  return (
    <div class="p-4 space-y-2">
      <For each={navItems}>
        {(item) => (
          <button
            class={`w-full text-left p-2 rounded-lg text-sm transition-all duration-200 ${
              props.currentPath === item.path ||
              (props.currentPath === "/" && item.path === "/genres")
                ? "bg-magenta-600/30 text-white"
                : "text-white hover:bg-magenta-600/20"
            }`}
            onClick={() => handleNavClick(item.path, item.label)}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
}
