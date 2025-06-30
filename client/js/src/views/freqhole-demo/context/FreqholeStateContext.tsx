import {
  createContext,
  useContext,
  ParentComponent,
  createMemo,
} from "solid-js";
import {
  useFreqholeState,
  type FreqholeStateProps,
  type FreqholeStateHook,
} from "../hooks/useFreqholeState";
import { useSelection, type SelectionHook } from "../hooks/useSelection";
import { useFreqholeData } from "../hooks/useFreqholeData";
import { useWebSocketFeed } from "../../../hooks/useWebSocketFeed";
import type { NotificationChannel } from "../../../lib/websocket-types";

// Combined context type that includes state, selection, and shared data hooks
export interface FreqholeAppContext {
  state: FreqholeStateHook;
  selection: SelectionHook;
  addLog: (message: string) => void;
}

// Create the context
const FreqholeStateContext = createContext<FreqholeAppContext>();

// Provider component
export interface FreqholeStateProviderProps extends FreqholeStateProps {
  children: any;
}

export const FreqholeStateProvider: ParentComponent<
  FreqholeStateProviderProps
> = (props) => {
  // Create the state hook instance
  const state = useFreqholeState({
    wsUrl: props.wsUrl,
    autoConnect: props.autoConnect,
  });

  // Set up the same hooks for data and feed (needed for selection initialization)
  const feed = useWebSocketFeed({
    wsUrl: state.wsUrl(),
    channels: ["MediaBlobs"] as NotificationChannel[],
    debug: state.debug(),
    autoConnect: state.autoConnect(),
    autoRefresh: state.autoRefresh() ?? true,
    pageSize: 50,
  });

  const data = useFreqholeData({
    items: () => feed.state().items,
    filterConfig: state.filterConfig,
    sortConfig: state.sortConfig,
  });

  // Helper function for logging
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const currentLogs = state.logs();
    state.setLogs([`${timestamp}: ${message}`, ...currentLogs.slice(0, 49)]);

    // Also log to console when debug mode is enabled
    if (state.debug()) {
      console.log(`[FreqholeDemo] ${timestamp}: ${message}`);
    }
  };

  // Load initial state for selection
  const initialState = state.loadState();

  // Selection hook with storage integration
  const selection = useSelection({
    onSelectionChange: (selectedItems) => {
      // Auto-save selection changes
      state.saveState({ selectedItems });
    },
    onDelete: (selectedItems) => {
      const items = data
        .sortedData()
        .filter((item) => selectedItems.has(item.id));
      state.setConfirmDialog({
        isOpen: true,
        title: "Delete Selected Files",
        message: `Delete ${items.length} selected file${items.length !== 1 ? "s" : ""}?`,
        items: items,
        onConfirm: () => {
          // TODO: Implement actual delete API call
          addLog(`🗑️ Deleted ${items.length} selected items`);
          selection.clearSelection();
          state.setConfirmDialog(null);
        },
      });
    },
    saveToStorage: (_selectedItems) => {
      // Already handled by onSelectionChange
    },
    initialSelection: new Set(
      initialState.selectedItems
        ? Array.from(initialState.selectedItems || [])
        : []
    ),
  });

  const contextValue = createMemo(() => ({
    state,
    selection,
    addLog,
  }));

  return (
    <FreqholeStateContext.Provider value={contextValue()}>
      {props.children}
    </FreqholeStateContext.Provider>
  );
};

// Hook to consume the full context (state + selection)
export function useFreqholeAppContext(): FreqholeAppContext {
  const context = useContext(FreqholeStateContext);
  if (!context) {
    throw new Error(
      "useFreqholeAppContext must be used within a FreqholeStateProvider"
    );
  }
  return context;
}

// Hook to consume just the state (for backward compatibility)
export function useFreqholeStateContext(): FreqholeStateHook {
  const context = useFreqholeAppContext();
  return context.state;
}

// Hook to consume just the selection
export function useFreqholeSelectionContext(): SelectionHook {
  const context = useFreqholeAppContext();
  return context.selection;
}

// Export the context for advanced use cases
export { FreqholeStateContext };
