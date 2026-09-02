// phase 8-equivalent for spume's /player/ route: local-only player device
// settings - rename (reuses spume's own local library name, not a separate
// device-name store), pin rotation, trusted-controller management, storage
// usage readout. mirrors player.freqhole.net's now-abandoned
// `settings/SettingsPanel.tsx` pixel-for-pixel, adapted to spume's own
// trust store and library-name concept instead of cenotaph's defaults.

import { createEffect, createResource, createSignal, For, Show } from "solid-js";
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
} from "@freqhole/cenotaph";
import {
  getLocalLibraryName,
  getSyncQueueToLocal,
  setLocalLibraryName,
  setSyncQueueToLocal,
} from "../services/storage/db";
import {
  remotePlaybackEnabled,
  setRemotePlaybackEnabled,
} from "../services/remotePlayback/remoteModeSettings";
import { spumeTrustStore } from "../services/remotePlayback/trustStoreAdapter";
import { spumeSessionStore } from "../services/remotePlayback/playerSessionAdapter";

export function PlayerSettingsPanel(props: { onClose: () => void; nodeId?: string }) {
  const [nameInput, setNameInput] = createSignal(getLocalLibraryName());
  const [controllers, { refetch: refetchControllers }] = createResource(
    spumeTrustStore.listTrustedControllers
  );
  const [usage] = createResource(getStorageUsage);
  const [copied, setCopied] = createSignal(false);

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
    const next = await setSessionMode(
      spumeSessionStore,
      session,
      session.mode === "everyone" ? "selected" : "everyone"
    );
    setSessionSignal(next);
  };

  const toggleSessionMember = async (nodeId: string) => {
    const session = currentSession();
    if (!session) return;
    const next = isPeerAllowedInSession(session, nodeId)
      ? await leaveSession(spumeSessionStore, session, nodeId)
      : await joinSession(spumeSessionStore, session, nodeId);
    setSessionSignal(next);
  };

  const requestAdminPin = async () => {
    const session = currentSession();
    if (!session) return;
    setSessionSignal(await regenerateAdminPin(spumeSessionStore, session));
  };

  return (
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/90 p-6"
      data-testid="settings-panel"
    >
      <div class="flex max-h-full w-full max-w-md flex-col gap-6 overflow-y-auto text-left">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <a
              href="/"
              class="text-neutral-400"
              title="back to spume"
              data-testid="back-to-spume-link"
            >
              &#8592;
            </a>
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
              onClick={() => void regeneratePin(spumeSessionStore)}
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
                      when={currentSession()?.mode !== "everyone" && controller.role !== "admin"}
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
