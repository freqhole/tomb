// simple single-select dropdown for choosing between "local (this
// browser)" and a real remote - used by AddMediaModal's header switcher in
// plain-web mode, where there's no charnel-managed `Remote` row to
// represent "local" the way there is in the desktop/tauri app (see
// docs/add-media-review-refactor-plan.md's plain-web switcher scoping
// note). deliberately NOT built on top of RemotePicker: that component's
// `remotes: Remote[]` contract, health-check wiring, and overflow/flyout
// machinery all assume every entry is a real, database-backed `Remote` -
// threading a synthetic "local" entry through all of that (and every OTHER
// RemotePicker consumer, e.g. AggregateFeedView) was a bigger, riskier
// change than just building this small, purpose-built picker instead.
import { createSignal, For, Show, onCleanup } from "solid-js";
import { Icon } from "../icons/registry";
import { isOnline, isProbing, probeRemote } from "../../app/services/remotes/remoteHealth";
import type { Remote } from "../../app/services/storage/schemas/remote";

/** sentinel id meaning "the browser's own local library", never a real
 * remote_id - see App.tsx's `addMediaTargetRemote()` for how this is
 * interpreted. */
export const LOCAL_WEB_TARGET_ID = "__local_web__";

interface LocalTargetPickerProps {
  /** real remote candidates (p2p/http) - plain web can still have these
   * even without a charnel-managed local remote. */
  remotes: Remote[];
  /** LOCAL_WEB_TARGET_ID or a remote_id. */
  value: string;
  onChange: (id: string) => void;
  /** display name for the local option, e.g. getLocalLibraryName(). */
  localLabel: string;
}

export function LocalTargetPicker(props: LocalTargetPickerProps) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  const selectedLabel = () => {
    if (props.value === LOCAL_WEB_TARGET_ID) return props.localLabel;
    return props.remotes.find((r) => r.remote_id === props.value)?.name ?? props.localLabel;
  };

  const handleDocClick = (e: MouseEvent) => {
    if (open() && rootRef && !rootRef.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("click", handleDocClick);
  onCleanup(() => document.removeEventListener("click", handleDocClick));

  const select = (id: string) => {
    props.onChange(id);
    setOpen(false);
    if (id !== LOCAL_WEB_TARGET_ID) {
      const remote = props.remotes.find((r) => r.remote_id === id);
      if (remote) void probeRemote(remote, { force: true });
    }
  };

  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-2 px-2 py-1.5 text-sm text-left border-none bg-transparent cursor-pointer ${
      active
        ? "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/8"
        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
    }`;

  return (
    <div ref={rootRef} class="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-primary)] cursor-pointer"
        aria-haspopup="listbox"
        aria-expanded={open()}
        title="pick where to send this"
      >
        <span class="truncate max-w-[140px]">{selectedLabel()}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      <Show when={open()}>
        <div
          class="absolute z-[1200] mt-1 min-w-44 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg shadow-xl py-1"
          role="listbox"
          aria-label="select target"
        >
          <button
            type="button"
            role="option"
            aria-selected={props.value === LOCAL_WEB_TARGET_ID}
            class={rowClass(props.value === LOCAL_WEB_TARGET_ID)}
            onClick={() => select(LOCAL_WEB_TARGET_ID)}
          >
            <Icon
              name="home"
              size={12}
              color={
                props.value === LOCAL_WEB_TARGET_ID
                  ? "var(--color-accent-500)"
                  : "var(--color-text-muted)"
              }
            />
            <span class="truncate">{props.localLabel}</span>
          </button>
          <For each={props.remotes}>
            {(remote) => {
              const active = () => props.value === remote.remote_id;
              const checking = () => isProbing(remote.remote_id)();
              const offline = () => !checking() && isOnline(remote.remote_id)() === false;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active()}
                  class={rowClass(active())}
                  classList={{ "opacity-60": offline() }}
                  onClick={() => select(remote.remote_id)}
                >
                  <span class="truncate flex-1">{remote.name ?? remote.remote_id}</span>
                  <Show when={checking()}>
                    <Icon
                      name="loader"
                      size={12}
                      className="animate-spin"
                      color="var(--color-text-muted)"
                    />
                  </Show>
                  <Show when={!checking() && offline()}>
                    <span class="text-[10px] text-[var(--color-text-muted)]">offline</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
