// persistent toast notice management
//
// tracks which notices have been dismissed in IndexedDB so they don't
// show again for the same app version. when the app version changes,
// notices can be shown again.

import { Toast as KobalteToast, toaster } from "@kobalte/core/toast";
import { appState, updateAppState } from "./storage/db";
import { VERSION } from "../../version";
import { isTauriMode } from "./tauri/mode";
import { checkConfigNeedsUpgrade, openSetupWizard } from "./tauri/commands";
import { solidColors } from "../../design-system/colors";
import { Icon } from "../../components/icons/registry";

// track currently showing toast IDs to prevent duplicates
const activeToasts = new Set<string>();

/**
 * build a notice key that includes the app version.
 * notices are dismissed per-version, so upgrading the app will show them again.
 */
function noticeKey(noticeId: string): string {
  return `${noticeId}:${VERSION}`;
}

/**
 * check if a notice should be shown.
 * returns false if already dismissed for this version.
 */
export function shouldShowNotice(noticeId: string): boolean {
  const state = appState();
  if (!state) return true; // show if state not loaded yet

  const key = noticeKey(noticeId);
  return !(state.dismissed_notices?.[key] === true);
}

/**
 * check if a notice toast is currently showing (to prevent duplicates).
 */
export function isNoticeShowing(noticeId: string): boolean {
  return activeToasts.has(noticeId);
}

/**
 * mark a notice as currently active (showing).
 */
export function markNoticeShowing(noticeId: string): void {
  activeToasts.add(noticeId);
}

/**
 * mark a notice as no longer showing.
 */
export function markNoticeHidden(noticeId: string): void {
  activeToasts.delete(noticeId);
}

/**
 * dismiss a notice so it won't show again for this version.
 * persists to IndexedDB.
 */
export async function dismissNotice(noticeId: string): Promise<void> {
  markNoticeHidden(noticeId);

  const state = appState();
  const currentDismissed = state?.dismissed_notices ?? {};
  const key = noticeKey(noticeId);

  await updateAppState({
    dismissed_notices: {
      ...currentDismissed,
      [key]: true,
    },
  });
}

// ============================================================================
// well-known notice IDs
// ============================================================================

export const NOTICE_CONFIG_UPGRADE = "config-upgrade";

// ============================================================================
// config upgrade toast
// ============================================================================

/**
 * check if config needs upgrading and show toast if needed.
 * only works in tauri mode.
 */
export async function checkAndShowConfigUpgradeToast(): Promise<void> {
  // only check in tauri mode
  if (!isTauriMode()) return;

  // already showing?
  if (isNoticeShowing(NOTICE_CONFIG_UPGRADE)) return;

  // already dismissed for this version?
  if (!shouldShowNotice(NOTICE_CONFIG_UPGRADE)) return;

  try {
    const status = await checkConfigNeedsUpgrade();
    if (!status?.needs_upgrade) return;

    // show the toast
    markNoticeShowing(NOTICE_CONFIG_UPGRADE);

    toaster.show((props) => (
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
            <div class="font-semibold text-sm mb-1">config upgrade available</div>
            <div class="text-sm mb-3">
              {status.config_version} → {status.binary_version}
            </div>
            <div class="flex gap-2">
              <button
                class="px-3 py-1 text-xs font-medium rounded bg-[var(--color-bg-secondary)] text-white hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
                onClick={async () => {
                  toaster.dismiss(props.toastId);
                  markNoticeHidden(NOTICE_CONFIG_UPGRADE);
                  await openSetupWizard("/settings");
                }}
              >
                open settings
              </button>
              <button
                class="px-3 py-1 text-xs font-medium rounded hover:bg-black/20 cursor-pointer opacity-70"
                onClick={async () => {
                  toaster.dismiss(props.toastId);
                  await dismissNotice(NOTICE_CONFIG_UPGRADE);
                }}
              >
                dismiss
              </button>
            </div>
          </div>

          {/* close button */}
          <KobalteToast.CloseButton
            class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer"
            onClick={() => markNoticeHidden(NOTICE_CONFIG_UPGRADE)}
          >
            <Icon name="close" size={16} color={solidColors.warning.text} />
          </KobalteToast.CloseButton>
        </div>
      </KobalteToast>
    ));
  } catch (error) {
    console.error("[toastNotices] failed to check config upgrade:", error);
  }
}
