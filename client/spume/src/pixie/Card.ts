import {
  Application,
  Container,
  FederatedPointerEvent,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import { PixieTheme } from "./PixieTheme";

// shared font config for crisp text
const FONT_STYLE = { fontFamily: PixieTheme.fontFamily };
const TEXT_RES = PixieTheme.textResolution;

// pick black or white text based on background luminance
function contrastTextColor(color: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? "#000000" : "#ffffff";
}

export type CardState = "front" | "back" | "spine" | "spine-horizontal";

export interface CardOptions {
  id: number;
  label: string;
  color: number;
  imageUrl?: string;
  albumData?: AlbumData;
}

// metadata attached to a card for detail view
export interface AlbumData {
  title: string;
  artist: string;
  year: number;
  trackCount: number;
  duration: number;
  rating: number;
  thumbnailUrl: string;
  tracks?: { title: string; durationSeconds: number; rating: number }[];
}

function makeCardTexture(app: Application, color: number, label: string, size: number): Texture {
  const g = new Graphics();
  g.rect(0, 0, size, size).fill(color);
  const text = new Text({ text: label, resolution: TEXT_RES, style: {
    fill: contrastTextColor(color), fontSize: 14,
    wordWrap: true, wordWrapWidth: size - 8,
    ...FONT_STYLE,
  } });
  text.anchor.set(0.5);
  text.x = size / 2;
  text.y = size / 2;
  const c = new Container();
  c.addChild(g, text);
  // clip to card bounds
  const mask = new Graphics();
  mask.rect(0, 0, size, size).fill(0xffffff);
  c.addChild(mask);
  c.mask = mask;
  return app.renderer.generateTexture({ target: c, resolution: TEXT_RES });
}

function makeSpineTexture(
  app: Application, color: number, label: string, width: number, height: number
): Texture {
  const g = new Graphics();
  g.rect(0, 0, width, height).fill(color);
  // semi-transparent bg behind text for readability
  const textBg = new Graphics();
  textBg.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.45 });
  const text = new Text({ text: label, resolution: TEXT_RES, style: { fill: "#ffffff", fontSize: 10, ...FONT_STYLE } });
  text.anchor.set(0.5);
  text.rotation = Math.PI / 2;
  text.x = width / 2;
  text.y = height / 2;
  const c = new Container();
  c.addChild(g, textBg, text);
  // clip to spine bounds
  const mask = new Graphics();
  mask.rect(0, 0, width, height).fill(0xffffff);
  c.addChild(mask);
  c.mask = mask;
  return app.renderer.generateTexture({ target: c, resolution: TEXT_RES });
}

function makeSpineHorizontalTexture(
  app: Application, color: number, label: string, width: number, height: number
): Texture {
  const g = new Graphics();
  g.rect(0, 0, width, height).fill(color);
  // semi-transparent bg behind text for readability
  const textBg = new Graphics();
  textBg.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.45 });
  const text = new Text({ text: label, resolution: TEXT_RES, style: { fill: "#ffffff", fontSize: 10, ...FONT_STYLE } });
  text.anchor.set(0.5);
  text.x = width / 2;
  text.y = height / 2;
  const c = new Container();
  c.addChild(g, textBg, text);
  // clip to spine bounds
  const mask = new Graphics();
  mask.rect(0, 0, width, height).fill(0xffffff);
  c.addChild(mask);
  c.mask = mask;
  return app.renderer.generateTexture({ target: c, resolution: TEXT_RES });
}

export const CARD_SIZE = 100;
export const SPINE_WIDTH = 20;
export const SPINE_HEIGHT = 100;

export type DropZoneChecker = {
  getSlot: (x: number, y: number) => { x: number; y: number } | null;
  getFirstEmptySlot?: () => { x: number; y: number } | null;
  occupySlot: (x: number, y: number, card: Card) => void;
  releaseCard: (card: Card) => void;
  updateHover: (x: number, y: number) => void;
  clearHover: () => void;
};

// callback interface so cards can query scene state
export interface CardSceneCallbacks {
  isEditMode: () => boolean;
  getSelectedCards: () => Card[];
  onCardClicked: (card: Card, e: FederatedPointerEvent) => void;
  onCardDoubleClicked?: (card: Card) => void;
}

export class Card extends Container {
  public cardId: number;
  public cardLabel: string;
  public selected = false;
  public albumData: AlbumData | null;

  private sprite: Sprite;
  private selectionBorder: Graphics;
  private frontTex: Texture;
  private backTex: Texture;
  private spineTex: Texture;
  private spineHorizontalTex: Texture;

  private dragging = false;
  private dragOffset = { x: 0, y: 0 };
  private app: Application;
  private sceneCallbacks: CardSceneCallbacks | null = null;
  private lastPointerDown = 0;

  private dropZones: DropZoneChecker[] = [];

