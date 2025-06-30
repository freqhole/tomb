import { BrowsePanel } from "./BrowsePanel";

import { FilterOnlyPanel } from "./components/FilterOnlyPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { EdgeToggleButton } from "./EdgeToggleButton";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { FreqholeDataGrid } from "./components/FreqholeDataGrid";
import { PopupPreview } from "./components/PopupPreview";
import { ActionMenu } from "./components/ActionMenu";
import { BulkActionMenu } from "./components/BulkActionMenu";
import { DragSelectionOverlay } from "./components/DragSelectionOverlay";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { HeaderActionMenu } from "./components/HeaderActionMenu";
import { FreqholeStateProvider } from "./context/FreqholeStateContext";

export interface FreqholeDemoProps {
  wsUrl: string;
  autoConnect: boolean;
  apiBaseUrl: string;
}

function FreqholeDemo(props: FreqholeDemoProps) {
  return (
    <FreqholeStateProvider wsUrl={props.wsUrl} autoConnect={props.autoConnect}>
      <FreqholeDemoContent apiBaseUrl={props.apiBaseUrl} />
    </FreqholeStateProvider>
  );
}

function FreqholeDemoContent(props: { apiBaseUrl: string }) {
  return (
    <div
      style={`
        display: flex;
        height: 100vh;
        background: #000000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow: hidden;
      `}
    >
      {/* Browse Panel */}
      <BrowsePanel />

      {/* Selection Toolbar - Clean modular component */}
      <SelectionToolbar />

      {/* Main Content */}
      <div style="flex: 1; position: relative; overflow-y: hidden; overflow-x: auto; min-width: 0;">
        <FreqholeDataGrid apiBaseUrl={props.apiBaseUrl} />
      </div>

      {/* Edge Toggle Buttons */}
      <EdgeToggleButton />

      {/* Controls button removed - now handled by Actions header menu */}

      {/* Filter Only Panel */}
      <FilterOnlyPanel />

      {/* Settings Panel */}
      <SettingsPanel />

      <style>{`
        body.resizing {
          cursor: col-resize;
          user-select: none;
        }

        body.drag-selecting {
          user-select: none;
          cursor: crosshair;
        }

        body.drag-selecting * {
          user-select: none;
          cursor: crosshair;
        }
      `}</style>

      {/* Popup Preview */}
      <PopupPreview />

      {/* Action Menu */}
      <ActionMenu />

      {/* Bulk Action Menu */}
      <BulkActionMenu />

      {/* Confirm Dialog */}
      <ConfirmDialog />

      {/* Header Action Menu */}
      <HeaderActionMenu />

      {/* Drag Selection Overlay */}
      <DragSelectionOverlay />
    </div>
  );
}

export default FreqholeDemo;
export { FreqholeDemo };

// Helper functions moved to lib/media-utils.ts and lib/format-utils.ts
// Mock data generation removed - now using real WebSocket feed data
