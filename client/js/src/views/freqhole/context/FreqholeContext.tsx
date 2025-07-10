/* @jsxImportSource solid-js */
import { createContext, useContext, ParentComponent, JSX } from "solid-js";
import { usePlayerQueue } from "../hooks";
import type { UsePlayerQueueOptions } from "../hooks";

// Create the context
const FreqholeContext = createContext<ReturnType<typeof usePlayerQueue>>();

export interface FreqholeProviderProps {
  children: JSX.Element;
  options?: UsePlayerQueueOptions;
}

// Provider component
export const FreqholeProvider: ParentComponent<FreqholeProviderProps> = (
  props
) => {
  const playerQueue = usePlayerQueue(
    props.options || {
      initialVolume: 0.5,
      autoNext: true,
    }
  );

  return (
    <FreqholeContext.Provider value={playerQueue}>
      {props.children}
    </FreqholeContext.Provider>
  );
};

// Hook to use the music player context
export const useMusicPlayer = () => {
  const context = useContext(FreqholeContext);
  if (!context) {
    throw new Error("useMusicPlayer must be used within a FreqholeProvider");
  }
  return context;
};

// Export types for convenience
export type FreqholeContextType = ReturnType<typeof usePlayerQueue>;
