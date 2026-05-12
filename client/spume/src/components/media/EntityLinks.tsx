// display component for entity URLs (read-only links)
import { createSignal, For, Show } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import type { EntityUrl } from "../../music/data/types";

interface EntityLinksProps {
  urls?: EntityUrl[] | null;
  class?: string;
  // when true, caps the link row at ~2 lines on all breakpoints and
  // shows a "see more" toggle when the content overflows.
  collapsible?: boolean;
}

// extract a display label from a URL if no name is provided
function getLinkLabel(entityUrl: EntityUrl): string {
  if (entityUrl.name) return entityUrl.name;
  try {
    const hostname = new URL(entityUrl.url).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return entityUrl.url;
  }
}

export function EntityLinks(props: EntityLinksProps) {
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);

  return (
    <Show when={props.urls && props.urls.length > 0}>
      <Show
        when={props.collapsible}
        fallback={
          <div class={`flex flex-wrap gap-1.5 ${props.class || ""}`}>
            <For each={props.urls!}>
              {(entityUrl) => (
                <a
                  href={entityUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded-full text-xs transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  title={entityUrl.url}
                >
                  <Icon name={IconNames.externalLink} size={12} />
                  {getLinkLabel(entityUrl)}
                </a>
              )}
            </For>
          </div>
        }
      >
        <div>
          <div
            ref={(el) => {
              const check = () => {
                if (!expanded()) {
                  setOverflowing(el.scrollHeight > el.clientHeight);
                }
              };
              requestAnimationFrame(check);
              const obs = new ResizeObserver(check);
              obs.observe(el);
            }}
            class={`flex flex-wrap gap-1.5 ${props.class || ""} ${
              !expanded() ? "max-h-[3.25rem] overflow-hidden" : ""
            }`}
          >
            <For each={props.urls!}>
              {(entityUrl) => (
                <a
                  href={entityUrl.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] rounded-full text-xs transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  title={entityUrl.url}
                >
                  <Icon name={IconNames.externalLink} size={12} />
                  {getLinkLabel(entityUrl)}
                </a>
              )}
            </For>
          </div>
          <Show when={overflowing() || expanded()}>
            <button
              onClick={() => setExpanded((v) => !v)}
              class="pb-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            >
              {expanded() ? "see less" : "see more"}
            </button>
          </Show>
        </div>
      </Show>
    </Show>
  );
}
