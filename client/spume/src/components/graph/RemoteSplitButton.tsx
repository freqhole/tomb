// small split-button used by the album / artist detail popovers when
// the same entity exists on multiple remotes. main click invokes
// onPick with the default remote's id (first entry — parent should
// sort with the preferred remote first, typically charnel-managed);
// the chevron toggles a dropdown listing every contributor so the
// user can route the action (edit / open) to a specific remote.
//
// when remotes is undefined or has <= 1 entry, this renders as a
// plain ActionButton-equivalent and invokes onPick with the single
// remote's id (or undefined when the list is empty).

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Icon, type IconName } from "../icons/registry";

export type ContributingRemote = {
  id: string;
  name: string;
  isCharnelManaged?: boolean;
  /** absolute or remote-resolved image url for the remote avatar.
   *  rendered as a small thumbnail in the dropdown row; falls back to
   *  a colored initial when null/missing. */
  imageUrl?: string | null;
};

export interface RemoteSplitButtonProps {
  icon: IconName;
  label: string;
  /** ordered list of contributing remotes — first entry is the default.
   *  parent owns the sort order (charnel-managed first is the
   *  convention). when undefined or length <= 1, falls back to a
   *  plain button. */
  remotes?: ContributingRemote[];
  /** invoked with the picked remote's id (or undefined for the empty
   *  list edge case). parent decides how to resolve undefined. */
  onPick: (remoteId?: string) => void;
}

export function RemoteSplitButton(props: RemoteSplitButtonProps) {
  const [open, setOpen] = createSignal(false);
  const list = (): ContributingRemote[] => props.remotes ?? [];
  const isMulti = () => list().length > 1;
  const defaultRemote = () => list()[0];

  // viewport-clamp state: horizontal shift (px) + flip-above flag.
  // recomputed every time the menu opens (and on window resize while
  // open) so it stays inside the viewport when the popover is near
  // any edge of the window.
  let containerRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  const [shift, setShift] = createSignal<{ x: number; flip: boolean }>({ x: 0, flip: false });

  const recomputeShift = () => {
    if (!menuRef) return;
    // reset transforms before measuring so we get the untransformed rect.
    menuRef.style.transform = "";
    const rect = menuRef.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 6;
    let x = 0;
    if (rect.right > vw - pad) x -= rect.right - (vw - pad);
    if (rect.left + x < pad) x += pad - (rect.left + x);
    const flip =
      rect.bottom > vh - pad && containerRef
        ? containerRef.getBoundingClientRect().top > rect.height + pad
        : false;
    setShift({ x, flip });
  };

  createEffect(() => {
    if (!open()) {
      setShift({ x: 0, flip: false });
      return;
    }
    // measure after current paint so the menu has a layout box.
    queueMicrotask(recomputeShift);
    const onResize = () => recomputeShift();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    });
  });

  // outside-click closes the menu.
  createEffect(() => {
    if (!open()) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef) return;
      if (!containerRef.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    onCleanup(() => document.removeEventListener("mousedown", onDocClick));
  });

  return (
    <div ref={containerRef} class="relative inline-flex">
      <Show
        when={isMulti()}
        fallback={
          <button
            type="button"
            class="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[11px] text-white/80 hover:text-white hover:bg-white/5 hover:border-white/20 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              props.onPick(defaultRemote()?.id);
            }}
          >
            <Icon name={props.icon} size={12} />
            <span>{props.label}</span>
          </button>
        }
      >
        <div class="inline-flex rounded border border-white/10 overflow-hidden">
          <button
            type="button"
            title={`${props.label} on ${defaultRemote()?.name ?? ""}`}
            class="flex items-center gap-1 px-2 py-1 text-[11px] text-white/80 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              props.onPick(defaultRemote()?.id);
            }}
          >
            <Icon name={props.icon} size={12} />
            <span>{props.label}</span>
          </button>
          <button
            type="button"
            title="choose remote"
            aria-label="choose remote"
            aria-haspopup="menu"
            aria-expanded={open()}
            class="flex items-center gap-0.5 px-1.5 py-1 text-white/75 hover:text-white hover:bg-white/5 border-l border-white/10 transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <span class="text-[10px] font-medium tabular-nums">{list().length}</span>
            <Icon name="chevronDown" size={10} />
          </button>
        </div>
        <Show when={open()}>
          <div
            ref={menuRef}
            role="menu"
            class="absolute z-30 right-0 min-w-[12rem] max-w-[min(20rem,calc(100vw-1rem))] rounded border border-white/15 bg-[var(--color-bg-elevated)] shadow-lg py-1 max-h-[min(20rem,calc(100vh-2rem))] overflow-y-auto"
            classList={{
              "top-full mt-1": !shift().flip,
              "bottom-full mb-1": shift().flip,
            }}
            style={shift().x !== 0 ? { transform: `translateX(${shift().x}px)` } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <For each={list()}>
              {(r) => (
                <button
                  type="button"
                  role="menuitem"
                  class="w-full text-left flex items-center gap-2 px-2 py-1 text-[11px] text-white/85 hover:bg-white/10 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    props.onPick(r.id);
                  }}
                >
                  <RemoteAvatar remote={r} />
                  <span class="flex-1 truncate">{r.name}</span>
                  <Show when={r.isCharnelManaged}>
                    <span class="text-[9px] uppercase tracking-wide text-emerald-300/80">
                      local
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// small 16px thumbnail used in the remote-picker dropdown. tries the
// remote's image_url; if it fails to load or is missing, falls back to
// a colored initial tile (first letter of the remote name).
function RemoteAvatar(props: { remote: ContributingRemote }) {
  const [failed, setFailed] = createSignal(false);
  const initial = () => {
    const ch = props.remote.name.trim().charAt(0).toUpperCase();
    return ch || "?";
  };
  return (
    <Show
      when={props.remote.imageUrl && !failed()}
      fallback={
        <span
          aria-hidden="true"
          class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/10 text-white/70 text-[9px] font-semibold shrink-0"
        >
          {initial()}
        </span>
      }
    >
      <img
        src={props.remote.imageUrl!}
        alt=""
        aria-hidden="true"
        class="w-4 h-4 rounded-full object-cover shrink-0"
        onError={() => setFailed(true)}
      />
    </Show>
  );
}
