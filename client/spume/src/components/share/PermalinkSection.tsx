// permalink section of the share modal.
// renders the freqhole:// deep link and the https:// web mirror with copy
// buttons, for whichever remote's node id is currently selected.
//
// "whichever remote" because a share's source isn't always the right (or
// even a valid) node id to embed - see permalinkCandidates.ts's doc
// comment for the full reasoning (local-library reachability on
// android/ios/a plain browser tab, and checking other remotes for
// partial/full content matches). this section renders nothing at all
// once candidate resolution settles on zero options - there's simply
// nothing safe to link to.

import { createEffect, createMemo, createSignal, on, Show, type Component } from "solid-js";
import { CopyButton } from "../buttons/CopyButton";
import { Select } from "../forms/Select";
import { buildShareUrls } from "../../utils/permalink";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { buildSharePayload } from "./buildSharePayload";
import { createPermalinkCandidates, type PermalinkCandidate } from "./permalinkCandidates";
import type { ShareTarget } from "./types";
import type { SendToRemotePayload } from "./SendToRemoteSection";

export interface PermalinkSectionProps {
  target: ShareTarget;
  source: Remote;
  /** same lazy payload builder ShareModal passes to SendToRemoteSection -
   *  omit entirely for share targets with nothing to probe (artist,
   *  radio_station), which keeps this section's older source-only
   *  behavior (see permalinkCandidates.ts). */
  buildSendPayload?: () => SendToRemotePayload | Promise<SendToRemotePayload>;
  /** override the default web host (e.g. for self-hosters). */
  webHost?: string;
}

function candidateOptionLabel(c: PermalinkCandidate): string {
  if (!c.presence) return c.label;
  return `${c.label} (${c.presence.present}/${c.presence.total})`;
}

export const PermalinkSection: Component<PermalinkSectionProps> = (props) => {
  const { candidates, loading } = createPermalinkCandidates({
    source: () => props.source,
    targetKind: props.target.kind,
    buildPayload: props.buildSendPayload ? () => props.buildSendPayload!() : undefined,
  });

  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  // default to the first (highest-priority) candidate whenever the list
  // changes shape, but only if the user hasn't picked something that's
  // still in the list - avoids silently yanking a deliberate selection
  // out from under the user if an unrelated probe resolves and reorders
  // the list.
  createEffect(
    on(candidates, (list) => {
      if (list.length === 0) {
        setSelectedId(null);
        return;
      }
      if (!list.some((c) => c.remote.remote_id === selectedId())) {
        setSelectedId(list[0].remote.remote_id);
      }
    })
  );

  const selected = createMemo<PermalinkCandidate | null>(() => {
    const list = candidates();
    return list.find((c) => c.remote.remote_id === selectedId()) ?? list[0] ?? null;
  });

  const urls = createMemo<{ ok: true; webUrl: string } | { ok: false; error: string } | null>(
    () => {
      const c = selected();
      if (!c) return null;
      try {
        // non-source candidates carry this remote's own id for the shared
        // entity (and, for songs, its own parent album id) - target.id
        // is only ever valid on the source remote (see permalinkCandidates.ts).
        const target = c.resolvedTarget
          ? { ...props.target, id: c.resolvedTarget.id, parentId: c.resolvedTarget.parentId }
          : props.target;
        const payload = buildSharePayload(target, c.remote);
        return { ok: true, webUrl: buildShareUrls(payload, props.webHost).webUrl };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  );

  return (
    <Show when={selected() || loading()}>
      <section class="space-y-3">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">permalink</h3>
        <Show
          when={selected()}
          fallback={
            <p class="text-sm text-[var(--color-text-tertiary)]">
              checking for a shareable copy elsewhere...
            </p>
          }
        >
          <Select
            options={candidates().map((c) => ({
              value: c.remote.remote_id,
              label: candidateOptionLabel(c),
            }))}
            value={selectedId() ?? undefined}
            disabled={candidates().length <= 1}
            onInput={(e) => setSelectedId(e.currentTarget.value)}
          />
          <Show
            when={urls()?.ok}
            fallback={
              <p class="text-sm text-[var(--color-text-tertiary)]">
                {urls() && !urls()!.ok ? (urls() as { ok: false; error: string }).error : ""}
              </p>
            }
          >
            <div class="space-y-2">
              <PermalinkRow label="web" value={(urls() as { ok: true; webUrl: string }).webUrl} />
            </div>
          </Show>
        </Show>
      </section>
    </Show>
  );
};

// ---- internal --------------------------------------------------------------

interface RowProps {
  label: string;
  value: string;
}
const PermalinkRow: Component<RowProps> = (props) => {
  return (
    <div class="flex items-center gap-2">
      <span class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)] w-8 flex-shrink-0">
        {props.label}
      </span>
      <input
        type="text"
        readOnly
        value={props.value}
        onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
        class="flex-1 min-w-0 px-2 py-1 text-xs font-mono bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] truncate"
      />
      <CopyButton
        text={props.value}
        class="px-3 py-1 text-xs rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] transition-colors flex-shrink-0"
      />
    </div>
  );
};
