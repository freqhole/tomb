// phase 8-equivalent for spume's /player/ route: local-only player device
// settings - rename (reuses spume's own local library name, not a separate
// device-name store), pin rotation, trusted-controller management, storage
// usage readout. mirrors player.freqhole.net's now-abandoned
// `settings/SettingsPanel.tsx` pixel-for-pixel, adapted to spume's own
// trust store and library-name concept instead of cenotaph's defaults.

import { createResource, createSignal, For, Show } from "solid-js";
import {
  currentPin,
  develMode,
  formatBytes,
  getStorageUsage,
  regeneratePin,
  setDevelMode,
  type TrustedController,
} from "@freqhole/cenotaph";
import { getLocalLibraryName, setLocalLibraryName } from "../services/storage/db";
import {
  remotePlaybackEnabled,
  setRemotePlaybackEnabled,
} from "../services/remotePlayback/remoteModeSettings";
import { spumeTrustStore } from "../services/remotePlayback/trustStoreAdapter";

export function PlayerSettingsPanel(props: { onClose: () => void; nodeId?: string }) {
  const [nameInput, setNameInput] = createSignal(getLocalLibraryName());
  const [controllers, { refetch: refetchControllers }] = createResource(
    spumeTrustStore.listTrustedControllers
  );
  const [usage] = createResource(getStorageUsage);
  const [copied, setCopied] = createSignal(false);

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

  return (
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-6"
      data-testid="settings-panel"
    >
      <div class="flex w-full max-w-md flex-col gap-6 text-left">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">player settings</h2>
          <button
            type="button"
            class="text-sm text-neutral-400"
            onClick={() => props.onClose()}
            data-testid="settings-close"
          >
            close
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs tracking-widest text-neutral-500 uppercase">device name</label>
          <div class="flex gap-2">
            <input
              class="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm"
              value={nameInput()}
              onInput={(e) => setNameInput(e.currentTarget.value)}
              data-testid="device-name-input"
            />
            <button
              type="button"
              class="rounded bg-neutral-700 px-3 py-1 text-sm"
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
              <label class="text-xs tracking-widest text-neutral-500 uppercase">device id</label>
              <div class="flex items-center gap-2">
                <p
                  class="flex-1 truncate font-mono text-xs text-neutral-400"
                  data-testid="settings-node-id"
                >
                  {id()}
                </p>
                <button
                  type="button"
                  class="rounded bg-neutral-700 px-3 py-1 text-sm"
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
          <label class="text-xs tracking-widest text-neutral-500 uppercase">
            accept player connections
          </label>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-sm"
            aria-pressed={remotePlaybackEnabled()}
            onClick={() => setRemotePlaybackEnabled(!remotePlaybackEnabled())}
            data-testid="remote-playback-enabled-toggle"
          >
            {remotePlaybackEnabled() ? "on" : "off"}
          </button>
          <p class="text-xs text-neutral-500">
            off by default - turn on to let other devices pair with (and control playback on) this
            one, via pin or qr code.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs tracking-widest text-neutral-500 uppercase">pairing pin</label>
          <div class="flex items-center gap-2">
            <p class="font-mono text-2xl tracking-widest" data-testid="settings-pin">
              {currentPin()}
            </p>
            <button
              type="button"
              class="rounded bg-neutral-700 px-3 py-1 text-sm"
              onClick={() => regeneratePin()}
              data-testid="rotate-pin-button"
            >
              rotate pin
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs tracking-widest text-neutral-500 uppercase">
            trusted controllers
          </label>
          <ul class="flex flex-col gap-1" data-testid="trusted-controller-list">
            <For each={controllers() ?? []}>
              {(controller) => (
                <li
                  class="flex items-center justify-between rounded bg-neutral-800 px-2 py-1 text-sm"
                  data-testid="trusted-controller-row"
                >
                  <span class="truncate">{controller.display_name}</span>
                  <button
                    type="button"
                    class="text-neutral-400"
                    onClick={() => forget(controller)}
                    data-testid="forget-controller-button"
                  >
                    forget
                  </button>
                </li>
              )}
            </For>
            <Show when={controllers()?.length === 0}>
              <li class="text-sm text-neutral-500">no paired controllers</li>
            </Show>
          </ul>
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs tracking-widest text-neutral-500 uppercase">local storage</label>
          <Show when={usage()}>
            {(u) => (
              <p class="text-sm text-neutral-400" data-testid="storage-usage">
                {formatBytes(u().usageBytes)}
                <Show when={u().quotaBytes !== null}> / {formatBytes(u().quotaBytes!)}</Show>
              </p>
            )}
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs tracking-widest text-neutral-500 uppercase">devel mode</label>
          <button
            type="button"
            class="self-start rounded bg-neutral-700 px-3 py-1 text-sm"
            aria-pressed={develMode()}
            onClick={() => void setDevelMode(!develMode())}
            data-testid="devel-mode-toggle"
          >
            {develMode() ? "on" : "off"}
          </button>
          <p class="text-xs text-neutral-500">
            shows a console-log debug overlay - for debugging on devices with no accessible
            devtools.
          </p>
        </div>
      </div>
    </div>
  );
}
