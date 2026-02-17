// toast notification shown when a remote session has expired
// displays a persistent warning with a "sign in" button to trigger re-auth

import { Toast as KobalteToast } from "@kobalte/core/toast";
import { solidColors } from "../../design-system/colors";
import { Icon } from "../icons/registry";

interface AuthExpiredToastProps {
  toastId: number;
  remoteName: string;
  onSignIn: () => void;
}

// persistent toast shown when a remote's session cookie has expired
export function AuthExpiredToast(props: AuthExpiredToastProps) {
  return (
    <KobalteToast toastId={props.toastId} persistent={true} class="toast pointer-events-auto">
      <div
        class="flex items-start gap-3 p-4 rounded-lg shadow-lg border min-w-[320px] max-w-[420px]"
        style={{
          "background-color": solidColors.warning.bg,
          "border-color": solidColors.warning.border,
          color: solidColors.warning.text,
        }}
      >
        {/* icon */}
        <div class="flex-shrink-0 pt-0.5">
          <Icon name="alertTriangle" size={20} color={solidColors.warning.text} />
        </div>

        {/* content */}
        <div class="flex-1 min-w-0">
          <KobalteToast.Title class="font-semibold text-sm mb-1">
            session expired
          </KobalteToast.Title>
          <KobalteToast.Description class="text-sm mb-3">
            your session on <strong>{props.remoteName}</strong> has expired.
          </KobalteToast.Description>

          {/* sign in button */}
          <button
            class="px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-opacity hover:opacity-80"
            style={{
              "background-color": solidColors.warning.text,
              color: solidColors.warning.bg,
            }}
            onClick={(e) => {
              e.stopPropagation();
              props.onSignIn();
            }}
          >
            sign in
          </button>
        </div>

        {/* close button */}
        <KobalteToast.CloseButton class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer">
          <Icon name="close" size={16} color={solidColors.warning.text} />
        </KobalteToast.CloseButton>
      </div>
    </KobalteToast>
  );
}
