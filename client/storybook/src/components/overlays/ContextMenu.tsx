import {
  createEffect,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Icon, type IconName } from "../icons/registry";

export type MenuAction =
  | {
      type: "separator";
    }
  | {
      label: string;
      icon?: IconName;
      onClick: () => void;
      disabled?: boolean;
      destructive?: boolean;
      type?: never;
    };

// type guard to check if action is not a separator
function isActionItem(
  action: MenuAction,
): action is Exclude<MenuAction, { type: "separator" }> {
  return action.type !== "separator";
}

export interface ContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  onClose: () => void;
  actions: MenuAction[];
  children?: JSX.Element;
}

// context menu with right-click and mobile long-press support
// automatically constrains to viewport bounds
export function ContextMenu(props: ContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ x: props.x, y: props.y });

  // calculate constrained position to keep menu in viewport
  const calculateConstrainedPosition = () => {
    if (!menuRef) return { x: props.x, y: props.y };

    const rect = menuRef.getBoundingClientRect();

    // if menu hasn't been measured yet, return original position
    if (rect.width === 0 || rect.height === 0) {
      return { x: props.x, y: props.y };
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = props.x;
    let y = props.y;

    // constrain to viewport with 10px padding
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

  // update position when props change
  createEffect(() => {
    if (props.isOpen) {
      setPosition({ x: props.x, y: props.y });

      // force position update after next render
      requestAnimationFrame(() => {
        const constrainedPos = calculateConstrainedPosition();
        setPosition(constrainedPos);
      });
    }
  });

  // handle click outside to close
  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  // handle escape key to close
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  onMount(() => {
    if (props.isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    });
  });

  // watch for isOpen changes to add/remove listeners
  createEffect(() => {
    if (props.isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    }
  });

  const handleAction = (action: MenuAction) => {
    if (!isActionItem(action)) return;
    if (!action.disabled) {
      action.onClick();
      props.onClose();
    }
  };

  return (
    <Show when={props.isOpen}>
      {/* backdrop */}
      <div
        class="fixed inset-0 z-40"
        onClick={props.onClose}
        style={{ "background-color": "transparent" }}
      />

      {/* menu */}
      <div
        ref={menuRef}
        class="fixed z-50 min-w-48 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl animate-[fade-in_0.15s_ease-out] overflow-hidden"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
        }}
      >
        {/* custom content (like text input for playlist naming) */}
        <Show when={!!props.children}>
          <div class="p-2 border-b border-[var(--color-border-default)]">
            {props.children}
          </div>
        </Show>

        {/* menu actions */}
        <div class="py-1">
          <For each={props.actions}>
            {(action) => {
              if (!isActionItem(action)) {
                return (
                  <div class="border-t border-[var(--color-border-subtle)] my-1" />
                );
              }

              return (
                <button
                  type="button"
                  class={`
                    w-full px-4 py-2 text-left flex items-center gap-3
                    transition-colors body-small
                    ${
                      action.disabled
                        ? "text-[var(--color-text-disabled)] cursor-not-allowed"
                        : action.destructive
                          ? "text-[var(--color-error)] hover:bg-[var(--color-error)] hover:bg-opacity-10"
                          : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                    }
                  `}
                  onClick={() => handleAction(action)}
                  disabled={action.disabled}
                >
                  <Show when={action.icon}>
                    <Icon name={action.icon!} size={16} color="currentColor" />
                  </Show>
                  <span>{action.label}</span>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </Show>
  );
}

// hook for managing context menu state
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

  // handle right-click context menu
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    open(event.clientX, event.clientY);
  };

  // handle button click to open menu (like a dropdown)
  const handleButtonClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    // position menu at bottom-left of button
    const x = rect.left;
    const y = rect.bottom + 4;

    open(x, y);
  };

  // handle mobile long-press
  const handleLongPress = (event: TouchEvent) => {
    event.preventDefault();
    const touch = event.touches[0];
    if (touch) {
      open(touch.clientX, touch.clientY);
    }
  };

  return {
    isOpen,
    position,
    open,
    close,
    handleContextMenu,
    handleButtonClick,
    handleLongPress,
  };
}

// helper hook for long-press detection on mobile
export function useLongPress(
  onLongPress: (event: TouchEvent) => void,
  threshold = 500,
) {
  let timeout: number | undefined;
  let touchStartPos = { x: 0, y: 0 };

  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    touchStartPos = { x: touch.clientX, y: touch.clientY };

    timeout = window.setTimeout(() => {
      onLongPress(event);
    }, threshold);
  };

  const handleTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartPos.x);
    const deltaY = Math.abs(touch.clientY - touchStartPos.y);

    // cancel long press if finger moves too much
    if (deltaX > 10 || deltaY > 10) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
    }
  };

  const handleTouchEnd = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };

  onCleanup(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  };
}
