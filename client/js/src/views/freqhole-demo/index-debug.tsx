/* @jsxImportSource solid-js */
import { createSignal, createMemo } from "solid-js";
import type { MediaBlob } from "../../lib/websocket-types";
import { useFreqholeState } from "./hooks/useFreqholeState";
import { useFreqholeData } from "./hooks/useFreqholeData";
import { useWebSocketFeed } from "../../hooks/useWebSocketFeed";
import type { NotificationChannel } from "../../lib/websocket-types";
import { useViewModes } from "./hooks/useViewModes";
import { useResponsiveColumns } from "./hooks/useResponsiveColumns";
import { useSelection } from "./hooks/useSelection";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";

export interface FreqholeDemoProps {
  wsUrl: string;
  apiBaseUrl: string;
  autoConnect: boolean;
}

export function FreqholeDemo(props: FreqholeDemoProps) {
  // Test useFreqholeState hook
  const state = useFreqholeState({
    wsUrl: props.wsUrl,
    autoConnect: props.autoConnect,
  });

  // Super minimal state to test
  const [items, setItems] = createSignal<MediaBlob[]>([]);

  // Test useWebSocketFeed hook
  const feed = useWebSocketFeed({
    wsUrl: state.wsUrl(),
    channels: ["MediaBlobs"] as NotificationChannel[],
    debug: state.debug(),
    autoConnect: state.autoConnect(),
    autoRefresh: state.autoRefresh(),
    pageSize: 50,
  });

  // Test view mode hooks
  const initialState = state.loadState();
  const viewModes = useViewModes((initialState.viewMode as any) || "default");

  // Test responsive columns hook
  const responsiveColumns = useResponsiveColumns({
    baseColumnVisibility: () => state.columnVisibility(),
  });

  // Test selection hook
  const selection = useSelection({
    onSelectionChange: (selectedItems) => {
      state.saveState({ selectedItems });
    },
    onDelete: (selectedItems) => {
      console.log("Delete:", selectedItems);
    },
    saveToStorage: () => {},
    initialSelection: new Set(),
  });

  // Test keyboard navigation hook
  const keyboardNav = useKeyboardNavigation({
    onPreview: () => {},
    onToggleSelection: () => {},
    onSelectAll: () => {},
    onClearSelection: () => {},
    onEscape: () => {},
    onDelete: () => {},
    isTextInputFocused: () => false,
    getSelectedItems: () => selection.selectedItems(),
    getAllItems: () => data.sortedData(),
    onLog: () => {},
  });

  // Test useFreqholeData hook with the feed items
  const data = useFreqholeData({
    items: () => feed.state().items,
    filterConfig: state.filterConfig,
    sortConfig: state.sortConfig,
  });

  // Test if this basic memo causes issues
  const itemCount = createMemo(() => items().length);

  return (
    <div
      style={`
        height: 100vh;
        background: #000000;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      `}
    >
      <h1>FreqholeDemo Debug Mode</h1>
      <p>Props: {JSON.stringify(props)}</p>
      <p>Item count: {itemCount()}</p>
      <p>State wsUrl: {state.wsUrl()}</p>
      <p>Feed items: {feed.state().items.length}</p>
      <p>Connection: {feed.state().connectionStatus}</p>
      <p>Filtered count: {data.filteredData().length}</p>
      <p>View mode: {viewModes.viewMode()}</p>
      <p>Screen width: {responsiveColumns.screenWidth()}</p>
      <p>Selected items: {selection.selectedItems().size}</p>
      <p>Focused index: {keyboardNav.focusedIndex()}</p>
      <p>
        Testing ALL hooks - if you see this, they're working! The recursion must
        be in the JSX/components!
      </p>
      <button
        onClick={() =>
          setItems([
            {
              id: "test",
              blob_type: "original" as const,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sha256: "test-hash",
              metadata: {},
            },
          ])
        }
      >
        Add Test Item
      </button>
    </div>
  );
}
