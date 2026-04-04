import { Container, Graphics, Text } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { PresenceManager } from "./presence-manager";

// stoplight colors
const COLOR_CONNECTED = 0x22c55e;
const COLOR_CONNECTING = 0xeab308;
const COLOR_ERROR = 0xef4444;
const COLOR_SOLO = 0x6b7280;

/**
 * source of transport-level connection state.
 * implemented by the IrohNetworkAdapter wrapper in boot.ts.
 */
export interface ConnectionStateSource {
  getConnectionSummary(): { connected: number; reconnecting: number; failed: number };
  onStateChange(handler: () => void): () => void;
  retryFailed(): void;
}

/**
 * compact pill-shaped connection status indicator rendered in the
 * bottom-left of the stage. shows a stoplight-colored dot and status label.
 *
 * - green dot + "N peers" when peers are online
 * - yellow dot + "connecting..." when reconnection is in progress
 * - red dot + "N disconnected" when reconnection gave up (click to retry)
 * - gray dot + "solo" when no peers are known
 *
 * added directly to app.stage (not the world container) so it stays
 * fixed regardless of pan/zoom.
 */
export class ConnectionStatus {
  readonly root: Container;

  private readonly presenceManager: PresenceManager;
  private readonly connectionState: ConnectionStateSource | null;
  private readonly theme: SkeinTheme;

  private readonly background: Graphics;
  private readonly dot: Graphics;
  private readonly label: Text;

  private readonly unsubs: (() => void)[] = [];
  private isErrorState = false;

  constructor(
    presenceManager: PresenceManager,
    theme: SkeinTheme,
    connectionState?: ConnectionStateSource | null
  ) {
    this.presenceManager = presenceManager;
    this.connectionState = connectionState ?? null;
    this.theme = theme;

    this.root = new Container();
    this.root.zIndex = 10000;

    // semi-transparent pill background
    this.background = new Graphics();
    this.root.addChild(this.background);

    // small status dot (6px diameter)
    this.dot = new Graphics();
    this.root.addChild(this.dot);

    // status label
    this.label = new Text({
      text: "solo",
      resolution: theme.textResolution,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: theme.frameHeaderText,
      },
    });
    this.root.addChild(this.label);

    // subscribe to presence events
    this.unsubs.push(presenceManager.onPeerJoined(() => this.refresh()));
    this.unsubs.push(presenceManager.onPeerLeft(() => this.refresh()));
    this.unsubs.push(presenceManager.onPeerPresenceChanged(() => this.refresh()));

    // subscribe to transport-level connection state changes
    if (this.connectionState) {
      this.unsubs.push(this.connectionState.onStateChange(() => this.refresh()));
    }

    // handle click (only active in error state)
    this.root.on("pointertap", () => {
      if (this.isErrorState && this.connectionState) {
        console.log("[skein:connection-status] retrying failed connections");
        this.connectionState.retryFailed();
      }
    });

    // draw initial state
    this.refresh();
  }

  /**
   * reposition the pill to the bottom-left of the screen.
   */
  layout(): void {
    const vv = window.visualViewport;
    const screenHeight = vv ? vv.height : window.innerHeight;
    const margin = 8;
    this.root.x = margin;
    this.root.y = Math.round(screenHeight - this.root.height - margin);
  }

  /** unsubscribe from callbacks, remove from parent, and clean up. */
  destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.root.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private refresh(): void {
    // get transport-level state
    const summary = this.connectionState?.getConnectionSummary() ?? {
      connected: 0,
      reconnecting: 0,
      failed: 0,
    };

    // get presence-level state (how many peers are actually sending messages)
    const onlineCount = this.countOnlinePeers();

    // determine display state (priority: error > connecting > connected > solo)
    let dotColor: number;
    let labelText: string;
    let interactive: boolean;

    if (summary.failed > 0) {
      // error state — some peers gave up reconnecting
      dotColor = COLOR_ERROR;
      labelText = `${summary.failed} disconnected`;
      interactive = true;
    } else if (summary.reconnecting > 0) {
      // connecting state — actively trying to reconnect
      dotColor = COLOR_CONNECTING;
      labelText = "connecting...";
      interactive = false;
    } else if (onlineCount > 0) {
      // connected state — peers are online and chatting
      dotColor = COLOR_CONNECTED;
      labelText = `${onlineCount} peer${onlineCount !== 1 ? "s" : ""}`;
      interactive = false;
    } else {
      // solo — no peers at all
      dotColor = COLOR_SOLO;
      labelText = "solo";
      interactive = false;
    }

    this.isErrorState = interactive;
    this.root.eventMode = interactive ? "static" : "none";
    this.root.interactiveChildren = interactive;
    this.root.cursor = interactive ? "pointer" : "default";

    this.drawDot(dotColor);
    this.label.text = labelText;
    this.drawPill();
  }

  private countOnlinePeers(): number {
    let count = 0;
    for (const peer of this.presenceManager.getPeers().values()) {
      if (peer.online && peer.peerId !== this.presenceManager.localPeerId) {
        count++;
      }
    }
    return count;
  }

  private drawDot(color: number): void {
    const radius = 3;
    this.dot.clear();
    this.dot.circle(0, 0, radius);
    this.dot.fill({ color });
  }

  private drawPill(): void {
    const padH = 8;
    const padV = 3;
    const gap = 6;
    const dotRadius = 3;

    const textHeight = this.label.height;
    const contentHeight = textHeight;
    const pillHeight = contentHeight + padV * 2;

    this.dot.x = padH + dotRadius;
    this.dot.y = Math.round(pillHeight / 2);

    this.label.x = padH + dotRadius * 2 + gap;
    this.label.y = padV;

    const pillWidth = this.label.x + this.label.width + padH;

    this.background.clear();
    this.background.roundRect(0, 0, pillWidth, pillHeight, pillHeight / 2);
    this.background.fill({ color: this.theme.frameHeaderBg, alpha: 0.92 });
    this.background.stroke({ color: this.theme.frameBorder, width: 1 });
  }
}
