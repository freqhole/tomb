import {
  JSX,
  Show,
  createSignal,
  onMount,
  onCleanup,
  createEffect,
} from "solid-js";
import { useGlobalOverlay } from "./useGlobalOverlay";

export interface MenuAction {
  label: string;
  icon?: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  type?: "separator";
}

export interface ContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  actions: MenuAction[];
  children?: JSX.Element;
}

export function ContextMenu(props: ContextMenuProps) {
  const [menuRef, setMenuRef] = createSignal<HTMLDivElement>();
  const [position, setPosition] = createSignal({ x: props.x, y: props.y });
  let resizeObserver: ResizeObserver | undefined;

  // Calculate constrained position
  const calculateConstrainedPosition = () => {
    const menu = menuRef();
    if (!menu) return { x: props.x, y: props.y };

    const rect = menu.getBoundingClientRect();

    // If menu hasn't been measured yet, return original position
    if (rect.width === 0 || rect.height === 0) {
      return { x: props.x, y: props.y };
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = props.x;
    let y = props.y;

    // Constrain to viewport with 10px padding
    if (x + rect.width > viewportWidth - 10) {
      x = viewportWidth - rect.width - 10;
    }
    if (x < 10) {
      x = 10;
    }
    if (y + rect.height > viewportHeight - 10) {
      y = viewportHeight - rect.height - 10;
    }
    if (y < 10) {
      y = 10;
    }

    return { x, y };
  };

  // Update position when props change
  const updatePosition = () => {
    setPosition({ x: props.x, y: props.y });

    // Force position update after next render
    requestAnimationFrame(() => {
      const constrainedPos = calculateConstrainedPosition();
      setPosition(constrainedPos);
    });
  };

  // Watch for prop changes
  onMount(() => {
    if (props.isOpen) {
      updatePosition();
    }
  });

  const overlay = useGlobalOverlay("context-menu");

  onMount(() => {
    if (props.isOpen && menuRef()) {
      // Activate this overlay in the global system
      overlay.activate(menuRef()!, props.onClose);
    } else if (!props.isOpen) {
      overlay.deactivate();
    }

    onCleanup(() => {
      overlay.deactivate();
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    });
  });

  // Set up ResizeObserver to recalculate position when menu size changes
  createEffect(() => {
    const menu = menuRef();
    if (menu && props.isOpen) {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          const constrainedPos = calculateConstrainedPosition();
          setPosition(constrainedPos);
        });
      });

      resizeObserver.observe(menu);
    } else if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = undefined;
    }
  });

  const handleAction = (action: MenuAction) => {
    if (!action.disabled) {
      action.onClick();

      // Don't auto-close for playlist actions - they handle their own menu transitions
      const isPlaylistAction = action.label?.includes("playlist");
      if (!isPlaylistAction) {
        props.onClose();
      }
    }
  };

  return (
    <Show when={props.isOpen}>
      {/* Backdrop */}
      <div class="fixed inset-0 z-40 bg-black/30" onClick={props.onClose} />

      {/* Menu */}
      <div
        ref={(el) => {
          setMenuRef(el);
          if (el && props.isOpen) {
            // Activate overlay and update position
            overlay.activate(el, props.onClose);
            requestAnimationFrame(() => {
              const constrainedPos = calculateConstrainedPosition();
              setPosition(constrainedPos);
            });
          }
        }}
        class="fixed z-50 min-w-48 bg-dark-200 border border-dark-300 shadow-xl metro-slide-up"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
        }}
      >
        {/* Custom content (like text input for playlist naming) */}
        <Show when={!!props.children}>
          <div class="p-2">
            {props.children}
            <div class="border-b border-dark-300 mt-2"></div>
          </div>
        </Show>

        {/* Menu actions */}
        <div class="py-1">
          {props.actions.map((action, _index) => (
            <Show
              when={action.type === "separator"}
              fallback={
                <button
                  class={`w-full px-4 py-3 text-left border border-transparent transition-all duration-200 flex items-center space-x-3 ${
                    action.disabled
                      ? "text-gray-500 cursor-not-allowed"
                      : action.destructive
                        ? "text-red-400 hover:bg-red-900 hover:border-red-600"
                        : "text-white hover:bg-primary-500 hover:border-primary-300 metro-button-hover"
                  }`}
                  onClick={() => handleAction(action)}
                  disabled={action.disabled}
                >
                  <Show when={action.icon}>
                    <span class="flex-shrink-0">{action.icon}</span>
                  </Show>
                  <span class="text-sm font-medium">{action.label}</span>
                </button>
              }
            >
              <div class="border-t border-dark-300 my-1"></div>
            </Show>
          ))}
        </div>
      </div>
    </Show>
  );
}

// Hook for managing context menu state
export function useContextMenu() {
  const [isOpen, setIsOpen] = createSignal(false);
  const [position, setPosition] = createSignal({ x: 0, y: 0 });

  const open = (x: number, y: number) => {
    setPosition({ x, y });
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
  };

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    open(event.clientX, event.clientY);
  };

  const handleButtonClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    // Position menu at bottom-left of button
    const x = rect.left;
    const y = rect.bottom + 4;

    open(x, y);
  };

  return {
    isOpen,
    position,
    open,
    close,
    handleContextMenu,
    handleButtonClick,
  };
}
