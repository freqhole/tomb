import { Show, createSignal } from "solid-js";
import { useFreqholeStateContext } from "./context/FreqholeStateContext";

export function EdgeToggleButton() {
  const state = useFreqholeStateContext();
  const [isHovered, setIsHovered] = createSignal(false);

  // Component shows Browse panel toggle button on the left side
  const isVisible = () => !state.isBrowsePanelOpen();
  const position = "left";
  const panelName = "Browse";
  const onClick = () => state.toggleBrowsePanel();

  return (
    <Show when={isVisible()}>
      <div
        class={`edge-toggle-button edge-toggle-${position}`}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={`Show ${panelName} panel`}
        style={`
          position: fixed;
          top: 50%;
          ${position}: 0;
          transform: translateY(-50%);
          width: 24px;
          height: 80px;
          background: #2a2a2a;
          border: 1px solid #3a3a3a;
          border-radius: ${position === "left" ? "0 8px 8px 0" : "8px 0 0 8px"};
          cursor: pointer;
          z-index: 1000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          color: #888;
          font-size: 12px;
          font-weight: 500;
          user-select: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          overflow: hidden;
        `}
      >
        {/* Arrow - only show on hover */}
        <div
          class="arrow-container"
          style={`
            opacity: ${isHovered() ? "1" : "0"};
            transform: translateY(${isHovered() ? "0" : "8px"});
            transition: all 0.3s ease;
            font-size: 16px;
            margin-bottom: 8px;
            color: #ff00ff;
          `}
        >
          {position === "left" ? "→" : "←"}
        </div>

        {/* Panel name - vertical text */}
        <div
          class="panel-name"
          style={`
            writing-mode: vertical-rl;
            text-orientation: mixed;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
            line-height: 1.2;
          `}
        >
          {panelName}
        </div>

        <style>{`
          .edge-toggle-button:hover {
            background: #3a3a3a !important;
            border-color: #4a4a4a !important;
            color: #e0e0e0 !important;
            width: 28px !important;
          }

          .edge-toggle-button:active {
            background: #ff00ff !important;
            border-color: #ff00ff !important;
            color: #000000 !important;
          }

          .edge-toggle-left:hover {
            transform: translateY(-50%) translateX(4px) !important;
          }

          .edge-toggle-right:hover {
            transform: translateY(-50%) translateX(-4px) !important;
          }
        `}</style>
      </div>
    </Show>
  );
}

export default EdgeToggleButton;
