// floating detail card for a remote root node. shown when the user
// selects a remote hub in the graph. exposes admin-only tools like
// creating a new taxon under any taxon kind on that remote.
// pure presentational; parent positions it via a wrapper container.

import { For, Show, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { TaxonKind } from "freqhole-api-client";
import type { Remote } from "../../app/services/storage/schemas/remote";

export interface RemoteDetailPopoverProps {
  remote: Accessor<Remote | null>;
  canEdit: Accessor<boolean>;
  /** all taxon kinds on this remote (categorical + scalar, empty included). */
  taxonKinds: Accessor<TaxonKind[]>;
  onClose: () => void;
  /** create a new taxon under the given kind on the popover's remote. */
  onCreateTaxon: (kindSlug: string, label: string) => void;
  /** create a new taxon kind on the popover's remote. */
  onCreateKind: (input: { slug: string; label: string; color: string | null }) => void;
  /** navigate to the remote's default browse view (albums). */
  onBrowse?: () => void;
}

// derive a url-safe slug from a freeform label. matches the
// AlbumTaxonsEditor slugifier so users see consistent behavior.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function RemoteDetailPopover(props: RemoteDetailPopoverProps) {
  const [newLabel, setNewLabel] = createSignal("");
  const [newKind, setNewKind] = createSignal<string>("");
  const [busy, setBusy] = createSignal(false);

  // kind-creation form state. slug auto-derives from label until the
  // user edits it directly (slugDirty flips on first manual edit).
  const [showKindForm, setShowKindForm] = createSignal(false);
  const [newKindLabel, setNewKindLabel] = createSignal("");
  const [newKindSlug, setNewKindSlug] = createSignal("");
  const [newKindSlugDirty, setNewKindSlugDirty] = createSignal(false);
  const [newKindColor, setNewKindColor] = createSignal<string | null>(null);
  const [kindBusy, setKindBusy] = createSignal(false);

  const effectiveKindSlug = () => (newKindSlugDirty() ? newKindSlug() : slugify(newKindLabel()));

  // categorical kinds only — scalars (bpm, loudness_db) cannot accept
  // arbitrary user-defined taxons.
  const categoricalKinds = () => props.taxonKinds().filter((k) => k.value_type === "categorical");

  const baseUrl = () => {
    const r = props.remote();
    if (!r) return undefined;
    return "base_url" in r ? r.base_url : undefined;
  };

  const handleSubmit = () => {
    const label = newLabel().trim();
    const kindSlug = newKind() || categoricalKinds()[0]?.slug;
    if (!label || !kindSlug) return;
    setBusy(true);
    try {
      props.onCreateTaxon(kindSlug, label);
      setNewLabel("");
    } finally {
      setBusy(false);
    }
  };

  const resetKindForm = () => {
    setNewKindLabel("");
    setNewKindSlug("");
    setNewKindSlugDirty(false);
    setNewKindColor(null);
    setShowKindForm(false);
  };

  const handleSubmitKind = () => {
    const label = newKindLabel().trim();
    const slug = effectiveKindSlug().trim();
    if (!label || !slug) return;
    setKindBusy(true);
    try {
      props.onCreateKind({ slug, label, color: newKindColor() });
      resetKindForm();
    } finally {
      setKindBusy(false);
    }
  };

  return (
    <Show when={props.remote()}>
      <div
        class="rounded-lg bg-[var(--color-bg-elevated)] border border-white/10 shadow-xl text-[var(--color-text)] w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-var(--nav-height,56px)-var(--player-bar-height,0px)-3.5rem)] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header: name */}
        <div class="flex items-start gap-2 p-3 pb-2">
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-sm leading-tight truncate">
              {props.remote()?.name ?? "remote"}
            </div>
            <Show when={baseUrl()}>
              <div class="mt-0.5 text-[10px] text-white/40 truncate" title={baseUrl()}>
                {baseUrl()}
              </div>
            </Show>
          </div>
        </div>

        {/* body */}
        <div class="px-3 pb-3 flex flex-col gap-2 text-xs text-white/65">
          <Show when={props.onBrowse}>
            <button
              type="button"
              class="w-full py-1.5 px-3 rounded text-xs font-medium border border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-100 hover:text-white transition-colors cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                props.onBrowse?.();
              }}
            >
              browse albums
            </button>
          </Show>

          {/* admin tools */}
          <Show when={props.canEdit()}>
            <div class="mt-2 pt-2 border-t border-white/10 flex flex-col gap-2">
              {/* add taxon (requires at least one categorical kind) */}
              <Show when={categoricalKinds().length > 0}>
                <div class="flex flex-col gap-1.5">
                  <div class="text-[10px] uppercase tracking-wide text-white/40">
                    admin: add taxon
                  </div>
                  <select
                    class="w-full px-2 py-1 rounded text-xs bg-white/5 border border-white/15 text-white/85 focus:outline-none focus:border-white/30 cursor-pointer"
                    value={newKind() || categoricalKinds()[0]?.slug || ""}
                    onChange={(e) => setNewKind((e.currentTarget as HTMLSelectElement).value)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <For each={categoricalKinds()}>
                      {(kind) => <option value={kind.slug}>{kind.label || kind.slug}</option>}
                    </For>
                  </select>
                  <input
                    type="text"
                    class="w-full px-2 py-1 rounded text-xs bg-white/5 border border-white/15 text-white/85 placeholder-white/30 focus:outline-none focus:border-white/30"
                    placeholder="new taxon label"
                    value={newLabel()}
                    onInput={(e) => setNewLabel((e.currentTarget as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSubmit();
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={busy()}
                  />
                  <button
                    type="button"
                    class="w-full py-1.5 px-3 rounded text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 hover:text-emerald-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={busy() || newLabel().trim().length === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSubmit();
                    }}
                  >
                    + add taxon
                  </button>
                </div>
              </Show>

              {/* add taxon kind: collapsed into a toggle so the form
                  doesn't clutter the panel until the admin wants it. */}
              <div class="flex flex-col gap-1.5">
                <Show
                  when={showKindForm()}
                  fallback={
                    <button
                      type="button"
                      class="w-full py-1.5 px-3 rounded text-xs font-medium border border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/25 text-white/80 hover:text-white transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowKindForm(true);
                      }}
                    >
                      + add taxon kind
                    </button>
                  }
                >
                  <div class="text-[10px] uppercase tracking-wide text-white/40">
                    admin: add taxon kind
                  </div>
                  <input
                    type="text"
                    class="w-full px-2 py-1 rounded text-xs bg-white/5 border border-white/15 text-white/85 placeholder-white/30 focus:outline-none focus:border-white/30"
                    placeholder="kind label (e.g. mood)"
                    value={newKindLabel()}
                    onInput={(e) => setNewKindLabel((e.currentTarget as HTMLInputElement).value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={kindBusy()}
                  />
                  <input
                    type="text"
                    class="w-full px-2 py-1 rounded text-xs bg-white/5 border border-white/15 text-white/85 placeholder-white/30 focus:outline-none focus:border-white/30"
                    placeholder="slug (auto from label)"
                    value={effectiveKindSlug()}
                    onInput={(e) => {
                      setNewKindSlugDirty(true);
                      setNewKindSlug((e.currentTarget as HTMLInputElement).value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    disabled={kindBusy()}
                  />
                  <div class="flex items-center gap-1.5">
                    <label class="text-[10px] uppercase tracking-wide text-white/40">color</label>
                    <input
                      type="color"
                      value={newKindColor() ?? "#888888"}
                      class="w-6 h-6 rounded-sm border border-white/15 bg-transparent cursor-pointer p-0"
                      onClick={(e) => e.stopPropagation()}
                      onInput={(e) => setNewKindColor((e.currentTarget as HTMLInputElement).value)}
                    />
                    <Show when={newKindColor()}>
                      <button
                        type="button"
                        class="text-[10px] leading-none px-1.5 py-0.5 rounded border border-white/15 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 cursor-pointer transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setNewKindColor(null);
                        }}
                      >
                        clear
                      </button>
                    </Show>
                  </div>
                  <div class="flex gap-1.5">
                    <button
                      type="button"
                      class="flex-1 py-1.5 px-3 rounded text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 hover:text-emerald-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={
                        kindBusy() ||
                        newKindLabel().trim().length === 0 ||
                        effectiveKindSlug().trim().length === 0
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSubmitKind();
                      }}
                    >
                      create kind
                    </button>
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded text-xs font-medium border border-white/15 bg-white/5 hover:bg-white/10 text-white/65 hover:text-white/85 transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetKindForm();
                      }}
                    >
                      cancel
                    </button>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
