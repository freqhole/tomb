import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import { For, JSX, Show, splitProps } from "solid-js";
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
  /** trigger element - the element that will show the menu on right-click */
  children: JSX.Element;
  /** menu actions to display */
  actions: MenuAction[];
  /** additional content to show at the top of the menu */
  header?: JSX.Element;
}

// context menu component using kobalte primitives
// automatically handles right-click, positioning, and viewport constraints
export function ContextMenu(props: ContextMenuProps) {
  const [local, rest] = splitProps(props, ["children", "actions", "header"]);

  return (
    <KobalteContextMenu {...rest}>
      <KobalteContextMenu.Trigger class="outline-none">
        {local.children}
      </KobalteContextMenu.Trigger>

      <KobalteContextMenu.Portal>
        <KobalteContextMenu.Content
          class="
            min-w-48
            bg-[var(--color-bg-elevated)]
            border border-[var(--color-border-default)]
            rounded-lg
            shadow-2xl
            overflow-hidden
            animate-[fade-in_0.15s_ease-out]
            z-50
            origin-top-left
            data-[expanded]:animate-[fade-in_0.15s_ease-out]
          "
        >
          <Show when={local.header}>
            <div class="p-2 border-b border-[var(--color-border-default)]">
              {local.header}
            </div>
          </Show>

          <div class="py-1">
            <For each={local.actions}>
              {(action) => {
                if (!isActionItem(action)) {
                  return (
                    <KobalteContextMenu.Separator class="my-1 h-px bg-[var(--color-border-subtle)]" />
                  );
                }

                return (
                  <KobalteContextMenu.Item
                    class={`
                      w-full px-4 py-2 text-left flex items-center gap-3
                      transition-colors body-small outline-none cursor-pointer
                      ${
                        action.disabled
                          ? "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50"
                          : action.destructive
                            ? "text-[var(--color-error)] data-[highlighted]:bg-[var(--color-error)] data-[highlighted]:bg-opacity-10"
                            : "text-[var(--color-text-primary)] data-[highlighted]:bg-[var(--color-bg-hover)]"
                      }
                    `}
                    onSelect={() => !action.disabled && action.onClick()}
                    disabled={action.disabled}
                    closeOnSelect={true}
                  >
                    <Show when={action.icon}>
                      <Icon
                        name={action.icon!}
                        size={16}
                        color="currentColor"
                      />
                    </Show>
                    <span>{action.label}</span>
                  </KobalteContextMenu.Item>
                );
              }}
            </For>
          </div>
        </KobalteContextMenu.Content>
      </KobalteContextMenu.Portal>
    </KobalteContextMenu>
  );
}

// dropdown menu component (same as context menu but triggered by click instead of right-click)
export interface DropdownMenuProps {
  /** trigger element - the button/element that opens the menu */
  trigger: JSX.Element;
  /** menu actions to display */
  actions: MenuAction[];
  /** additional content to show at the top of the menu */
  header?: JSX.Element;
}

export function DropdownMenu(props: DropdownMenuProps) {
  const [local, rest] = splitProps(props, ["trigger", "actions", "header"]);

  return (
    <KobalteContextMenu {...rest}>
      <KobalteContextMenu.Trigger class="outline-none">
        {local.trigger}
      </KobalteContextMenu.Trigger>

      <KobalteContextMenu.Portal>
        <KobalteContextMenu.Content
          class="
            min-w-48
            bg-[var(--color-bg-elevated)]
            border border-[var(--color-border-default)]
            rounded-lg
            shadow-2xl
            overflow-hidden
            animate-[fade-in_0.15s_ease-out]
            z-50
            origin-top-left
            data-[expanded]:animate-[fade-in_0.15s_ease-out]
          "
        >
          <Show when={local.header}>
            <div class="p-2 border-b border-[var(--color-border-default)]">
              {local.header}
            </div>
          </Show>

          <div class="py-1">
            <For each={local.actions}>
              {(action) => {
                if (!isActionItem(action)) {
                  return (
                    <KobalteContextMenu.Separator class="my-1 h-px bg-[var(--color-border-subtle)]" />
                  );
                }

                return (
                  <KobalteContextMenu.Item
                    class={`
                      w-full px-4 py-2 text-left flex items-center gap-3
                      transition-colors body-small outline-none cursor-pointer
                      ${
                        action.disabled
                          ? "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50"
                          : action.destructive
                            ? "text-[var(--color-error)] data-[highlighted]:bg-[var(--color-error)] data-[highlighted]:bg-opacity-10"
                            : "text-[var(--color-text-primary)] data-[highlighted]:bg-[var(--color-bg-hover)]"
                      }
                    `}
                    onSelect={() => !action.disabled && action.onClick()}
                    disabled={action.disabled}
                    closeOnSelect={true}
                  >
                    <Show when={action.icon}>
                      <Icon
                        name={action.icon!}
                        size={16}
                        color="currentColor"
                      />
                    </Show>
                    <span>{action.label}</span>
                  </KobalteContextMenu.Item>
                );
              }}
            </For>
          </div>
        </KobalteContextMenu.Content>
      </KobalteContextMenu.Portal>
    </KobalteContextMenu>
  );
}
