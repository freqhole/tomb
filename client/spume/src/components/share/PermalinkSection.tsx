// permalink section of the share modal.
// renders the freqhole:// deep link and the https:// web mirror with copy buttons.
// always visible — both urls work regardless of which transports the source has;
// the encoder validates the source has at least a node id or http origin.

import { createMemo, Show, type Component } from "solid-js";
import { CopyButton } from "../buttons/CopyButton";
import { buildShareUrls } from "../../utils/permalink";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { buildSharePayload } from "./buildSharePayload";
import type { ShareTarget } from "./types";

export interface PermalinkSectionProps {
  target: ShareTarget;
  source: Remote;
  /** override the default web host (e.g. for self-hosters). */
  webHost?: string;
}

export const PermalinkSection: Component<PermalinkSectionProps> = (props) => {
  // memoize so we don't re-encode on every render — encoding is cheap but
  // re-running it would invalidate the copy-button's idle/copied state if
  // the parent re-renders for unrelated reasons.
  const urls = createMemo(() => {
    try {
      const payload = buildSharePayload(props.target, props.source);
      return { ok: true as const, urls: buildShareUrls(payload, props.webHost) };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

  return (
    <section class="space-y-3">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">permalink</h3>
      <Show
        when={urls().ok}
        fallback={
          <p class="text-sm text-[var(--color-text-tertiary)]">
            {urls().ok === false ? urls().error : ""}
          </p>
        }
      >
        {(_) => {
          const u = () => (urls() as { ok: true; urls: ReturnType<typeof buildShareUrls> }).urls;
          return (
            <div class="space-y-2">
              <PermalinkRow label="app" value={u().appUrl} />
              <PermalinkRow label="web" value={u().webUrl} />
            </div>
          );
        }}
      </Show>
    </section>
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