  constructor(app: Application, opts: CardOptions) {
    super();

    this.app = app;
    this.cardId = opts.id;
    this.cardLabel = opts.label;
    this.albumData = opts.albumData ?? null;

    this.frontTex = makeCardTexture(app, opts.color, opts.label, CARD_SIZE);
    this.backTex = makeCardTexture(app, 0x555555, "back", CARD_SIZE);
    this.spineTex = makeSpineTexture(app, opts.color, opts.label, SPINE_WIDTH, SPINE_HEIGHT);
    this.spineHorizontalTex = makeSpineHorizontalTexture(
      app, opts.color, opts.label, SPINE_HEIGHT, SPINE_WIDTH
    );

    this.sprite = new Sprite(this.frontTex);
    this.sprite.anchor.set(0.5);
    this.addChild(this.sprite);

    // magenta selection border, hidden by default
    this.selectionBorder = new Graphics();
    this.redrawSelectionBorder();
    this.selectionBorder.visible = false;
    this.addChild(this.selectionBorder);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerdown", this.onDown, this);

    // load image if provided
    if (opts.imageUrl) {
      this.loadImage(opts.imageUrl, opts.label);
    }
  }

  setSceneCallbacks(callbacks: CardSceneCallbacks) {
    this.sceneCallbacks = callbacks;
  }

