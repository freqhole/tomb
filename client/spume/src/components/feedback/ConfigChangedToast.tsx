// toast notification shown when tauri config changes and requires reload
// displays a persistent info toast with a "reload" button

import { Toast as KobalteToast } from "@kobalte/core/toast";
import { solidColors } from "../../design-system/colors";
import { Icon } from "../icons/registry";

interface ConfigChangedToastProps {
  toastId: number;
  message: () => string; // signal accessor for reactive updates
  onReload: () => void;
}

// persistent toast shown when config changes and requires a page reload
export function ConfigChangedToast(props: ConfigChangedToastProps) {
  return (
    <KobalteToast toastId={props.toastId} persistent={true} class="toast pointer-events-auto">
      <div
        class="flex items-start gap-3 p-4 rounded-lg shadow-lg border min-w-[320px] max-w-[420px]"
        style={{
          "background-color": solidColors.info.bg,
          "border-color": solidColors.info.border,
          color: solidColors.info.text,
        }}
      >
        {/* icon */}
        <div class="flex-shrink-0 pt-0.5">
          <Icon name="info" size={20} color={solidColors.info.text} />
        </div>

        {/* content */}
        <div class="flex-1 min-w-0">
          <KobalteToast.Title class="font-semibold text-sm mb-1">config updated</KobalteToast.Title>
          <KobalteToast.Description class="text-sm mb-3">
            {props.message()}
          </KobalteToast.Description>

          {/* reload button */}
          <button
            class="px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-opacity hover:opacity-80"
            style={{
              "background-color": solidColors.info.text,
              color: solidColors.info.bg,
            }}
            onClick={(e) => {
              e.stopPropagation();
              props.onReload();
            }}
          >
            reload
          </button>
        </div>

        {/* close button */}
        <KobalteToast.CloseButton class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer">
          <Icon name="close" size={16} color={solidColors.info.text} />
        </KobalteToast.CloseButton>
      </div>
    </KobalteToast>
  );
}
