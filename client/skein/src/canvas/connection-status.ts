import { Container, Graphics, Text } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { PresenceManager } from "./presence-manager";

// colors for the status dot
const COLOR_ONLINE = 0x22c55e;
const COLOR_SOLO = 0x6b7280;

/**
 * compact pill-shaped connection status indicator rendered in the
 * bottom-left of the stage. shows a colored dot and peer count label.
 *
 * green dot + "N peers" when at least one remote peer is online,
 * gray dot + "solo" when no remote peers are present.
 *
 * added directly to app.stage (not the world container) so it stays
 * fixed regardless of pan/zoom. uses visual viewport dimensions for
 * correct positioning on mobile safari where the visual viewport
 * can differ from the layout viewport.
 */
export class ConnectionStatus {
  readonly root: Container;

  private readonly presenceManager: PresenceManager;
  private readonly theme: SkeinTheme;

  private readonly background: Graphics;
  private readonly dot: Graphics;
  private readonly label: Text;

  // stash previous callbacks so we can chain and restore on destroy
  private previousOnPeerJoined: ((peerId: string) => void) | null = null;
  private previousOnPeerLeft: ((peerId: string) => void) | null = null;
  private previousOnPeerPresenceChanged:
    | ((peerId: string, presence: import("./presence-manager").PeerPresence) => void)
    | null = null;

  constructor(presenceManager: PresenceManager, theme: SkeinTheme) {
    this.presenceManager = presenceManager;
    this.theme = theme;

    this.root = new Container();
    this.root.zIndex = 10000;
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;

    // semi-transparent pill background
    this.background = new Graphics();
    this.root.addChild(this.background);

    // small status dot (6px diameter)
    this.dot = new Graphics();
    this.root.addChild(this.dot);

    // peer count label
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

    // chain onto existing callbacks without clobbering them
    this.previousOnPeerJoined = presenceManager.onPeerJoined;
    presenceManager.onPeerJoined = (peerId: string) => {
      this.previousOnPeerJoined?.(peerId);
      this.refresh();
    };

    this.previousOnPeerLeft = presenceManager.onPeerLeft;
    presenceManager.onPeerLeft = (peerId: string) => {
      this.previousOnPeerLeft?.(peerId);
      this.refresh();
    };

    // also react to any presence change (e.g. offline broadcast sets
    // peer.online = false without firing onPeerLeft)
    this.previousOnPeerPresenceChanged = presenceManager.onPeerPresenceChanged;
    presenceManager.onPeerPresenceChanged = (peerId, presence) => {
      this.previousOnPeerPresenceChanged?.(peerId, presence);
      this.refresh();
    };

    // draw initial state
    this.refresh();
  }

  /**
   * reposition the pill to the bottom-left of the screen.
   * uses visual viewport when available (mobile safari reports correct
   * dimensions there, unlike window.innerHeight which includes the
   * offscreen area behind the on-screen keyboard and address bar).
   * call this after creation and on window resize.
   */
  layout(): void {
    const vv = window.visualViewport;
    const screenHeight = vv ? vv.height : window.innerHeight;
    const margin = 8;
    this.root.x = margin;
    this.root.y = Math.round(screenHeight - this.root.height - margin);
  }

  /** unsubscribe from presence callbacks, remove from parent, and clean up. */
  destroy(): void {
    // restore the previous callbacks
    this.presenceManager.onPeerPresenceChanged = this.previousOnPeerPresenceChanged;
    this.presenceManager.onPeerJoined = this.previousOnPeerJoined;
    this.presenceManager.onPeerLeft = this.previousOnPeerLeft;

    this.root.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  /** count online remote peers and redraw the indicator */
  private refresh(): void {
    const onlineCount = this.countOnlinePeers();
    const isConnected = onlineCount > 0;

    this.drawDot(isConnected ? COLOR_ONLINE : COLOR_SOLO);
    this.label.text = isConnected ? `${onlineCount} peer${onlineCount !== 1 ? "s" : ""}` : "solo";

    this.drawPill();
  }

  /** count remote peers that are currently online */
  private countOnlinePeers(): number {
    let count = 0;
    for (const peer of this.presenceManager.getPeers().values()) {
      if (peer.online && peer.peerId !== this.presenceManager.localPeerId) {
        count++;
      }
    }
    return count;
  }

  /** redraw the status dot at its fixed position inside the pill */
  private drawDot(color: number): void {
    const radius = 3;
    this.dot.clear();
    this.dot.circle(0, 0, radius);
    this.dot.fill({ color });
  }

  /**
   * redraw the pill background and reposition the dot and label
   * to fit the current label text width.
   */
  private drawPill(): void {
    const padH = 8;
    const padV = 3;
    const gap = 6;
    const dotRadius = 3;

    // position the dot vertically centered with the text
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
