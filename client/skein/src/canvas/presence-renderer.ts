import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { PeerPresence, PresenceManager } from "./presence-manager";

const TAG = "[presence-renderer]";

/** avatar circle diameter for presence cursors */
const AVATAR_SIZE = 28;
/** small pointer triangle size when avatar is shown */
const AVATAR_POINTER_SIZE = 8;

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
  private nameResolver: ((peerId: string) => string | null) | null = null;
  private avatarResolver: ((peerId: string) => string | null) | null = null;

  /**
   * tracks which resolved display name is already rendered by which peerId.
   * when multiple peerIds resolve to the same name (same person, different
   * automerge repo session), only the most-recently-active one gets a visible
   * cursor — the others are hidden to prevent stacked duplicates.
   */
  private nameToActivePeer: Map<string, string> = new Map();

  private readonly unsubs: (() => void)[] = [];

  constructor(world: Container, presenceManager: PresenceManager, theme: SkeinTheme) {
    this.world = world;
    this.presenceManager = presenceManager;
    this.theme = theme;

    this.root = new Container();
    this.root.zIndex = 9999;
    this.root.eventMode = "none";
    this.root.interactiveChildren = false;
    this.world.addChild(this.root);

    this.unsubs.push(
      presenceManager.onPeerPresenceChanged((peerId, presence) => {
        this.updatePeer(peerId, presence);
      })
    );

    // hydrate any peers that already exist
    for (const [peerId, presence] of presenceManager.getPeers()) {
      this.updatePeer(peerId, presence);
    }
  }

  /** set a function that resolves peer IDs to display names. cursor labels will update on the next presence change. */
  setNameResolver(resolver: ((peerId: string) => string | null) | null): void {
    this.nameResolver = resolver;
    // refresh all existing cursors with new names
    for (const [peerId, cursor] of this.cursors) {
      const label = cursor.children.find((c) => c instanceof Text) as Text | undefined;
      if (label) {
        const name = this.nameResolver?.(peerId);
        label.text = name || peerId.slice(0, 8);
      }
    }
  }

  /** set a function that resolves peer IDs to avatar data URLs.
   *  when an avatar is available, the cursor shows a circular image
   *  instead of the colored triangle. */
  setAvatarResolver(resolver: ((peerId: string) => string | null) | null): void {
    this.avatarResolver = resolver;
    // rebuild cursors that might now have (or lost) an avatar
    for (const [peerId] of this.cursors) {
      const presence = this.presenceManager.getPeer(peerId);
      if (presence) {
        // destroy and recreate to pick up avatar change
        const old = this.cursors.get(peerId);
        if (old) {
          old.destroy({ children: true });
          this.cursors.delete(peerId);
        }
        this.updatePeer(peerId, presence);
      }
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
      // release the name slot so another peerId can claim it
      for (const [name, activePeer] of this.nameToActivePeer) {
        if (activePeer === peerId) {
          this.nameToActivePeer.delete(name);
          break;
        }
      }
      return;
    }

    // --- dedup by resolved name ---
    // if two peerIds resolve to the same display name (same person,
    // different session/tab/reconnection), only keep the most recent one
    // visible. this prevents stacked cursors for the same user.
    const resolvedName = this.nameResolver?.(peerId) ?? null;
    if (resolvedName) {
      const existingOwner = this.nameToActivePeer.get(resolvedName);
      if (existingOwner && existingOwner !== peerId) {
        // another peerId already owns this name — hide the old one,
        // this newer message wins (most recently active)
        const oldCursor = this.cursors.get(existingOwner);
        if (oldCursor) {
          oldCursor.visible = false;
          console.log(
            TAG,
            `dedup: hiding stale cursor for "${resolvedName}" (old peerId=${existingOwner.slice(0, 8)}, new peerId=${peerId.slice(0, 8)})`
          );
        }
      }
      this.nameToActivePeer.set(resolvedName, peerId);
    }

    let cursor = this.cursors.get(peerId);
    if (!cursor) {
      console.log(
        TAG,
        `creating cursor for peerId=${peerId.slice(0, 12)} name="${resolvedName ?? peerId.slice(0, 8)}" (total cursors: ${this.cursors.size + 1})`
      );
      cursor = this.createCursorVisual(peerId, presence.color);
      this.cursors.set(peerId, cursor);
      this.root.addChild(cursor);
    }

    cursor.visible = true;
    cursor.x = presence.cursor!.x;
    cursor.y = presence.cursor!.y;

    // check if cursor needs to be rebuilt (avatar appeared/disappeared/changed)
    if (this.avatarResolver) {
      const currentAvatarUrl = this.avatarResolver(peerId);
      const hasAvatarSprite = cursor.children.some((c) => c instanceof Sprite);
      const needsAvatar = !!currentAvatarUrl;

      if (hasAvatarSprite !== needsAvatar) {
        // avatar state changed — rebuild the cursor visual
        cursor.destroy({ children: true });
        this.cursors.delete(peerId);
        const newCursor = this.createCursorVisual(peerId, presence.color);
        this.cursors.set(peerId, newCursor);
        this.root.addChild(newCursor);
        newCursor.visible = true;
        newCursor.x = presence.cursor!.x;
        newCursor.y = presence.cursor!.y;
        return;
      }
    }

    // update label text in case the resolved name changed since creation
    if (this.nameResolver) {
      // label might be nested in a labelGroup container — search recursively
      const findLabel = (node: Container): Text | null => {
        for (const child of node.children) {
          if (child instanceof Text) return child;
          if (child instanceof Container) {
            const found = findLabel(child);
            if (found) return found;
          }
        }
        return null;
      };
      const textNode = findLabel(cursor);
      if (textNode) {
        const name = this.nameResolver(peerId);
        textNode.text = name || peerId.slice(0, 8);
      }
    }
  }

  /**
   * build the cursor container for a single peer.
   *
   * if an avatar data URL is available, renders a small circular avatar
   * with a tiny pointer triangle at the top-left corner. otherwise
   * falls back to the colored triangle arrow.
   *
   * always shows the peer's name label below.
   */
  private createCursorVisual(peerId: string, color: number): Container {
    const container = new Container();
    container.eventMode = "none";
    container.interactiveChildren = false;

    const avatarUrl = this.avatarResolver?.(peerId) ?? null;
    const displayName = this.nameResolver?.(peerId) || peerId.slice(0, 8);

    if (avatarUrl) {
      // --- avatar mode ---

      // tiny pointer triangle at (0,0) so the tip is at the cursor position
      const pointer = new Graphics();
      pointer.poly([0, 0, 2, AVATAR_POINTER_SIZE, AVATAR_POINTER_SIZE, AVATAR_POINTER_SIZE / 2]);
      pointer.fill({ color });
      pointer.stroke({ color: 0x000000, width: 0.5, alpha: 0.3 });
      container.addChild(pointer);

      // circular avatar offset slightly from the pointer tip
      const avatarContainer = new Container();
      avatarContainer.x = AVATAR_POINTER_SIZE - 2;
      avatarContainer.y = AVATAR_POINTER_SIZE / 2 - 2;
      container.addChild(avatarContainer);

      // circular background (shows while texture loads, and as a border)
      const circleBg = new Graphics();
      circleBg.circle(AVATAR_SIZE / 2, AVATAR_SIZE / 2, AVATAR_SIZE / 2 + 1.5);
      circleBg.fill({ color, alpha: 0.9 });
      avatarContainer.addChild(circleBg);

      // avatar sprite with circular mask
      const avatarMask = new Graphics();
      avatarMask.circle(AVATAR_SIZE / 2, AVATAR_SIZE / 2, AVATAR_SIZE / 2);
      avatarMask.fill({ color: 0xffffff });
      avatarContainer.addChild(avatarMask);

      // load avatar texture from data URL
      try {
        const texture = Texture.from(avatarUrl);
        const sprite = new Sprite(texture);
        sprite.width = AVATAR_SIZE;
        sprite.height = AVATAR_SIZE;
        sprite.mask = avatarMask;
        avatarContainer.addChild(sprite);
      } catch {
        // texture load failed — the circle background still shows as fallback
      }

      // name label below the avatar circle
      const label = new Text({
        text: displayName,
        resolution: this.theme.textResolution,
        style: {
          fontFamily: this.theme.fontFamily,
          fontSize: 10,
          fill: 0xffffff,
          fontWeight: "600",
        },
      });

      // background pill behind the name for readability
      const labelBg = new Graphics();
      const labelPadX = 4;
      const labelPadY = 1;
      // need to measure after text is set
      const lw = label.width + labelPadX * 2;
      const lh = label.height + labelPadY * 2;
      labelBg.roundRect(0, 0, lw, lh, lh / 2);
      labelBg.fill({ color, alpha: 0.85 });

      const labelGroup = new Container();
      labelGroup.addChild(labelBg);
      labelGroup.addChild(label);
      label.x = labelPadX;
      label.y = labelPadY;

      // position label centered below the avatar
      labelGroup.x = AVATAR_POINTER_SIZE - 2 + (AVATAR_SIZE - lw) / 2;
      labelGroup.y = AVATAR_POINTER_SIZE / 2 - 2 + AVATAR_SIZE + 3;
      container.addChild(labelGroup);
    } else {
      // --- triangle arrow mode (original) ---

      // draw a triangle that mimics a mouse pointer facing down-left.
      // vertices: top-left tip at (0,0), bottom at (4,16), right wing at (12,10).
      const arrow = new Graphics();
      arrow.poly([0, 0, 4, 16, 12, 10]);
      arrow.fill({ color });
      arrow.stroke({ color: 0x000000, width: 1, alpha: 0.4 });
      container.addChild(arrow);

      // name label with background pill for readability
      const label = new Text({
        text: displayName,
        resolution: this.theme.textResolution,
        style: {
          fontFamily: this.theme.fontFamily,
          fontSize: 10,
          fill: 0xffffff,
          fontWeight: "600",
        },
      });

      const labelBg = new Graphics();
      const labelPadX = 4;
      const labelPadY = 1;
      const lw = label.width + labelPadX * 2;
      const lh = label.height + labelPadY * 2;
      labelBg.roundRect(0, 0, lw, lh, lh / 2);
      labelBg.fill({ color, alpha: 0.75 });

      const labelGroup = new Container();
      labelGroup.addChild(labelBg);
      labelGroup.addChild(label);
      label.x = labelPadX;
      label.y = labelPadY;

      labelGroup.x = 14;
      labelGroup.y = 6;
      container.addChild(labelGroup);
    }

    return container;
  }

  /** remove all cursor visuals and unsubscribe from the presence manager. */
  destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }

    for (const [, cursor] of this.cursors) {
      cursor.destroy({ children: true });
    }
    this.cursors.clear();
    this.nameToActivePeer.clear();

    this.nameResolver = null;
    this.avatarResolver = null;
    this.root.destroy({ children: true });
  }
}
