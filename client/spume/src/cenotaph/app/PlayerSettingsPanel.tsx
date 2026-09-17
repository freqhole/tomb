// phase 8-equivalent for spume's /player/ route: local-only player device
// settings - rename (reuses spume's own local library name, not a separate
// device-name store), pin rotation, trusted-controller management, storage
// usage readout. mirrors player.freqhole.net's now-abandoned
// `settings/SettingsPanel.tsx` pixel-for-pixel, adapted to spume's own
// trust store and library-name concept instead of cenotaph's defaults.

import { createEffect, createResource, createSignal, onMount, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  connectedControllers,
  currentPin,
  currentSession,
  develMode,
  formatBytes,
  getStorageUsage,
  isPeerAllowedInSession,
  joinSession,
  leaveSession,
  regenerateAdminPin,
  regeneratePin,
  setDevelMode,
  setSessionMode,
  setSessionSignal,
  type TrustedController,
} from "../index";
import {
  appState,
  getLocalLibraryName,
  getSyncQueueToLocal,
  setLocalLibraryName,
  setSyncQueueToLocal,
} from "../../app/services/storage/db";
import { isCharnelMode, getConfig } from "../../app/services/charnel";
import {
  forceShowQr,
  remotePlaybackEnabled,
  setRemotePlaybackEnabled,
  toggleForceShowQr,
} from "../adapters/remoteModeSettings";
import { spumeTrustStore } from "../adapters/trustStoreAdapter";
import { spumeSessionStore } from "../adapters/playerSessionAdapter";
import {
  charnelRegenerateAdminPin,
  charnelRegeneratePin,
  charnelSetSessionMode,
} from "../adapters/charnelAcceptBridge";

