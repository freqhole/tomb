// reusable overlapping member avatar circles — used in header + read receipts
import { For, Show } from "solid-js";

export interface AvatarMember {
  node_id: string;
  display_name: string | null;
}

export interface MemberAvatarStackProps {
  members: AvatarMember[];
  /** max avatars to show before "+N" overflow (default 3) */
  max?: number;
  /** circle size in tailwind units: "4" → w-4 h-4 (default "5") */
  size?: "3" | "4" | "5" | "6";
  /** resolve avatar URL from display name */
  resolveAvatar?: (name: string | null) => string | null;
  /** set of online node_ids — shows green dot */
  onlineNodeIds?: Set<string>;
  /** show ring around each circle (default true) */
  ring?: boolean;
  /** tooltip on hover (default: member display_name) */
  title?: string;
  onClick?: () => void;
}

const sizeClasses: Record<string, { circle: string; text: string; dot: string; overlap: string }> =
  {
    "3": { circle: "w-3 h-3", text: "text-[6px]", dot: "w-1 h-1", overlap: "-space-x-1" },
    "4": { circle: "w-4 h-4", text: "text-[7px]", dot: "w-1.5 h-1.5", overlap: "-space-x-1" },
    "5": { circle: "w-5 h-5", text: "text-[8px]", dot: "w-2 h-2", overlap: "-space-x-1.5" },
    "6": { circle: "w-6 h-6", text: "text-[10px]", dot: "w-2 h-2", overlap: "-space-x-1.5" },
  };

export function MemberAvatarStack(props: MemberAvatarStackProps) {
  const s = () => sizeClasses[props.size ?? "5"];
  const max = () => props.max ?? 3;
  const showRing = () => props.ring !== false;
  const visible = () => props.members.slice(0, max());
  const overflow = () => Math.max(0, props.members.length - max());

  return (
    <div class={`flex items-center ${s().overlap}`} onClick={props.onClick} title={props.title}>
      <For each={visible()}>
        {(member) => (
          <div class="relative" title={member.display_name ?? undefined}>
            <div
              class={`${s().circle} rounded-full overflow-hidden bg-[var(--color-bg-tertiary)]`}
              classList={{ "ring-2 ring-[var(--color-bg-primary)]": showRing() }}
            >
              <Show
                when={props.resolveAvatar?.(member.display_name)}
                fallback={
                  <div
                    class={`w-full h-full flex items-center justify-center ${s().text} font-semibold text-[var(--color-text-tertiary)]`}
                  >
                    {(member.display_name ?? "?")[0].toUpperCase()}
                  </div>
                }
              >
                <img
                  src={props.resolveAvatar!(member.display_name)!}
                  alt={member.display_name ?? undefined}
                  class="w-full h-full object-cover"
                  loading="lazy"
                />
              </Show>
            </div>
            <Show when={props.onlineNodeIds?.has(member.node_id)}>
              <div
                class={`absolute -bottom-0.5 -right-0.5 ${s().dot} rounded-full bg-green-500 border border-[var(--color-bg-primary)]`}
              />
            </Show>
          </div>
        )}
      </For>
      <Show when={overflow() > 0}>
        <div
          class={`${s().circle} rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center`}
          classList={{ "ring-2 ring-[var(--color-bg-primary)]": showRing() }}
        >
          <span class={`${s().text} text-[var(--color-text-tertiary)]`}>+{overflow()}</span>
        </div>
      </Show>
    </div>
  );
}
