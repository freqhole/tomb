import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { VirtualVariableList } from "../src/components/virtualized/VirtualVariableList";
import { generateEndlessMessages, type GossipMessage } from "./gossip/mockGossipData";

// render a gossip message as a card with variable height —
// text wraps to multiple lines, attachments render as a block
function SimpleMessageRow(props: { message: GossipMessage }) {
  const parsed = () => {
    try {
      return JSON.parse(props.message.payload);
    } catch {
      return { text: props.message.payload || "(empty)", items: [] };
    }
  };

  return (
    <div style={{ padding: "8px 12px" }}>
      <div style={{ display: "flex", gap: "8px", "align-items": "baseline" }}>
        <span style={{ "font-weight": "600", "font-size": "13px", color: "#eee" }}>
          {props.message.sender_name ?? "unknown"}
        </span>
        <span style={{ "font-size": "10px", color: "#666" }}>
          {new Date(props.message.timestamp * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      {/* text — wraps naturally, so longer messages = taller rows */}
      <div
        style={{
          "font-size": "13px",
          color: "#bbb",
          "margin-top": "4px",
          "line-height": "1.5",
          "word-wrap": "break-word",
          "overflow-wrap": "break-word",
          "white-space": "pre-wrap",
        }}
      >
        {parsed().text || ""}
      </div>
      {/* attachment cards — adds height for messages with refs */}
      {parsed().items?.length > 0 && (
        <div
          style={{ "margin-top": "6px", display: "flex", "flex-direction": "column", gap: "4px" }}
        >
          {parsed().items.map((item: any) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "8px",
                padding: "6px 10px",
                "border-radius": "6px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span style={{ "font-size": "10px", color: "#888", "text-transform": "uppercase" }}>
                {item.ref_type}
              </span>
              <span style={{ "font-size": "12px", color: "#ccc" }}>
                {item.title ?? item.name ?? item.remote_id}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* reactions row — more height variation */}
      {(props.message.reactions?.length ?? 0) > 0 && (
        <div style={{ "margin-top": "4px", display: "flex", gap: "4px" }}>
          {props.message.reactions!.map((r) => (
            <span
              style={{
                "font-size": "12px",
                padding: "2px 6px",
                "border-radius": "10px",
                background: "rgba(255,255,255,0.06)",
              }}
            >
              {r.emoji}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const meta = {
  title: "Components/Virtualized/VirtualVariableList",
  component: VirtualVariableList,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ width: "520px", height: "650px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VirtualVariableList>;

export default meta;
type Story = StoryObj<typeof meta>;

// endless scroll — scroll to top to load more pages with simulated latency
function EndlessScrollDemo() {
  const [page, setPage] = createSignal(0);
  const [messages, setMessages] = createSignal<GossipMessage[]>(generateEndlessMessages(0));
  const [loadingMore, setLoadingMore] = createSignal(false);

  const handleLoadMore = () => {
    if (loadingMore()) return;
    setLoadingMore(true);
    const nextPage = page() + 1;
    // simulate network latency
    setTimeout(() => {
      const older = generateEndlessMessages(nextPage);
      setMessages((prev) => [...older, ...prev]);
      setPage(nextPage);
      setLoadingMore(false);
    }, 1200);
  };

  return (
    <VirtualVariableList
      items={messages()}
      getItemKey={(msg: GossipMessage) => msg.message_id}
      listId="endless-scroll-demo"
      loadingMore={loadingMore()}
      onLoadMore={handleLoadMore}
    >
      {(msg: GossipMessage) => <SimpleMessageRow message={msg} />}
    </VirtualVariableList>
  );
}

export const Default: Story = {
  render: () => <EndlessScrollDemo />,
};

// empty list
export const Empty: Story = {
  name: "empty list",
  args: {
    items: [],
    getItemKey: (msg: GossipMessage) => msg.message_id,
    listId: "empty",
    children: (msg: GossipMessage) => <SimpleMessageRow message={msg} />,
  },
};
