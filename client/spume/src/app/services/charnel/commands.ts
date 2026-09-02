/**
 * tauri command wrappers (JS → Rust via invoke)
 *
 * these functions wrap tauri's invoke() with proper typing via zod schemas.
 * they are only callable in tauri mode - will throw in browser builds.
 */

import {
  FreqholeConfigSchema,
  ConfigUpgradeStatusSchema,
  type FreqholeConfig,
  type ConfigUpgradeStatus,
} from "./schema";

// dynamically import tauri to allow tree-shaking in browser builds
async function getInvoke() {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

/**
 * get freqhole server config from tauri backend
 *
 * call this on startup to get server info (id, name, url).
 */
export async function getConfig(): Promise<FreqholeConfig | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke("get_freqhole_config");

    if (!result) {
      return null;
    }

    return FreqholeConfigSchema.parse(result);
  } catch (error) {
    console.error("[tauri/commands] failed to get config:", error);
    return null;
  }
}

/**
 * check if server config needs upgrade (version mismatch).
 *
 * returns status with needs_upgrade flag and version info.
 */
export async function checkConfigNeedsUpgrade(): Promise<ConfigUpgradeStatus | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke("check_config_needs_upgrade");
    return ConfigUpgradeStatusSchema.parse(result);
  } catch (error) {
    console.error("[tauri/commands] failed to check config upgrade:", error);
    return null;
  }
}

/**
 * open the setup wizard window at a specific route.
 *
 * @param route - route to navigate to, e.g. "/settings"
 */
export async function openSetupWizard(route: string = "/"): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("open_setup_wizard", { route });
  } catch (error) {
    console.error("[tauri/commands] failed to open setup wizard:", error);
  }
}

/**
 * open (or focus) the native "about freqhole" window.
 */
export async function openAboutWindow(): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("open_about_window");
  } catch (error) {
    console.error("[tauri/commands] failed to open about window:", error);
  }
}

/**
 * open the app's data directory in the OS file manager.
 */
export async function openDataFolder(): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("open_config_dir");
  } catch (error) {
    console.error("[tauri/commands] failed to open data folder:", error);
  }
}

export interface P2pStatusResponse {
  /** "stopped" | "starting..." | "online" | "offline" | "connecting..." */
  status: string;
  federationEnabled: boolean;
}

/**
 * current P2P endpoint status + whether federation is enabled at all
 * (mirrors the native app-menu/tray P2P controls, see charnel's
 * menu.rs/tray.rs).
 */
export async function getP2pStatus(): Promise<P2pStatusResponse | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke<{ status: string; federation_enabled: boolean }>("p2p_get_status");
    return { status: result.status, federationEnabled: result.federation_enabled };
  } catch (error) {
    console.error("[tauri/commands] failed to get P2P status:", error);
    return null;
  }
}

export async function startP2p(): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("p2p_start");
  } catch (error) {
    console.error("[tauri/commands] failed to start P2P:", error);
  }
}

export async function stopP2p(): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("p2p_stop");
  } catch (error) {
    console.error("[tauri/commands] failed to stop P2P:", error);
  }
}

export async function restartP2p(): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("p2p_restart");
  } catch (error) {
    console.error("[tauri/commands] failed to restart P2P:", error);
  }
}

/**
 * is this install running under flatpak? gates the doc-portal storage
 * health check (see checkAndShowStorageHealthToast in toastNotices.tsx) -
 * the underlying failure mode (stale document-portal write grants) can't
 * occur outside a flatpak sandbox.
 */
export async function isFlatpak(): Promise<boolean> {
  try {
    const invoke = await getInvoke();
    return Boolean(await invoke("is_flatpak"));
  } catch (error) {
    return false;
  }
}

/**
 * real read+write probe for a directory (creates+deletes a throwaway
 * marker file) - distinct from just checking the path exists, since a
 * stale flatpak doc-portal grant (or a read-only host path) can still
 * resolve/exist while no longer being writable.
 */
export async function checkDirWritable(path: string): Promise<boolean> {
  try {
    const invoke = await getInvoke();
    return Boolean(await invoke("check_dir_writable", { path }));
  } catch (error) {
    return false;
  }
}

/**
 * the configured fetch-music output directory, if set.
 */
export async function getFetchMusicDir(): Promise<string | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke("get_fetch_music_dir");
    return typeof result === "string" ? result : null;
  } catch (error) {
    return null;
  }
}

/**
 * set the main window title.
 *
 * @param title - the window title to set
 */
export async function setWindowTitle(title: string): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.setTitle(title);
  } catch (error) {
    // silently fail - not critical
  }
}

/**
 * check whether this window should render its own drag-strip + traffic-light
 * buttons instead of relying on the native title bar.
 *
 * mirrors whatever the rust side actually did when it built the window (see
 * lib.rs/wizard.rs) - macOS + linux only, defaults to true. other platforms
 * always keep their native decorations regardless of this setting, so
 * callers must gate rendering on this AND running under tauri desktop.
 */
