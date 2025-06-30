
import { Show, onCleanup, createEffect } from "solid-js";
import { useFreqholeStateContext } from "../context/FreqholeStateContext";

export function HeaderActionMenu() {
  const state = useFreqholeStateContext();
  let menuRef: HTMLDivElement | undefined;

  // Close on outside click
  const handleClickOutside = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      e.preventDefault();
      e.stopPropagation();
      state.setHeaderActionMenu(null);
    }
  };

  // Close on escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      state.setHeaderActionMenu(null);
    }
  };

  // Add/remove listeners whenever isOpen changes
  createEffect(() => {
    if (state.headerActionMenu()?.isOpen) {
      document.addEventListener("mousedown", handleClickOutside, true);
      document.addEventListener("keydown", handleKeyDown);
    } else {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    }
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside, true);
    document.removeEventListener("keydown", handleKeyDown);
  });

  const handleFilterClick = () => {
    state.setIsFilterPanelOpen(!state.isFilterPanelOpen());
    state.setHeaderActionMenu(null);
  };

  const handleSettingsClick = () => {
    state.setIsSettingsPanelOpen(!state.isSettingsPanelOpen());
    state.setHeaderActionMenu(null);
  };

  const handleViewModeClick = () => {
    // TODO: Add view mode cycling to context
    state.setHeaderActionMenu(null);
  };

  return (
    <Show when={state.headerActionMenu()?.isOpen}>
      <div
        ref={menuRef}
        style={`
          position: fixed;
          left: ${state.headerActionMenu()?.position.x || 0}px;
          top: ${state.headerActionMenu()?.position.y || 0}px;
          transform: translateX(-50%);
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          z-index: 10000;
          min-width: 200px;
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
            <Show when={state.isFilterPanelOpen()}>
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
                default
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
            <Show when={state.isSettingsPanelOpen()}>
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
