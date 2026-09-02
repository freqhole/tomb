// GraphDomainFilter
//
// small toggle-chip control for the graph topnav's `extra` slot: lets the
// user show/hide the music domain (albums/artists) and video domain
// (videos/series) independently. modeled on GraphTopNavTools' own
// IconBtn styling so it reads as part of the same control cluster.
// see docs/graph-viz-video-domain-plan.md phase 3.

import { Icon } from "../../../components/icons/registry";

export type GraphDomain = "music" | "video";

export interface GraphDomainFilterProps {
  active: () => Set<GraphDomain>;
  onToggle: (domain: GraphDomain) => void;
}

export function GraphDomainFilter(props: GraphDomainFilterProps) {
  return (
    <div class="flex items-center gap-0.5 flex-nowrap flex-shrink-0">
      <DomainChip
        icon="headphones"
        label="music"
        active={props.active().has("music")}
        onClick={() => props.onToggle("music")}
      />
      <DomainChip
        icon="video"
        label="video"
        active={props.active().has("video")}
        onClick={() => props.onToggle("video")}
      />
    </div>
  );
}

function DomainChip(props: {
  icon: "headphones" | "video";
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="inline-flex items-center justify-center w-7 h-7 rounded transition-colors border-none bg-transparent cursor-pointer flex-shrink-0"
      classList={{
        "text-[var(--color-accent-500,#ff1a9e)] bg-[var(--color-accent-500,#ff1a9e)]/15":
          props.active,
        "text-white/65 hover:text-white hover:bg-white/10": !props.active,
      }}
      onClick={() => props.onClick()}
      title={`show ${props.label}`}
      aria-label={`toggle ${props.label} domain`}
      aria-pressed={props.active}
    >
      <Icon name={props.icon} size={14} />
    </button>
  );
}