export async function getChromelessTitleBar(): Promise<boolean> {
  try {
    const invoke = await getInvoke();
    return Boolean(await invoke("get_chromeless_title_bar"));
  } catch (error) {
    return false;
  }
}

/**
 * minimize the current window. used by the custom title-bar strip's
 * traffic-light buttons when running chromeless (see `getChromelessTitleBar`).
 */
export async function minimizeWindow(): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  } catch (error) {
    // silently fail - not critical
  }
}

/**
 * toggle the current window between maximized and restored. mirrors what
 * double-clicking a `data-tauri-drag-region` strip already does natively.
 */
export async function toggleMaximizeWindow(): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  } catch (error) {
    // silently fail - not critical
  }
}

/**
 * close the current window.
 */
export async function closeWindow(): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch (error) {
    // silently fail - not critical
  }
}

/**
 * explicitly start a native window drag from the title-bar strip, in
 * addition to the passive `data-tauri-drag-region` attribute (which relies
 * on tauri's injected mousedown listener picking up the click). errors are
 * logged (rather than swallowed) since a silent failure here is exactly
 * what makes "drag doesn't work" hard to diagnose.
 */
export async function startDraggingWindow(): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  } catch (error) {
    console.error("startDragging failed:", error);
  }
}

/**
 * start a window resize from a corner grip. undecorated (chromeless)
 * windows lose the window manager's own resize border, so the title-bar
 * strip draws a small hover-visible grip that calls this instead.
 */
export async function startResizingWindow(
  direction:
    "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West"
): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startResizeDragging(direction);
  } catch (error) {
    console.error("startResizeDragging failed:", error);
  }
}

/**
 * push "now playing" metadata to the OS media session (MPRIS/SMTC/
 * MPNowPlayingInfoCenter via the rust `playwire` crate) - only meaningful
 * for the rodio audio + gst video paths, since the webview's own
 * `<audio>`/`<video>` elements already get a `navigator.mediaSession` for
 * free. safe to call unconditionally; a no-op when `use_rodio_playback`
 * is off or outside tauri.
 */
export async function pushMediaSessionTrack(track: {
  id: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string;
}): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("media_session_set_track", {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
    });
    // TEMP(media-session): remove once confirmed working.
    console.info("[media-session] media_session_set_track invoke succeeded");
  } catch (error) {
    // TEMP(media-session): remove once confirmed working - normally this
    // catch is silent since it also covers "not running in tauri".
    console.info("[media-session] media_session_set_track invoke failed:", error);
  }
}

/**
 * clear the OS media session's "now playing" state - queue emptied,
 * player stopped/closed.
 */
export async function clearMediaSessionTrack(): Promise<void> {
  try {
    const invoke = await getInvoke();
    await invoke("media_session_clear_track");
  } catch (error) {
    // non-tauri, or feature disabled - safe to ignore.
  }
}

/**
 * drain any pending deep-link urls (`freqhole://...`) received before this
 * frontend's event listeners were attached. used on cold start to handle the
 * case where the app was launched by clicking a `freqhole://o/<token>` link.
 *
 * urls received after this call arrive as `share-link-received` tauri events.
 */
export async function takePendingDeepLinks(): Promise<string[]> {
  try {
    const invoke = await getInvoke();
    const result = await invoke<string[]>("take_pending_deep_links");
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error("[tauri/commands] failed to drain pending deep links:", error);
    return [];
  }
}

/**
 * fetch this charnel app's local iroh node id (64-hex). returns null when
 * p2p isn't initialized (e.g. federation disabled in config). used to populate
 * `localNodeId` so share links + send-to-remote can work from the local
 * "charnel-managed" remote, which has no `peer_addr` of its own.
 */
export async function fetchLocalNodeId(): Promise<string | null> {
  try {
    const invoke = await getInvoke();
    const result = await invoke<string>("p2p_get_node_id");
    if (typeof result === "string" && /^[0-9a-f]{64}$/i.test(result)) {
      return result.toLowerCase();
    }
    return null;
  } catch (error) {
    // p2p not initialized — config has federation disabled or endpoint failed.
    // not actually an error, just nothing to share with.
    return null;
  }
}

/**
 * import raw bytes into this charnel app's local iroh-blobs store so they
 * can be pulled by a remote peer via verified download. mirrors
 * `CharnelTransport.ts`'s `uploadMediaViaBytes` use of the same tauri
 * command for music/video uploads - same store, same pull model.
 *
 * @returns the blake3 hash the bytes were stored under.
 */
export async function importBlobBytes(base64: string): Promise<string> {
  const invoke = await getInvoke();
  return invoke<string>("p2p_import_blob_bytes", { data: base64 });
}

/**
 * update server.name / server.description in the freqhole config toml.
 * used by the rename flow for the charnel-managed local-library remote so
 * the new name survives an app restart (otherwise startup re-seeds the
 * remote row from config).
 */
export async function updateServerInfo(args: {
  name?: string;
  description?: string;
}): Promise<void> {
  const invoke = await getInvoke();
  await invoke("update_server_info", {
    name: args.name ?? null,
    description: args.description ?? null,
  });
}
