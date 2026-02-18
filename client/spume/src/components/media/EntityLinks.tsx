// display component for entity URLs (read-only links)
import { For, Show } from "solid-js";
import { Icon, IconNames } from "../icons/registry";

interface EntityUrl {
  id?: string;
  name?: string;
  url: string;
}

interface EntityLinksProps {
  urls?: EntityUrl[] | null;
  class?: string;
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
  return (
    <Show when={props.urls && props.urls.length > 0}>
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
    </Show>
  );
}
