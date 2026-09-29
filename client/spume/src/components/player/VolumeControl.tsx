import { createSignal, onCleanup, createEffect, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../icons/registry";

/** one audio output device, as reported by whichever backend is actually
 * playing (local rodio, or a paired remote player) - duck-typed to match
 * both `@freqhole/api-client`'s `AudioDeviceInfo` (local) and
 * `remotePlaybackControl.ts`'s `RemoteAudioDeviceInfo` (remote) without
 * this generic ui component depending on either source module. */
export interface AudioDeviceInfo {
  name: string;
  description: string;
}

export interface VolumeControlProps {
  /** current volume (0-1) */
  volume: number;
  /** callback when volume changes */
  onVolumeChange: (volume: number) => void;
  /** additional classes */
  class?: string;
  /** omitted entirely (no device-picker button at all) when the active
   * playback target has no native output-device concept (e.g. plain
   * browser/html audio, or a remote target that doesn't support it).
   * always re-queried fresh each time the picker opens - devices can be
   * plugged/unplugged at any time, so a cached list would go stale. */
  onListOutputDevices?: () => Promise<AudioDeviceInfo[]>;
  /** switches the active output device - only ever called with a `name`
   * from a device `onListOutputDevices` just reported. */
  onSetOutputDevice?: (name: string) => void;
}

// volume control: click (or hover) opens a horizontal flyout to the LEFT
// of the button, at the same vertical position as the playerbar itself
// (not floating above it) - it overlaps whatever's to its left (the
// progress bar) rather than pushing the layout around, same convention
// as every other playerbar popover. a device-picker button lives inside
// the same flyout when the active target supports it.
export function VolumeControl(props: VolumeControlProps) {
  const [showPanel, setShowPanel] = createSignal(false);
  // tracked separately from props.volume so the slider updates instantly
  // while dragging, without firing onVolumeChange (and, for remote targets,
  // a network round-trip) on every intermediate value - only on release.
  const [displayVolume, setDisplayVolume] = createSignal(props.volume);
  const [dragging, setDragging] = createSignal(false);
  const [showDevices, setShowDevices] = createSignal(false);
  const [devices, setDevices] = createSignal<AudioDeviceInfo[] | null>(null);
  const [devicesLoading, setDevicesLoading] = createSignal(false);
  // purely a client-side "what did I just pick, this session" indicator -
  // the wire protocol has no way to report which device is CURRENTLY
  // active (every `AudioDeviceInfo` is just a name/description pair with
  // no "is this the live one" flag), so this is optimistic, not
  // authoritative. resets whenever the picker is reopened fresh.
  const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
  let hideTimeout: number | null = null;
  // the flyout is portaled to document.body (see the render below for why -
  // PlayerBar's own root is `position: fixed` + `z-50`, which makes it a
  // stacking context that traps every descendant z-index, including this
  // panel's z-[2000], underneath anything outside PlayerBar with a higher
  // z-index of its own - e.g. QueueSidebar's z-1140 fixed drawer). since a
  // portaled element is no longer a DOM descendant of `triggerRef`, its
  // screen position has to be computed from the trigger's own rect instead
  // of relying on `absolute`/`top-1/2` anchoring.
  let triggerRef: HTMLDivElement | undefined;
  const [flyoutPos, setFlyoutPos] = createSignal<{ top: number; right: number } | null>(null);

  const cancelHideTimeout = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
  };

  // adopt external volume changes (e.g. from another synced client) as
  // long as the user isn't actively dragging this slider right now.
  createEffect(() => {
    if (!dragging()) setDisplayVolume(props.volume);
  });

  const openPanel = () => {
    cancelHideTimeout();
    if (triggerRef) {
      const rect = triggerRef.getBoundingClientRect();
      // mirrors the old `right-full ... mr-2` anchor: flyout's right edge
      // sits 8px left of the trigger, vertically centered on it.
      setFlyoutPos({ top: rect.top + rect.height / 2, right: window.innerWidth - rect.left + 8 });
    }
    setShowPanel(true);
    // queried up front (not just when the device dropdown itself opens)
    // so the headphones button can be hidden entirely when there's
    // nothing to pick from - see its own `Show` guard below.
    if (!props.onListOutputDevices) return;
    void props
      .onListOutputDevices()
      .then((list) => setDevices(list))
      .catch(() => setDevices([]));
  };

  const closePanel = (immediate = false) => {
    const doClose = () => {
      setShowPanel(false);
      setShowDevices(false);
      hideTimeout = null;
    };
    if (immediate) {
      doClose();
      return;
    }
    hideTimeout = window.setTimeout(doClose, 300);
  };

  const togglePanel = () => {
    if (showPanel()) {
      closePanel(true);
    } else {
      openPanel();
    }
  };

  const toggleDevices = () => {
    const next = !showDevices();
    setShowDevices(next);
    if (!next || !props.onListOutputDevices) return;
    setDevicesLoading(true);
    setSelectedDevice(null);
    void props
      .onListOutputDevices()
      .then((list) => setDevices(list))
      .catch(() => setDevices([]))
      .finally(() => setDevicesLoading(false));
  };

  const pickDevice = (name: string) => {
    setSelectedDevice(name);
    props.onSetOutputDevice?.(name);
  };

  const handleVolumeInput = (e: InputEvent) => {
    const target = e.currentTarget as HTMLInputElement;
    setDisplayVolume(parseFloat(target.value));
  };

  const handleVolumeCommit = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const newVolume = parseFloat(target.value);
    setDisplayVolume(newVolume);
    setDragging(false);
    props.onVolumeChange(newVolume);
  };

  onCleanup(() => {
    if (hideTimeout) clearTimeout(hideTimeout);
  });

  const volumeIcon = () => (displayVolume() === 0 ? "volumeOff" : "volume");
  const volumePercentage = () => Math.round(displayVolume() * 100);

  return (
    <div
      ref={(el) => (triggerRef = el)}
      class={`relative flex items-center ${props.class || ""}`}
      onMouseEnter={openPanel}
      onMouseLeave={() => closePanel()}
    >
      <button
        class="p-2 rounded-full hover:bg-[var(--color-accent-500)]/20 transition-colors"
        onClick={togglePanel}
        title={`volume: ${volumePercentage()}%`}
        aria-label="volume control"
      >
        <Icon
          name={volumeIcon()}
          size={20}
          color="var(--color-accent-500)"
          className="hover:text-[var(--color-text-primary)] transition-colors"
        />
      </button>

      <Show when={showPanel() && flyoutPos()}>
        {(pos) => (
          <Portal mount={document.body}>
            <div
              class="fixed flex items-center gap-3 rounded-full bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border border-[var(--color-accent-500)]/30 shadow-lg z-[2000] px-4 py-2 whitespace-nowrap"
              style={{
                top: `${pos().top}px`,
                right: `${pos().right}px`,
                transform: "translateY(-50%)",
              }}
              data-testid="volume-flyout"
              onMouseEnter={cancelHideTimeout}
              onMouseLeave={() => closePanel()}
            >
              <span class="text-xs text-[var(--color-accent-500)] font-medium tabular-nums w-8 text-right">
                {volumePercentage()}%
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={displayVolume()}
                onPointerDown={() => setDragging(true)}
                onInput={handleVolumeInput}
                onChange={handleVolumeCommit}
                class="w-28 h-1.5 rounded-full outline-none cursor-pointer appearance-none"
                style={{
                  background: `linear-gradient(to right, var(--color-accent-500) 0%, var(--color-accent-500) ${displayVolume() * 100}%, rgba(255, 26, 158, 0.2) ${displayVolume() * 100}%, rgba(255, 26, 158, 0.2) 100%)`,
                }}
                aria-label="volume slider"
              />
              <Show when={(devices()?.length ?? 0) > 0}>
                <div class="relative flex items-center">
                  <button
                    type="button"
                    class="p-1.5 rounded-full hover:bg-[var(--color-accent-500)]/20 transition-colors"
                    classList={{ "bg-[var(--color-accent-500)]/20": showDevices() }}
                    onClick={toggleDevices}
                    title="output device"
                    aria-label="choose output device"
                    data-testid="device-picker-toggle"
                  >
                    <Icon
                      name="headphones"
                      size={16}
                      color="var(--color-accent-500)"
                      className="hover:text-[var(--color-text-primary)] transition-colors"
                    />
                  </button>

                  <Show when={showDevices()}>
                    <div
                      class="absolute right-0 bottom-full mb-2 min-w-[12rem] max-w-[16rem] max-h-56 overflow-y-auto rounded-lg bg-[var(--color-bg-primary)]/95 backdrop-blur-xl border border-[var(--color-accent-500)]/30 shadow-lg z-[2001] py-1"
                      data-testid="device-picker-list"
                    >
                      <Show when={devicesLoading()}>
                        <div class="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                          loading devices…
                        </div>
                      </Show>
                      <Show when={!devicesLoading() && (devices()?.length ?? 0) === 0}>
                        <div class="px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                          no output devices available
                        </div>
                      </Show>
                      <For each={devicesLoading() ? [] : (devices() ?? [])}>
                        {(device) => (
                          <button
                            type="button"
                            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[var(--color-accent-500)]/20 transition-colors"
                            classList={{
                              "text-[var(--color-accent-500)] font-medium":
                                selectedDevice() === device.name,
                              "text-[var(--color-text-primary)]": selectedDevice() !== device.name,
                            }}
                            onClick={() => pickDevice(device.name)}
                            title={device.description}
                          >
                            <Show when={selectedDevice() === device.name}>
                              <Icon name="check" size={12} color="var(--color-accent-500)" />
                            </Show>
                            <span class="truncate">{device.description}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}
