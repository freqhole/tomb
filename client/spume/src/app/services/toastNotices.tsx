// persistent toast notice management
//
// tracks which notices have been dismissed in IndexedDB so they don't
// show again for the same app version. when the app version changes,
// notices can be shown again.

import { Toast as KobalteToast, toaster } from "@kobalte/core/toast";
import { appState, updateAppState } from "./storage/db";
import { VERSION } from "../../version";
import { isCharnelMode } from "./charnel/mode";
import {
  checkConfigNeedsUpgrade,
  openSetupWizard,
  isFlatpak,
  checkDirWritable,
  getFetchMusicDir,
} from "./charnel/commands";
import { listMountedExternalStorageDevices } from "./charnel/externalStorage";
import { solidColors } from "../../design-system/colors";
import { Icon } from "../../components/icons/registry";
import { getRemoteById, getAllRemotes } from "./remotes/remoteManager";
import { whoamiForRemote } from "./remotes/authService";
import { adminClientFor } from "../api/adminClient";
import { getAuthInfo } from "./remotes/authStatusStore";

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
export const NOTICE_KNOCK_CREATED = "knock-created";
export const NOTICE_STORAGE_HEALTH = "storage-health";

// ============================================================================
// knock created toast (shows username + message with federation button)
// ============================================================================

/**
 * show a toast for a single knock request with username and message.
 * includes button to open federation view.
 * uses de-duplication to avoid multiple toasts stacking.
 *
 * @param username the username of the requester
 * @param message optional message from the requester
 */
export function showKnockCreatedToast(username: string, message?: string): void {
  // de-duplicate: if already showing a knock created toast, skip
  if (isNoticeShowing(NOTICE_KNOCK_CREATED)) {
    return;
  }

  markNoticeShowing(NOTICE_KNOCK_CREATED);

  const title = `federation request from ${username}`;
  const description = message || "someone is requesting access to your library";

  toaster.show((props) => (
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
          <div class="font-semibold text-sm mb-1">{title}</div>
          <div class="text-sm mb-3 opacity-80">{description}</div>
          <div class="flex gap-2">
            <button
              class="px-3 py-1 text-xs font-medium rounded bg-[var(--color-bg-secondary)] text-white hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
              onClick={() => {
                toaster.dismiss(props.toastId);
                markNoticeHidden(NOTICE_KNOCK_CREATED);
                // HashRouter — set hash to route in-app.
                window.location.hash = "/settings/admin-knocks";
              }}
            >
              view request
            </button>
          </div>
        </div>

        {/* close button */}
        <KobalteToast.CloseButton
          class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer"
          onClick={() => {
            markNoticeHidden(NOTICE_KNOCK_CREATED);
          }}
        >
          <Icon name="close" size={16} color={solidColors.info.text} />
        </KobalteToast.CloseButton>
      </div>
    </KobalteToast>
  ));
}

// ============================================================================
// config upgrade toast
// ============================================================================

/**
 * check if config needs upgrading and show toast if needed.
 * only works in tauri mode.
 */
export async function checkAndShowConfigUpgradeToast(): Promise<void> {
  // only check in tauri mode
  if (!isCharnelMode()) return;

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
                  await openSetupWizard("/config");
                }}
              >
                open config
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
// storage health toast (stale flatpak doc-portal write grants)
// ============================================================================

/**
 * check every boot (flatpak only) whether the configured fetch-music
 * directory and any mounted external-storage devices are still actually
 * writable, and show a toast prompting the user to reselect them if not.
 *
 * unlike the config-upgrade notice, this is deliberately NOT dismissed
 * "for this version" - a doc-portal grant can go stale at any time
 * (permission revoked, portal backend restart), not just across an
 * upgrade, so it's re-checked and re-shown every launch regardless of
 * whether a past instance of it was dismissed. `isNoticeShowing` still
 * guards against showing it twice in the same session.
 */
