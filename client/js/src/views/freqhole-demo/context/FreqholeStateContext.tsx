/* @jsxImportSource solid-js */
import { createContext, useContext, ParentComponent } from "solid-js";
import { useFreqholeState, type FreqholeStateProps, type FreqholeStateHook } from "../hooks/useFreqholeState";

// Create the context
const FreqholeStateContext = createContext<FreqholeStateHook>();

// Provider component
export interface FreqholeStateProviderProps extends FreqholeStateProps {
  children: any;
}

export const FreqholeStateProvider: ParentComponent<FreqholeStateProviderProps> = (props) => {
  // Create the state hook instance
  const state = useFreqholeState({
    wsUrl: props.wsUrl,
    autoConnect: props.autoConnect,
  });

  return (
    <FreqholeStateContext.Provider value={state}>
      {props.children}
    </FreqholeStateContext.Provider>
  );
};

// Hook to consume the context
export function useFreqholeStateContext(): FreqholeStateHook {
  const context = useContext(FreqholeStateContext);
  if (!context) {
    throw new Error("useFreqholeStateContext must be used within a FreqholeStateProvider");
  }
  return context;
}

// Export the context for advanced use cases
export { FreqholeStateContext };
