/* @jsxImportSource solid-js */
import { Show, onCleanup, createEffect } from "solid-js";

export interface HeaderActionMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onFilterPanel: () => void;
  onSettingsPanel: () => void;
  onCycleViewMode: () => void;
  currentViewMode: string;
  isFilterPanelOpen: boolean;
  isSettingsPanelOpen: boolean;
}

export function HeaderActionMenu(props: HeaderActionMenuProps) {
  let menuRef: HTMLDivElement | undefined;

  // Close on outside click
  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  // Close on escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  // Add/remove listeners whenever isOpen changes
  createEffect(() => {
    if (props.isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    }
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleKeyDown);
  });

  const handleFilterClick = () => {
    props.onFilterPanel();
    props.onClose();
  };

  const handleSettingsClick = () => {
    props.onSettingsPanel();
    props.onClose();
  };

  const handleViewModeClick = () => {
    props.onCycleViewMode();
    // Don't close menu for view mode cycling
  };

  return (
    <Show when={props.isOpen}>
      <div
        ref={menuRef}
        class="header-action-menu"
        style={`
          position: fixed;
          top: ${props.position.y}px;
          left: ${props.position.x}px;
          transform: translateX(-50%);
          background: #1a1a1a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 1000;
          min-width: 200px;
          overflow: hidden;
          animation: slideIn 0.15s ease-out;
        `}
      >
        <div style="padding: 8px 0;">
          {/* Filter Panel */}
          <button
            class="header-action-menu-item"
            onClick={handleFilterClick}
            style={`
              width: 100%;
              padding: 10px 16px;
              background: transparent;
              border: none;
              color: #e0e0e0;
              text-align: left;
              cursor: pointer;
              font-size: 13px;
              display: flex;
              align-items: center;
              gap: 12px;
              transition: all 0.15s ease;
            `}
          >
            <div style="flex: 1;">
              <div style="font-weight: 500;">Filters & Columns</div>
            </div>
            <Show when={props.isFilterPanelOpen}>
              <span style="color: #ff00ff; font-size: 12px;">●</span>
            </Show>
          </button>

          {/* View Mode */}
          <button
            class="header-action-menu-item"
            onClick={handleViewModeClick}
            style={`
              width: 100%;
              padding: 10px 16px;
              background: transparent;
              border: none;
              color: #e0e0e0;
              text-align: left;
              cursor: pointer;
              font-size: 13px;
              display: flex;
              align-items: center;
              gap: 12px;
              transition: all 0.15s ease;
            `}
          >
            <div style="flex: 1;">
              <div style="font-weight: 500;">View Mode</div>
              <div style="font-size: 11px; color: #888; margin-top: 2px;">
                {props.currentViewMode}
              </div>
            </div>
          </button>

          {/* Settings Panel */}
          <button
            class="header-action-menu-item"
            onClick={handleSettingsClick}
            style={`
              width: 100%;
              padding: 10px 16px;
              background: transparent;
              border: none;
              color: #e0e0e0;
              text-align: left;
              cursor: pointer;
              font-size: 13px;
              display: flex;
              align-items: center;
              gap: 12px;
              transition: all 0.15s ease;
            `}
          >
            <div style="flex: 1;">
              <div style="font-weight: 500;">Settings</div>
            </div>
            <Show when={props.isSettingsPanelOpen}>
              <span style="color: #ff00ff; font-size: 12px;">●</span>
            </Show>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .header-action-menu-item:hover {
          background: rgba(255, 255, 255, 0.08) !important;
        }

        .header-action-menu-item:active {
          background: rgba(255, 255, 255, 0.12) !important;
        }
      `}</style>
    </Show>
  );
}

export default HeaderActionMenu;