  // load an image from url and replace the front texture
  private async loadImage(url: string, label: string) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
      });

      // build front texture from loaded image
      const imgTex = Texture.from(img);
      const imgSprite = new Sprite(imgTex);
      imgSprite.width = CARD_SIZE;
      imgSprite.height = CARD_SIZE;

      // overlay label at bottom
      const labelBg = new Graphics();
      labelBg.rect(0, CARD_SIZE - 22, CARD_SIZE, 22).fill({ color: 0x000000, alpha: 0.6 });
      const text = new Text({ text: label, resolution: TEXT_RES, style: {
        fill: "#ffffff", fontSize: 10,
        wordWrap: true, wordWrapWidth: CARD_SIZE - 6,
        ...FONT_STYLE,
      } });
      text.anchor.set(0.5, 0.5);
      text.x = CARD_SIZE / 2;
      text.y = CARD_SIZE - 11;

      const c = new Container();
      c.addChild(imgSprite, labelBg, text);
      // clip to card bounds
      const frontMask = new Graphics();
      frontMask.rect(0, 0, CARD_SIZE, CARD_SIZE).fill(0xffffff);
      c.addChild(frontMask);
      c.mask = frontMask;
      this.frontTex = this.app.renderer.generateTexture({ target: c, resolution: TEXT_RES });

      // rebuild spine with image strip
      const spineC = new Container();
      const spineImg = new Sprite(imgTex);
      spineImg.width = SPINE_WIDTH;
      spineImg.height = SPINE_HEIGHT;
      spineC.addChild(spineImg);
      const spineOverlay = new Graphics();
      spineOverlay.rect(0, 0, SPINE_WIDTH, SPINE_HEIGHT).fill({ color: 0x000000, alpha: 0.45 });
      spineC.addChild(spineOverlay);
      const spineText = new Text({ text: label, resolution: TEXT_RES, style: { fill: "#ffffff", fontSize: 8, ...FONT_STYLE } });
      spineText.anchor.set(0.5);
      spineText.rotation = Math.PI / 2;
      spineText.x = SPINE_WIDTH / 2;
      spineText.y = SPINE_HEIGHT / 2;
      spineC.addChild(spineText);
      const spineMask = new Graphics();
      spineMask.rect(0, 0, SPINE_WIDTH, SPINE_HEIGHT).fill(0xffffff);
      spineC.addChild(spineMask);
      spineC.mask = spineMask;
      this.spineTex = this.app.renderer.generateTexture({ target: spineC, resolution: TEXT_RES });

      // horizontal spine
      const hSpineC = new Container();
      const hSpineImg = new Sprite(imgTex);
      hSpineImg.width = SPINE_HEIGHT;
      hSpineImg.height = SPINE_WIDTH;
      hSpineC.addChild(hSpineImg);
      const hOverlay = new Graphics();
      hOverlay.rect(0, 0, SPINE_HEIGHT, SPINE_WIDTH).fill({ color: 0x000000, alpha: 0.45 });
      hSpineC.addChild(hOverlay);
      const hText = new Text({ text: label, resolution: TEXT_RES, style: { fill: "#ffffff", fontSize: 8, ...FONT_STYLE } });
      hText.anchor.set(0.5);
      hText.x = SPINE_HEIGHT / 2;
      hText.y = SPINE_WIDTH / 2;
      hSpineC.addChild(hText);
      const hMask = new Graphics();
      hMask.rect(0, 0, SPINE_HEIGHT, SPINE_WIDTH).fill(0xffffff);
      hSpineC.addChild(hMask);
      hSpineC.mask = hMask;
      this.spineHorizontalTex = this.app.renderer.generateTexture({ target: hSpineC, resolution: TEXT_RES });

      // apply if currently showing front
      this.sprite.texture = this.frontTex;
      this.redrawSelectionBorder();
    } catch {
      // image load failed, keep color texture
    }
  }

  setState(state: CardState) {
    if (state === "front") this.sprite.texture = this.frontTex;
    if (state === "back") this.sprite.texture = this.backTex;
    if (state === "spine") this.sprite.texture = this.spineTex;
    if (state === "spine-horizontal") this.sprite.texture = this.spineHorizontalTex;
    this.redrawSelectionBorder();
  }

  setSelected(on: boolean) {
    this.selected = on;
    this.selectionBorder.visible = on;
  }

  private redrawSelectionBorder() {
    this.selectionBorder.clear();
    const w = this.sprite.width;
    const h = this.sprite.height;
    this.selectionBorder.rect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4)
      .stroke({ width: 2, color: PixieTheme.accent500 });
  }

  registerDropZones(zones: DropZoneChecker[]) {
    this.dropZones = zones;
  }

  private onDown(e: FederatedPointerEvent) {
    if (!this.parent) return;

    // in edit mode cards are not interactive — containers move instead
    if (this.sceneCallbacks?.isEditMode()) return;

    // double-click detection (300ms threshold)
    const now = Date.now();
    if (now - this.lastPointerDown < 300) {
      this.sceneCallbacks?.onCardDoubleClicked?.(this);
      this.lastPointerDown = 0;
      return;
    }
    this.lastPointerDown = now;

    // notify scene for click/selection handling
    this.sceneCallbacks?.onCardClicked(this, e);

    this.dragging = true;

    // release from any occupied slot
    for (const zone of this.dropZones) {
      zone.releaseCard(this);
    }

    // collect multi-drag peers
    const selectedCards = this.sceneCallbacks?.getSelectedCards() ?? [];
    const peers = this.selected ? selectedCards.filter((c) => c !== this) : [];
    for (const peer of peers) {
      for (const zone of peer.dropZones) {
        zone.releaseCard(peer);
      }
    }

    // bring to front
    this.parent.setChildIndex(this, this.parent.children.length - 1);

    const pos = e.getLocalPosition(this.parent);
    this.dragOffset = { x: pos.x - this.x, y: pos.y - this.y };

    // compute peer offsets for multi-drag
    const peerOffsets = new Map<Card, { dx: number; dy: number }>();
    for (const peer of peers) {
      peerOffsets.set(peer, { dx: peer.x - this.x, dy: peer.y - this.y });
    }

    const stage = this.app.stage;
    const onMove = (ev: FederatedPointerEvent) => {
      if (!this.dragging || !this.parent) return;

      const p = ev.getLocalPosition(this.parent);
      let nx = p.x - this.dragOffset.x;
      let ny = p.y - this.dragOffset.y;

      const halfW = this.sprite.width / 2;
      const halfH = this.sprite.height / 2;
      const screenW = this.app.screen.width;
      const screenH = this.app.screen.height;

      nx = Math.max(halfW, nx);
      ny = Math.max(halfH, ny);
      ny = Math.min(screenH - halfH, ny);

      if (nx + halfW > screenW) {
        const needed = nx + halfW + 50;
        this.app.renderer.resize(needed, screenH);
        this.app.stage.hitArea = this.app.screen;
      }

      this.x = nx;
      this.y = ny;

      for (const [peer, off] of peerOffsets) {
        peer.x = nx + off.dx;
        peer.y = ny + off.dy;
      }

      for (const zone of this.dropZones) {
        zone.updateHover(this.x, this.y);
      }
    };

    const onUp = () => {
      if (!this.dragging) return;
      this.dragging = false;

      stage.off("pointermove", onMove);
      stage.off("pointerup", onUp);
      stage.off("pointerupoutside", onUp);

      for (const zone of this.dropZones) {
        zone.clearHover();
      }

      // find which zone the dragged card landed in
      let targetZone: DropZoneChecker | null = null;
      let targetSlot: { x: number; y: number } | null = null;
      for (const zone of this.dropZones) {
        const slot = zone.getSlot(this.x, this.y);
        if (slot) {
          targetZone = zone;
          targetSlot = slot;
          break;
        }
      }

      if (targetZone && targetSlot) {
        // place the dragged card
        const isBin = (targetZone as any)._isBin === true;
        const isShelf = (targetZone as any)._isShelf === true;
        const state = isBin ? "spine-horizontal" as const : isShelf ? "spine" as const : "front" as const;
        this.setState(state);
        this.position.set(targetSlot.x, targetSlot.y);
        targetZone.occupySlot(targetSlot.x, targetSlot.y, this);
        this.setSelected(false);

        // batch-place selected peers into successive empty slots
        for (const peer of peerOffsets.keys()) {
          const nextSlot = targetZone.getFirstEmptySlot?.();
          if (nextSlot) {
            peer.setState(state);
            peer.position.set(nextSlot.x, nextSlot.y);
            targetZone.occupySlot(nextSlot.x, nextSlot.y, peer);
          }
          peer.setSelected(false);
        }
      } else {
        // not in any zone — leave where dropped
        this.setState("front");
        for (const peer of peerOffsets.keys()) {
          peer.setState("front");
        }
      }
    };

    stage.on("pointermove", onMove);
    stage.on("pointerup", onUp);
    stage.on("pointerupoutside", onUp);
  }
}
