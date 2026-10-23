// overflow ("...") action menu - a small icon-button trigger that opens a
// dropdown of less-common actions, for a compact action bar that doesn't
// have room to show every action as its own full-size button (narrow/
// mobile layouts especially). shares `MenuAction[]` with ContextMenu.tsx,
// so an existing right-click context-menu action list can be reused here
// verbatim. self-contained (manages its own open/close state) - mirrors
// TopNav.tsx's own `RowActionsMenu`, which is deliberately left as-is
// (externally-controlled open state, since TopNav coordinates many rows
// sharing one "only one menu open at a time" signal - overkill for this
// component's single-instance use).
import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { Icon } from "../icons/registry";
import { type MenuAction } from "./ContextMenu";

export interface OverflowMenuProps {
  actions: MenuAction[];
  /** aria-label/title for the trigger button (default: "more actions") */
  label?: string;
  /** icon size for the "..." trigger - bump for a larger tap target */
  iconSize?: number;
  /** extra classes merged onto the trigger button */
  triggerClass?: string;
  /** extra classes merged onto the wrapping element (position context for
   *  the dropdown's `absolute` positioning) */
  class?: string;
}

export function OverflowMenu(props: OverflowMenuProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  const close = () => setIsOpen(false);

  const handleDocClick = (e: MouseEvent) => {
    const target = e.target as Node;
    if (menuRef?.contains(target)) return;
    if (triggerRef?.contains(target)) return;
    close();
  };

  createEffect(() => {
    if (isOpen()) {
      document.addEventListener("mousedown", handleDocClick, true);
      onCleanup(() => document.removeEventListener("mousedown", handleDocClick, true));
    }
  });

  return (
    <div class={`relative ${props.class ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        class={
          props.triggerClass ??
          "p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
        }
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-label={props.label ?? "more actions"}
        title={props.label ?? "more actions"}
      >
        <Icon name="more" size={props.iconSize ?? 20} />
      </button>
      <Show when={isOpen()}>
        <div
          ref={menuRef}
          class="absolute right-0 top-full mt-1 z-[1300] min-w-[10rem] bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl overflow-hidden py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <For each={props.actions}>
            {(action) => {
              if (action.type === "separator") {
                return <div class="my-1 h-px bg-[var(--color-border-subtle)]" />;
              }
              return (
                <button
                  type="button"
                  class={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 border-none bg-transparent cursor-pointer transition-colors ${
                    action.disabled
                      ? "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50"
                      : action.destructive
                        ? "text-[var(--color-error)] hover:bg-[var(--color-error)] hover:text-white"
                        : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                  }`}
                  disabled={action.disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (action.disabled) return;
                    close();
                    action.onClick();
                  }}
                >
                  <Show when={action.icon}>
                    <Icon name={action.icon!} size={14} color="currentColor" />
                  </Show>
                  <span>{action.label}</span>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default OverflowMenu;