export async function checkAndShowStorageHealthToast(): Promise<void> {
  if (!isCharnelMode()) return;
  if (isNoticeShowing(NOTICE_STORAGE_HEALTH)) return;

  try {
    if (!(await isFlatpak())) return;

    const brokenPaths: string[] = [];

    const fetchMusicDir = await getFetchMusicDir();
    if (fetchMusicDir && !(await checkDirWritable(fetchMusicDir))) {
      brokenPaths.push("fetched music folder");
    }

    const devices = await listMountedExternalStorageDevices();
    for (const device of devices) {
      if (!device.path_writable) {
        brokenPaths.push(device.volume_name || device.path);
      }
    }

    if (brokenPaths.length === 0) return;

    markNoticeShowing(NOTICE_STORAGE_HEALTH);

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
            <div class="font-semibold text-sm mb-1">storage folder access needed</div>
            <div class="text-sm mb-3">
              can't write to: {brokenPaths.join(", ")}. reselect the folder in settings.
            </div>
            <div class="flex gap-2">
              <button
                class="px-3 py-1 text-xs font-medium rounded bg-[var(--color-bg-secondary)] text-white hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
                onClick={async () => {
                  toaster.dismiss(props.toastId);
                  markNoticeHidden(NOTICE_STORAGE_HEALTH);
                  await openSetupWizard("/settings");
                }}
              >
                open settings
              </button>
              <button
                class="px-3 py-1 text-xs font-medium rounded hover:bg-black/20 cursor-pointer opacity-70"
                onClick={() => {
                  toaster.dismiss(props.toastId);
                  markNoticeHidden(NOTICE_STORAGE_HEALTH);
                }}
              >
                dismiss
              </button>
            </div>
          </div>

          {/* close button */}
          <KobalteToast.CloseButton
            class="flex-shrink-0 hover:opacity-70 transition-opacity p-1 -mt-1 -mr-1 cursor-pointer"
            onClick={() => markNoticeHidden(NOTICE_STORAGE_HEALTH)}
          >
            <Icon name="close" size={16} color={solidColors.warning.text} />
          </KobalteToast.CloseButton>
        </div>
      </KobalteToast>
    ));
  } catch (error) {
    console.error("[toastNotices] failed to check storage health:", error);
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
// knock requests check (all admin remotes)
// ============================================================================

// response shape from api_call for knock list (tauri-local fallback path)
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

interface KnockRowLite {
  id: string;
  status: string;
}

async function countLocalCharnelPending(): Promise<number> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    const response = (await invoke("api_call", {
      path: "/api/admin/knocks",
      body: {},
    })) as KnockApiResponse;
    if (!response.success || !response.data) return 0;
    return response.data.filter((k) => k.status === "pending").length;
  } catch (e) {
    console.debug("[toastNotices] local knock check failed:", e);
    return 0;
  }
}

async function countPendingForRemote(remote: {
  remote_id: string;
  is_charnel_managed?: boolean;
}): Promise<number> {
  try {
    const r = await getRemoteById(remote.remote_id);
    if (!r || r.is_offline === true) return 0;

    // prefer cached role; fall back to whoami if not yet populated.
    let role = getAuthInfo(r.remote_id)?.role;
    if (!role) {
      const me = await whoamiForRemote(r);
      role = me.success ? me.role : undefined;
    }
    if (role !== "admin") return 0;

    const client = await adminClientFor(r);
    const rows = (await client.dispatchOrThrow("knocks_list", undefined)) as
      KnockRowLite[] | undefined;
    if (!Array.isArray(rows)) return 0;
    return rows.filter((k) => k.status === "pending").length;
  } catch (e) {
    console.debug(`[toastNotices] knock check failed for ${remote.remote_id}:`, e);
    return 0;
  }
}

/**
 * check for pending knock requests across every admin remote and show a
 * single aggregated toast if any exist. clicking through navigates to the
 * cross-remote `/settings/admin-knocks` view.
 *
 * runs the tauri-local check too (when in charnel mode) so the embedded
 * owner remote is covered without needing the p2p admin transport.
 */
export async function checkPendingKnocks(): Promise<void> {
  try {
    const tasks: Promise<number>[] = [];

    if (isCharnelMode()) {
      tasks.push(countLocalCharnelPending());
    }

    try {
      const all = await getAllRemotes();
      for (const r of all) {
        // charnel-managed entries are already covered by countLocalCharnelPending
        if (r.is_charnel_managed) continue;
        if (r.is_offline === true) continue;
        tasks.push(countPendingForRemote(r));
      }
    } catch (e) {
      console.debug("[toastNotices] failed to enumerate remotes for knock check:", e);
    }

    const counts = await Promise.all(tasks);
    const total = counts.reduce((a, b) => a + b, 0);

    showKnockRequestsToast(total, () => {
      // app uses HashRouter — set the hash so the router actually navigates.
      // pushState to a non-hash path doesn't notify HashRouter.
      window.location.hash = "/settings/admin-knocks";
      dismissKnockRequestsToast();
    });
  } catch (error) {
    console.debug("[toastNotices] checkPendingKnocks failed:", error);
  }
}
