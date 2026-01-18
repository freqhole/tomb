import type { JSX, ParentComponent } from "solid-js";
import { Show, splitProps } from "solid-js";
import {
  translucentColors,
  type TranslucentColorVariant,
} from "../../../design-system/colors";
import { Icon, type IconName } from "../icons/registry";

export interface AlertProps extends JSX.HTMLAttributes<HTMLDivElement> {
  variant?: TranslucentColorVariant;
  title?: string;
  icon?: IconName | boolean;
  onClose?: () => void;
  class?: string;
}

// alert component for inline messages and notifications
export const Alert: ParentComponent<AlertProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "variant",
    "title",
    "icon",
    "onClose",
    "class",
    "children",
  ]);

  const variant = () => local.variant || "info";

  const colors = () => translucentColors[variant()];

  const defaultIcon = (): IconName => {
    switch (variant()) {
      case "success":
        return "check";
      case "warning":
        return "alertTriangle";
      case "error":
        return "alertTriangle";
      case "info":
      default:
        return "info";
    }
  };

  const showIcon = () => {
    if (local.icon === false) return false;
    return true;
  };

  const iconName = (): IconName => {
    if (typeof local.icon === "string") {
      return local.icon;
    }
    return defaultIcon();
  };

  return (
    <div
      role="alert"
      class={`border rounded-lg p-4 ${local.class || ""}`}
      style={{
        "background-color": `color-mix(in srgb, ${colors().bg} ${parseFloat(colors().bgOpacity) * 100}%, transparent)`,
        color: colors().text,
        "border-color": colors().border,
      }}
      {...rest}
    >
      <div class="flex items-start gap-3">
        <Show when={showIcon()}>
          <div class="flex-shrink-0 mt-0.5">
            <Icon name={iconName()} size={20} color={colors().icon} />
          </div>
        </Show>

        <div class="flex-1 min-w-0">
          <Show when={local.title}>
            <div class="font-medium mb-1">{local.title}</div>
          </Show>
          <div class="text-sm opacity-90">{local.children}</div>
        </div>

        <Show when={local.onClose}>
          <button
            type="button"
            onClick={() => local.onClose?.()}
            class="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="close alert"
          >
            <Icon name="close" size={16} color={colors().icon} />
          </button>
        </Show>
      </div>
    </div>
  );
};
