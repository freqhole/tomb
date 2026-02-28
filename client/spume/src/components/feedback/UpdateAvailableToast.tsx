// toast notification shown when a new app version is available
// displays a persistent info toast with "upgrade" and "not now" buttons

import { Toast as KobalteToast } from "@kobalte/core/toast";
import { solidColors } from "../../design-system/colors";
import { Icon } from "../icons/registry";

interface UpdateAvailableToastProps {
  toastId: number;
  onUpgrade: () => void;
  onDismiss: () => void;
}

// persistent toast shown when a service worker update is ready
export function UpdateAvailableToast(props: UpdateAvailableToastProps) {
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
          <Icon name="arrowUp" size={20} color={solidColors.info.text} />
        </div>

        {/* content */}
        <div class="flex-1 min-w-0">
          <KobalteToast.Title class="font-semibold text-sm mb-1">
            update available
          </KobalteToast.Title>
          <KobalteToast.Description class="text-sm mb-3">
            a new version of freqhole is ready to install
          </KobalteToast.Description>

          {/* action buttons */}
          <div class="flex gap-2">
            <button
              class="px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-opacity hover:opacity-80"
              style={{
                "background-color": solidColors.info.text,
                color: solidColors.info.bg,
              }}
              onClick={(e) => {
                e.stopPropagation();
                props.onUpgrade();
              }}
            >
              upgrade
            </button>
            <button
              class="px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-opacity hover:opacity-80 border"
              style={{
                "background-color": "transparent",
                "border-color": solidColors.info.text,
                color: solidColors.info.text,
              }}
              onClick={(e) => {
                e.stopPropagation();
                props.onDismiss();
              }}
            >
              not now
            </button>
          </div>
        </div>

        {/* close button */}
        <KobalteToast.CloseButton class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer">
          <Icon name="close" size={16} color={solidColors.info.text} />
        </KobalteToast.CloseButton>
      </div>
    </KobalteToast>
  );
}
