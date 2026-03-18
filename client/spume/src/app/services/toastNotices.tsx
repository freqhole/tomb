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
export const NOTICE_KNOCK_REQUESTS = "knock-requests";

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

// ============================================================================
// knock requests toast
// ============================================================================

// track last known knock count to detect changes
let lastKnockCount = 0;
// track current toast ID for updating
let knockToastId: number | null = null;

/**
 * show a persistent toast for pending knock requests.
 * call this when new knocks are received or on initial check.
 *
 * @param count number of pending knock requests
 * @param onViewKnocks callback to view/manage knock requests
 */
export function showKnockRequestsToast(count: number, onViewKnocks: () => void): void {
  // no knocks - dismiss any existing toast
  if (count === 0) {
    if (knockToastId !== null) {
      toaster.dismiss(knockToastId);
      knockToastId = null;
    }
    markNoticeHidden(NOTICE_KNOCK_REQUESTS);
    lastKnockCount = 0;
    return;
  }

  // already showing same count
  if (isNoticeShowing(NOTICE_KNOCK_REQUESTS) && count === lastKnockCount) {
    return;
  }

  // dismiss old toast if count changed
  if (knockToastId !== null && count !== lastKnockCount) {
    toaster.dismiss(knockToastId);
    knockToastId = null;
    markNoticeHidden(NOTICE_KNOCK_REQUESTS);
  }

  lastKnockCount = count;
  markNoticeShowing(NOTICE_KNOCK_REQUESTS);

  knockToastId = toaster.show((props) => (
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
          <Icon name="user" size={20} color={solidColors.info.text} />
        </div>

        {/* content */}
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-sm mb-1">
            {count === 1 ? "access request" : `${count} access requests`}
          </div>
          <div class="text-sm mb-3 opacity-80">
            {count === 1
              ? "someone wants to access your library"
              : `${count} people want to access your library`}
          </div>
          <div class="flex gap-2">
            <button
              class="px-3 py-1 text-xs font-medium rounded bg-[var(--color-bg-secondary)] text-white hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
              onClick={() => {
                onViewKnocks();
              }}
            >
              view requests
            </button>
          </div>
        </div>

        {/* close button */}
        <KobalteToast.CloseButton
          class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer"
          onClick={() => {
            markNoticeHidden(NOTICE_KNOCK_REQUESTS);
            knockToastId = null;
          }}
        >
          <Icon name="close" size={16} color={solidColors.info.text} />
        </KobalteToast.CloseButton>
      </div>
    </KobalteToast>
  ));
}

/**
 * dismiss the knock requests toast programmatically.
 * call this when navigating to the knock management page.
 */
export function dismissKnockRequestsToast(): void {
  if (knockToastId !== null) {
    toaster.dismiss(knockToastId);
    knockToastId = null;
  }
  markNoticeHidden(NOTICE_KNOCK_REQUESTS);
}

// ============================================================================
// knock requests check (tauri only)
// ============================================================================

// response shape from api_call for knock list
interface KnockApiResponse {
  success: boolean;
  message: string;
  data?: Array<{
    id: string;
    node_id: string;
    username: string;
    message: string;
    status: string;
    created_at: number;
    processed_at: number | null;
    processed_by: string | null;
  }>;
}

/**
 * check for pending knock requests and show toast if any exist.
 * only works in Tauri mode (calls the local API via IPC).
 * call this on app startup to notify admin of pending access requests.
 */
export async function checkPendingKnocks(): Promise<void> {
  if (!isTauriMode()) {
    return;
  }

  try {
    // dynamically import tauri invoke
    const { invoke } = await import("@tauri-apps/api/core");

    // call /api/admin/knocks via local dispatch (pending only by default)
    const response = (await invoke("api_call", {
      path: "/api/admin/knocks",
      body: {},
    })) as KnockApiResponse;

    if (!response.success || !response.data) {
      return;
    }

    // filter to pending only (status === "pending")
    const pendingKnocks = response.data.filter((k) => k.status === "pending");
    const count = pendingKnocks.length;

    if (count > 0) {
      console.log(`[toastNotices] found ${count} pending knock request(s)`);
      showKnockRequestsToast(count, () => {
        // open wizard federation view
        void openSetupWizard("/federation");
        dismissKnockRequestsToast();
      });
    }
  } catch (error) {
    // silently fail - not critical, may not be admin or server not ready
    console.debug("[toastNotices] failed to check pending knocks:", error);
  }
}
