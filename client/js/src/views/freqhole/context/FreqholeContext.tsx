/* @jsxImportSource solid-js */
import { createContext, useContext, ParentComponent, JSX } from "solid-js";
// import { useFreqholeState } from "../hooks"; // TODO: Replace with new store
import type { UsePlayerQueueOptions } from "../hooks";

// Create the context
const FreqholeContext = createContext<any>(); // TODO: Type properly with new store

export interface FreqholeProviderProps {
  children: JSX.Element;
  options?: UsePlayerQueueOptions;
}

// Provider component
export const FreqholeProvider: ParentComponent<FreqholeProviderProps> = (
  props
) => {
  // TODO: Replace with new store
  const freqholeState = {}; // Temporary placeholder

  return (
    <FreqholeContext.Provider value={freqholeState}>
      {props.children}
    </FreqholeContext.Provider>
  );
};

// Hook to use the music player context (backwards compatibility)
export const useMusicPlayer = () => {
  const context = useContext(FreqholeContext);
  if (!context) {
    throw new Error("useMusicPlayer must be used within a FreqholeProvider");
  }
  return context.player;
};

// Hook to use the full freqhole state
export const useFreqhole = () => {
  const context = useContext(FreqholeContext);
  if (!context) {
    throw new Error("useFreqhole must be used within a FreqholeProvider");
  }
  return context;
};

// Export types for convenience
export type FreqholeContextType = any; // TODO: Type properly with new store
