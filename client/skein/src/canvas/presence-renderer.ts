import { Container, Graphics, Text } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { PeerPresence, PresenceManager } from "./presence-manager";

/**
 * renders remote peer cursors on the canvas world container.
 *
 * each peer gets a small colored arrow (triangle) and a label showing
 * a truncated peer id. cursors pan and zoom with the world because
 * the root container lives inside it.
 *
 * subscribes to the presence manager's `onPeerPresenceChanged` callback
 * and creates, updates, or hides cursor visuals as peers move or disconnect.
 */
export class PresenceRenderer {
  private readonly world: Container;
  private readonly presenceManager: PresenceManager;
  private readonly theme: SkeinTheme;
  private readonly root: Container;
  private readonly cursors: Map<string, Container> = new Map();

  /** stash the previous callback so we can restore it on destroy */
  private previousOnPeerPresenceChanged:
    | ((peerId: string, presence: PeerPresence) => void)
    | null = null;

  constructor(world: Container, presenceManager: PresenceManager, theme: SkeinTheme) {
    this.world = world;
    this.presenceManager = presenceManager;
    this.theme = theme;

    this.root = new Container();
    this.root.zIndex = 9999;
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    this.world.addChild(this.root);

    // chain onto any existing callback so we don't clobber it
    this.previousOnPeerPresenceChanged = presenceManager.onPeerPresenceChanged;

    presenceManager.onPeerPresenceChanged = (peerId: string, presence: PeerPresence) => {
      this.previousOnPeerPresenceChanged?.(peerId, presence);
      this.updatePeer(peerId, presence);
    };

    // hydrate any peers that already exist
    for (const [peerId, presence] of presenceManager.getPeers()) {
      this.updatePeer(peerId, presence);
    }
  }

  /**
   * create or update the cursor visual for a remote peer.
   * if the peer is the local user, their cursor position is null,
   * or they are offline, the visual is hidden.
   */
  updatePeer(peerId: string, presence: PeerPresence): void {
    // never render own cursor
    if (peerId === this.presenceManager.localPeerId) {
      return;
    }

    const shouldShow = presence.online && presence.cursor !== null;

    if (!shouldShow) {
      const existing = this.cursors.get(peerId);
      if (existing) {
        existing.visible = false;
      }
      return;
    }

    let cursor = this.cursors.get(peerId);
    if (!cursor) {
      cursor = this.createCursorVisual(peerId, presence.color);
      this.cursors.set(peerId, cursor);
      this.root.addChild(cursor);
    }

    cursor.visible = true;
    cursor.x = presence.cursor!.x;
    cursor.y = presence.cursor!.y;
  }

  /**
   * build the arrow + label container for a single peer.
   * the arrow is a small triangle (~12x16 px) pointing down-left
   * like a mouse pointer, drawn in the peer's color.
   * the label sits to the right of the arrow with a small offset.
   */
  private createCursorVisual(peerId: string, color: number): Container {
    const container = new Container();
    container.eventMode = "none";
    container.interactiveChildren = false;

    // draw a triangle that mimics a mouse pointer facing down-left.
    // vertices: top-left tip at (0,0), bottom at (4,16), right wing at (12,10).
    const arrow = new Graphics();
    arrow.poly([0, 0, 4, 16, 12, 10]);
    arrow.fill({ color });
    arrow.stroke({ color: 0x000000, width: 1, alpha: 0.4 });
    container.addChild(arrow);

    // truncated peer id label
    const label = new Text({
      text: peerId.slice(0, 8),
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: 10,
        fill: color,
      },
    });
    label.x = 14;
    label.y = 6;
    container.addChild(label);

    return container;
  }

  /** remove all cursor visuals and unsubscribe from the presence manager. */
  destroy(): void {
    // restore the previous callback
    this.presenceManager.onPeerPresenceChanged = this.previousOnPeerPresenceChanged;

    for (const [, cursor] of this.cursors) {
      cursor.destroy({ children: true });
    }
    this.cursors.clear();

    this.root.destroy({ children: true });
  }
}
