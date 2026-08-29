// phase 8: local-only player device settings - rename, pin rotation,
// trusted-controller management, storage usage readout. no grimoire/admin
// concepts here, just this device's own local state.

import { createResource, createSignal, For, Show } from "solid-js";
import { currentPin, regeneratePin } from "../pairing/pinStore";
import {
  forgetController,
  listTrustedControllers,
  type TrustedController,
} from "../pairing/trustStore";
import { deviceName, setDeviceName } from "./deviceNameStore";
import { formatBytes, getStorageUsage } from "./storageUsage";

export default function SettingsPanel(props: { onClose: () => void; nodeId?: string }) {
  const [nameInput, setNameInput] = createSignal(deviceName());
  const [controllers, { refetch: refetchControllers }] = createResource(listTrustedControllers);
  const [usage] = createResource(getStorageUsage);
  const [copied, setCopied] = createSignal(false);

  const saveName = async () => {
    await setDeviceName(nameInput());
  };

  const copyNodeId = async () => {
    if (!props.nodeId) return;
    await navigator.clipboard.writeText(props.nodeId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const forget = async (controller: TrustedController) => {
    await forgetController(controller.node_id);
    await refetchControllers();
  };

  return (
    <div
      class="fixed inset-0 z-40 bg-black/90 flex items-center justify-center p-6"
      data-testid="settings-panel"
    >
      <div class="w-full max-w-md flex flex-col gap-6 text-left">
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
          <label class="text-xs uppercase tracking-widest text-neutral-500">device name</label>
          <div class="flex gap-2">
            <input
              class="flex-1 bg-neutral-800 rounded px-2 py-1 text-sm"
              value={nameInput()}
              onInput={(e) => setNameInput(e.currentTarget.value)}
              data-testid="device-name-input"
            />
            <button
              type="button"
              class="text-sm bg-neutral-700 rounded px-3 py-1"
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
              <label class="text-xs uppercase tracking-widest text-neutral-500">device id</label>
              <div class="flex items-center gap-2">
                <p
                  class="flex-1 truncate text-xs font-mono text-neutral-400"
                  data-testid="settings-node-id"
                >
                  {id()}
                </p>
                <button
                  type="button"
                  class="text-sm bg-neutral-700 rounded px-3 py-1"
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
          <label class="text-xs uppercase tracking-widest text-neutral-500">pairing pin</label>
          <div class="flex items-center gap-2">
            <p class="text-2xl font-mono tracking-widest" data-testid="settings-pin">
              {currentPin()}
            </p>
            <button
              type="button"
              class="text-sm bg-neutral-700 rounded px-3 py-1"
              onClick={() => regeneratePin()}
              data-testid="rotate-pin-button"
            >
              rotate pin
            </button>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-xs uppercase tracking-widest text-neutral-500">
            trusted controllers
          </label>
          <ul class="flex flex-col gap-1" data-testid="trusted-controller-list">
            <For each={controllers() ?? []}>
              {(controller) => (
                <li
                  class="flex items-center justify-between text-sm bg-neutral-800 rounded px-2 py-1"
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
          <label class="text-xs uppercase tracking-widest text-neutral-500">local storage</label>
          <Show when={usage()}>
            {(u) => (
              <p class="text-sm text-neutral-400" data-testid="storage-usage">
                {formatBytes(u().usageBytes)}
                <Show when={u().quotaBytes !== null}> / {formatBytes(u().quotaBytes!)}</Show>
              </p>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