export function PlayerSettingsPanel(props: { onClose: () => void; nodeId?: string }) {
  const navigate = useNavigate();
  const [nameInput, setNameInput] = createSignal(getLocalLibraryName());
  const [controllers, { refetch: refetchControllers }] = createResource(
    spumeTrustStore.listTrustedControllers
  );
  const [usage] = createResource(getStorageUsage);
  const [copied, setCopied] = createSignal(false);

  // the device name defaults to "local library" until explicitly renamed
  // (here or via the topnav rename action, same persisted field) - in
  // charnel mode, prefer this device's real configured name
  // (freqhole-config.toml's `[server] name`) over that generic default,
  // since that's the name the user actually gave this library/device.
  onMount(() => {
    if (!isCharnelMode() || appState()?.local_library_name) return;
    void (async () => {
      const config = await getConfig();
      const name = config?.server_name?.trim();
      if (name && !appState()?.local_library_name) {
        setNameInput(name);
        await setLocalLibraryName(name);
      }
    })();
  });

  // playerConnectionHandler.ts pushes a fresh session on every pairing
  // event (including admin-bootstrap redemptions, which also rotate the
  // pin) - refetch trusted controllers on the same trigger so this list
  // doesn't sit stale while the panel is left open.
  createEffect(() => {
    currentSession();
    void refetchControllers();
  });

  const saveName = async () => {
    await setLocalLibraryName(nameInput());
  };

  const copyNodeId = async () => {
    if (!props.nodeId) return;
    await navigator.clipboard.writeText(props.nodeId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const forget = async (controller: TrustedController) => {
    await spumeTrustStore.forgetController(controller.node_id);
    await refetchControllers();
  };

  // live ("holding an open control-session stream right now") vs.
  // trustStore's "ever paired" list above - see cenotaph's
  // connectedControllers.ts for the ~45s disconnect grace period.
  const isConnectedNow = (nodeId: string) =>
    connectedControllers().some((c) => c.node_id === nodeId);

  const toggleSessionMode = async () => {
    const session = currentSession();
    if (!session) return;
    const nextMode = session.mode === "everyone" ? "selected" : "everyone";
    // in charnel mode the pin/session shown here is sourced from
    // grimoire's real state (see charnelAcceptBridge.ts's
    // refreshCharnelPairingSnapshot) - mutating it must go through the
    // matching tauri command, not the local-only playerSession.ts store,
    // which charnel's accept path never reads at all.
    if (isCharnelMode()) {
      await charnelSetSessionMode(nextMode);
      return;
    }
    const next = await setSessionMode(spumeSessionStore, session, nextMode);
    setSessionSignal(next);
  };

  // charnel has no tauri command for manually adding/removing a single
  // controller from the session independent of full trust revocation
  // (grimoire's session only grows via a real pin redemption - see
  // grimoire/src/cenotaph/endpoint.rs's handle_pair_request) - the
  // button rendered below is a read-only status badge instead of this
  // handler in charnel mode (see the render site).
  const toggleSessionMember = async (nodeId: string) => {
    const session = currentSession();
    if (!session || isCharnelMode()) return;
    const next = isPeerAllowedInSession(session, nodeId)
      ? await leaveSession(spumeSessionStore, session, nodeId)
      : await joinSession(spumeSessionStore, session, nodeId);
    setSessionSignal(next);
  };

  const requestAdminPin = async () => {
    if (isCharnelMode()) {
      await charnelRegenerateAdminPin();
      return;
    }
    const session = currentSession();
    if (!session) return;
    setSessionSignal(await regenerateAdminPin(spumeSessionStore, session));
  };

  return (
    <div
      // above CenotaphPlayerApp.tsx's base content tier (z-[1700] - now-
      // playing view, inline video, pairing screens) so this modal-like
      // overlay always wins regardless of dom order, including over an
      // actively-playing inline video. NOT `items-center justify-center` -
      // centering a scrolling flex container that way clips the start of
      // its content when it overflows (a well-known flexbox gotcha) -
      // `m-auto` on the child below gives the same centered look when
      // content fits, without clipping when it doesn't.
      class="fixed inset-0 z-[1800] flex overflow-y-auto bg-black/90 p-6"
      data-testid="settings-panel"
    >
      <div class="m-auto flex w-full max-w-md flex-col gap-6 text-left">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="text-neutral-400"
              title="back to spume"
              onClick={() => navigate(-1)}
              data-testid="back-to-spume-link"
            >
              &#8592;
            </button>
            <h2 class="text-xl font-semibold">player settings</h2>
          </div>
          <button
            type="button"
            class="text-base text-neutral-400"
            onClick={() => props.onClose()}
            data-testid="settings-close"
          >
            close
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">device name</label>
          <div class="flex gap-2">
            <input
              class="flex-1 rounded bg-neutral-800 px-2 py-1 text-base"
              value={nameInput()}
              onInput={(e) => setNameInput(e.currentTarget.value)}
              data-testid="device-name-input"
            />
            <button
              type="button"
              class="rounded bg-neutral-700 px-3 py-1 text-base"
              onClick={saveName}
              data-testid="device-name-save"
            >
              save
            </button>
          </div>
        </div>

        <Show when={props.nodeId}>
          {(id) => (
            <div class="flex flex-col gap-2">
              <label class="text-sm tracking-widest text-neutral-500 uppercase">device id</label>
              <div class="flex items-center gap-2">
                <p
                  class="flex-1 truncate font-mono text-sm text-neutral-400"
                  data-testid="settings-node-id"
                >
                  {id()}
                </p>
                <button
                  type="button"
                  class="rounded bg-neutral-700 px-3 py-1 text-base"
                  onClick={copyNodeId}
                  data-testid="copy-node-id-button"
                >
                  {copied() ? "copied!" : "copy"}
                </button>
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">
            accept player connections
          </label>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-base"
            aria-pressed={remotePlaybackEnabled()}
            onClick={() => setRemotePlaybackEnabled(!remotePlaybackEnabled())}
            data-testid="remote-playback-enabled-toggle"
          >
            {remotePlaybackEnabled() ? "on" : "off"}
          </button>
          <p class="text-sm text-neutral-500">
            off by default - turn on to let other devices pair with (and control playback on) this
            one, via pin or qr code.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">
            show pairing qr code
          </label>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-base"
            aria-pressed={forceShowQr()}
            onClick={() => toggleForceShowQr()}
            data-testid="force-show-qr-toggle"
          >
            {forceShowQr() ? "on" : "off"}
          </button>
          <p class="text-sm text-neutral-500">
            keeps the pairing qr/pin visible even while something's playing or queued - handy for
            pairing another controller mid-session. press "q" on the player screen to toggle this
            too.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">
            sync queue to local library
          </label>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-base"
            aria-pressed={getSyncQueueToLocal()}
            onClick={() => void setSyncQueueToLocal(!getSyncQueueToLocal())}
            data-testid="sync-queue-to-local-toggle"
          >
            {getSyncQueueToLocal() ? "on" : "off"}
          </button>
          <p class="text-sm text-neutral-500">
            on by default - saves queued media into this device's own local library instead of just
            an ephemeral cache, so it plays back offline. shares the same setting as spume's normal
            library auto-download feature.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">pairing pin</label>
          <div class="flex items-center gap-2">
            <p class="font-mono text-4xl tracking-widest" data-testid="settings-pin">
              {currentPin()}
            </p>
            <button
              type="button"
              class="rounded bg-neutral-700 px-3 py-1 text-base"
              onClick={() =>
                void (isCharnelMode() ? charnelRegeneratePin() : regeneratePin(spumeSessionStore))
              }
              data-testid="rotate-pin-button"
            >
              rotate pin
            </button>
          </div>
          <Show when={currentSession()?.admin_grant_pending}>
            <p class="text-sm text-amber-400" data-testid="admin-grant-pending-badge">
              this pin grants admin access to whoever redeems it next.
            </p>
          </Show>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-base"
            onClick={requestAdminPin}
            data-testid="regenerate-admin-pin-button"
          >
            regenerate admin pairing code
          </button>
          <p class="text-sm text-neutral-500">
            mints a fresh one-time pin that grants the next device to redeem it admin access - for
            bootstrapping a first (or additional) admin.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">
            who can send commands
          </label>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-base"
            aria-pressed={currentSession()?.mode === "everyone"}
            onClick={toggleSessionMode}
            data-testid="session-mode-toggle"
          >
            {currentSession()?.mode === "everyone" ? "everyone" : "selected devices"}
          </button>
          <p class="text-sm text-neutral-500">
            "selected devices" (default) - only devices you've added below (or that redeemed the
            current pin) can send playback/queue commands. "everyone" - any paired device can.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">
            trusted controllers
          </label>
          <ul class="flex flex-col gap-1" data-testid="trusted-controller-list">
            <For each={controllers() ?? []}>
              {(controller) => (
                <li
                  class="flex items-center justify-between rounded bg-neutral-800 px-2 py-1 text-base"
                  data-testid="trusted-controller-row"
                >
                  <span class="flex min-w-0 items-center gap-2 truncate">
                    <span
                      class="inline-block h-2 w-2 shrink-0 rounded-full"
                      classList={{
                        "bg-green-500": isConnectedNow(controller.node_id),
                        "bg-neutral-600": !isConnectedNow(controller.node_id),
                      }}
                      aria-label={
                        isConnectedNow(controller.node_id) ? "connected now" : "not connected"
                      }
                      data-testid="controller-connected-indicator"
                    />
                    <span class="truncate">
                      {controller.display_name}{" "}
                      <span class="text-neutral-500">({controller.role})</span>
                    </span>
                  </span>
                  <span class="flex items-center gap-2">
                    <Show
                      when={
                        currentSession()?.mode !== "everyone" &&
                        controller.role !== "admin" &&
                        !isCharnelMode()
                      }
                    >
                      <button
                        type="button"
                        class="text-neutral-400"
                        aria-pressed={
                          currentSession()
                            ? isPeerAllowedInSession(currentSession()!, controller.node_id)
                            : false
                        }
                        onClick={() => toggleSessionMember(controller.node_id)}
                        data-testid="toggle-session-member-button"
                      >
                        {currentSession() &&
                        isPeerAllowedInSession(currentSession()!, controller.node_id)
                          ? "in session"
                          : "not in session"}
                      </button>
                    </Show>
                    <Show
                      when={
                        currentSession()?.mode !== "everyone" &&
                        controller.role !== "admin" &&
                        isCharnelMode()
                      }
                    >
                      <span class="text-neutral-500" data-testid="session-member-status-badge">
                        {currentSession() &&
                        isPeerAllowedInSession(currentSession()!, controller.node_id)
                          ? "in session"
                          : "not in session (redeem pin to join)"}
                      </span>
                    </Show>
                    <Show
                      when={currentSession()?.mode !== "everyone" && controller.role === "admin"}
                    >
                      <span class="text-neutral-500" data-testid="admin-always-in-session-badge">
                        admin (always in session)
                      </span>
                    </Show>
                    <button
                      type="button"
                      class="text-neutral-400"
                      onClick={() => forget(controller)}
                      data-testid="forget-controller-button"
                    >
                      forget
                    </button>
                  </span>
                </li>
              )}
            </For>
            <Show when={controllers()?.length === 0}>
              <li class="text-base text-neutral-500">no paired controllers</li>
            </Show>
          </ul>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">local storage</label>
          <Show when={usage()}>
            {(u) => (
              <p class="text-base text-neutral-400" data-testid="storage-usage">
                {formatBytes(u().usageBytes)}
                <Show when={u().quotaBytes !== null}> / {formatBytes(u().quotaBytes!)}</Show>
              </p>
            )}
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-sm tracking-widest text-neutral-500 uppercase">devel mode</label>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-base"
            aria-pressed={develMode()}
            onClick={() => void setDevelMode(!develMode())}
            data-testid="devel-mode-toggle"
          >
            {develMode() ? "on" : "off"}
          </button>
          <p class="text-sm text-neutral-500">
            shows a console-log debug overlay - for debugging on devices with no accessible
            devtools.
          </p>
        </div>
      </div>
    </div>
  );
}
