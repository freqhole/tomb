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
import type { AlbumData } from "./Card";

const FONT = { fontFamily: PixieTheme.fontFamily };
const TEXT_RES = PixieTheme.textResolution;

// helper to create sharp text with consistent font
function txt(text: string, style: Record<string, unknown>): Text {
  return new Text({ text, resolution: TEXT_RES, style: { ...FONT, ...style } });
}

const PANEL_W = 520;
const PANEL_H = 480;
const ART_SIZE = 200;
const PAD = 20;
const ICON_BTN_SIZE = 32;
const ICON_BTN_GAP = 6;
const TRACK_ROW_H = 22;

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// -- icon drawing helpers --

function drawPlayIcon(g: Graphics, s: number) {
  const m = s * 0.25;
  g.moveTo(m, m).lineTo(s - m, s / 2).lineTo(m, s - m).closePath().fill(PixieTheme.textPrimary);
}

function drawQueueIcon(g: Graphics, s: number) {
  const m = s * 0.25;
  const gap = (s - 2 * m) / 4;
  for (let i = 0; i < 3; i++) {
    g.rect(m, m + i * gap * 1.5, s - 2 * m, gap * 0.8).fill(PixieTheme.textPrimary);
  }
}

function drawPlaylistIcon(g: Graphics, s: number) {
  const m = s * 0.22;
  const gap = (s - 2 * m) / 4;
  for (let i = 0; i < 3; i++) {
    g.rect(m, m + i * gap * 1.5, (s - 2 * m) * 0.6, gap * 0.7).fill(PixieTheme.textPrimary);
  }
  // small + in bottom right
  const cx = s - m - 3;
  const cy = s - m - 3;
  const arm = 3;
  g.rect(cx - 1, cy - arm, 2, arm * 2).fill(PixieTheme.textPrimary);
  g.rect(cx - arm, cy - 1, arm * 2, 2).fill(PixieTheme.textPrimary);
}

function drawHeartIcon(g: Graphics, s: number) {
  const cx = s / 2;
  const cy = s * 0.45;
  const r = s * 0.16;
  g.circle(cx - r, cy, r).fill(PixieTheme.error);
  g.circle(cx + r, cy, r).fill(PixieTheme.error);
  g.moveTo(cx - r * 2, cy + 1).lineTo(cx, s * 0.78).lineTo(cx + r * 2, cy + 1).closePath().fill(PixieTheme.error);
}

function drawDownloadIcon(g: Graphics, s: number) {
  const m = s * 0.25;
  const cx = s / 2;
  g.rect(cx - 2, m, 4, s * 0.35).fill(PixieTheme.textPrimary);
  g.moveTo(cx - 6, m + s * 0.3).lineTo(cx, s * 0.62).lineTo(cx + 6, m + s * 0.3).closePath().fill(PixieTheme.textPrimary);
  g.rect(m, s - m - 3, s - 2 * m, 3).fill(PixieTheme.textPrimary);
}

// fallback album icon — donut/disc shape
export function drawAlbumFallback(g: Graphics, size: number) {
  const cx = size / 2;
  const cy = size / 2;
  g.circle(cx, cy, size * 0.42).fill(PixieTheme.bgHover).stroke({ width: 2, color: PixieTheme.borderStrong });
  g.circle(cx, cy, size * 0.12).fill(PixieTheme.bgTertiary).stroke({ width: 1, color: PixieTheme.borderDefault });
  g.circle(cx, cy, size * 0.28).stroke({ width: 1, color: PixieTheme.borderDefault, alpha: 0.4 });
}

// full-screen overlay showing album detail when a card is double-clicked.
// rendered in pixi so it lives inside the canvas.
export class AlbumDetail extends Container {
  private app: Application;
  private onClose: () => void;
  private artContainer: Container;
  private artImages: Sprite[] = [];
  private artIndex = 0;

  constructor(app: Application, data: AlbumData, onClose: () => void) {
    super();
    this.app = app;
    this.onClose = onClose;
    this.artContainer = new Container();

    this.eventMode = "static";

    this.build(data);
    this.loadArt(data);
  }

  private build(data: AlbumData) {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;

    // dim backdrop — click to close
    const backdrop = new Graphics();
    backdrop.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: 0.7 });
    backdrop.eventMode = "static";
    backdrop.cursor = "pointer";
    backdrop.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.close();
    });
    this.addChild(backdrop);

    // panel
    const px = Math.round((sw - PANEL_W) / 2);
    const py = Math.round((sh - PANEL_H) / 2);
    const panel = new Container();
    panel.x = px;
    panel.y = py;

    const panelBg = new Graphics();
    panelBg.roundRect(0, 0, PANEL_W, PANEL_H, 8).fill(PixieTheme.bgTertiary)
      .stroke({ width: 1, color: PixieTheme.borderStrong });
    panelBg.eventMode = "static"; // block clicks through to backdrop
    panelBg.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());
    panel.addChild(panelBg);

    // close button (top right)
    const closeBtn = new Container();
    const closeBg = new Graphics();
    closeBg.circle(0, 0, 14).fill(PixieTheme.bgHover).stroke({ width: 1, color: PixieTheme.borderDefault });
    closeBtn.addChild(closeBg);
    const closeX = txt("x", { fill: PixieTheme.css.textPrimary, fontSize: 14 });
    closeX.anchor.set(0.5);
    closeBtn.addChild(closeX);
    closeBtn.x = PANEL_W - PAD;
    closeBtn.y = PAD;
    closeBtn.eventMode = "static";
    closeBtn.cursor = "pointer";
    closeBtn.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.close();
    });
    panel.addChild(closeBtn);

    // art area with placeholder + fallback disc icon
    const artPlaceholder = new Graphics();
    artPlaceholder.roundRect(0, 0, ART_SIZE, ART_SIZE, 4).fill(PixieTheme.bgHover);
    this.artContainer.addChild(artPlaceholder);

    const fallbackIcon = new Graphics();
    drawAlbumFallback(fallbackIcon, ART_SIZE);
    fallbackIcon.label = "fallback";
    this.artContainer.addChild(fallbackIcon);

    this.artContainer.x = PAD;
    this.artContainer.y = PAD;
    panel.addChild(this.artContainer);

    // metadata (right of art)
    const metaX = PAD + ART_SIZE + PAD;
    let metaY = PAD;

    const title = txt(data.title, {
      fill: PixieTheme.css.textPrimary, fontSize: 18, fontWeight: "bold",
      wordWrap: true, wordWrapWidth: PANEL_W - metaX - PAD,
    });
    title.x = metaX;
    title.y = metaY;
    panel.addChild(title);
    metaY += title.height + 6;

    const artist = txt(data.artist, { fill: PixieTheme.css.accent500, fontSize: 14 });
    artist.x = metaX;
    artist.y = metaY;
    panel.addChild(artist);
    metaY += artist.height + 6;

    const info = txt(
      `${data.year}  --  ${data.trackCount} tracks  --  ${formatDuration(data.duration)}`,
      { fill: PixieTheme.css.textTertiary, fontSize: 11 },
    );
    info.x = metaX;
    info.y = metaY;
    panel.addChild(info);
    metaY += info.height + 6;

    // star rating
    const stars = txt(
      "★".repeat(Math.round(data.rating)) + "☆".repeat(5 - Math.round(data.rating)),
      { fill: PixieTheme.css.accent500, fontSize: 14 },
    );
    stars.x = metaX;
    stars.y = metaY;
    panel.addChild(stars);
    metaY += stars.height + 10;

    // icon action buttons
    const actions: { icon: (g: Graphics, s: number) => void; tip: string }[] = [
      { icon: drawPlayIcon, tip: "play" },
      { icon: drawQueueIcon, tip: "add to queue" },
      { icon: drawPlaylistIcon, tip: "add to playlist" },
      { icon: drawHeartIcon, tip: "favourite" },
      { icon: drawDownloadIcon, tip: "download" },
    ];
    const btnY = metaY;
    for (let i = 0; i < actions.length; i++) {
      const btn = this.makeIconButton(actions[i].icon, actions[i].tip, panel);
      btn.x = metaX + i * (ICON_BTN_SIZE + ICON_BTN_GAP);
      btn.y = btnY;
      panel.addChild(btn);
    }

    // track list (below art, scrollable area placeholder)
    const trackY = PAD + ART_SIZE + PAD;
    const trackHeader = txt("tracklist", {
      fill: PixieTheme.css.textTertiary, fontSize: 11, fontWeight: "bold",
    });
    trackHeader.x = PAD;
    trackHeader.y = trackY;
    panel.addChild(trackHeader);

    if (data.tracks && data.tracks.length > 0) {
      const maxVisible = Math.min(data.tracks.length, Math.floor((PANEL_H - trackY - 40) / TRACK_ROW_H));
      for (let i = 0; i < maxVisible; i++) {
        const track = data.tracks[i];
        const rowY = trackY + 20 + i * TRACK_ROW_H;

        const num = txt(`${i + 1}.`, { fill: PixieTheme.css.textMuted, fontSize: 11 });
        num.x = PAD;
        num.y = rowY;
        panel.addChild(num);

        const trackTitle = txt(track.title, { fill: PixieTheme.css.textPrimary, fontSize: 11 });
        trackTitle.x = PAD + 28;
        trackTitle.y = rowY;
        panel.addChild(trackTitle);

        const dur = txt(formatDuration(track.durationSeconds), { fill: PixieTheme.css.textMuted, fontSize: 11 });
        dur.x = PANEL_W - PAD - 40;
        dur.y = rowY;
        panel.addChild(dur);
      }

      if (data.tracks.length > maxVisible) {
        const more = txt(
          `+ ${data.tracks.length - maxVisible} more tracks`,
          { fill: PixieTheme.css.textMuted, fontSize: 10 },
        );
        more.x = PAD + 28;
        more.y = trackY + 20 + maxVisible * TRACK_ROW_H;
        panel.addChild(more);
      }
    } else {
      const noTracks = txt(
        `${data.trackCount} tracks (not loaded)`,
        { fill: PixieTheme.css.textMuted, fontSize: 11 },
      );
      noTracks.x = PAD + 28;
      noTracks.y = trackY + 20;
      panel.addChild(noTracks);
    }

    this.addChild(panel);
  }

  private async loadArt(data: AlbumData) {
    const urls = data.imageUrls && data.imageUrls.length > 0
      ? data.imageUrls
      : data.thumbnailUrl ? [data.thumbnailUrl] : [];

    if (urls.length === 0) return; // keep fallback visible

    const loaded: Sprite[] = [];
    for (const url of urls) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
        });
        const tex = Texture.from(img);
        const sprite = new Sprite(tex);
        sprite.width = ART_SIZE;
        sprite.height = ART_SIZE;
        sprite.visible = false;
        loaded.push(sprite);
      } catch {
        // skip failed image
      }
    }

    if (loaded.length === 0) return; // keep fallback

    // hide fallback
    for (const child of this.artContainer.children) {
      if (child.label === "fallback") child.visible = false;
    }

    this.artImages = loaded;
    for (const s of loaded) this.artContainer.addChild(s);
    this.artIndex = 0;
    loaded[0].visible = true;

    // carousel buttons if multiple images
    if (loaded.length > 1) {
      const prevBtn = this.makeCarouselButton("<", -1);
      prevBtn.x = 4;
      prevBtn.y = ART_SIZE / 2 - 12;
      this.artContainer.addChild(prevBtn);

      const nextBtn = this.makeCarouselButton(">", 1);
      nextBtn.x = ART_SIZE - 28;
      nextBtn.y = ART_SIZE / 2 - 12;
      this.artContainer.addChild(nextBtn);
    }
  }

  private makeCarouselButton(label: string, dir: number): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, 24, 24, 4).fill({ color: 0x000000, alpha: 0.6 });
    btn.addChild(bg);

    const t = txt(label, { fill: PixieTheme.css.textPrimary, fontSize: 14 });
    t.anchor.set(0.5);
    t.x = 12;
    t.y = 12;
    btn.addChild(t);

    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.showArtImage(this.artIndex + dir);
    });

    return btn;
  }

  private showArtImage(idx: number) {
    if (this.artImages.length === 0) return;
    idx = ((idx % this.artImages.length) + this.artImages.length) % this.artImages.length;
    this.artImages[this.artIndex].visible = false;
    this.artIndex = idx;
    this.artImages[idx].visible = true;
  }

  private makeIconButton(
    drawIcon: (g: Graphics, s: number) => void,
    tooltip: string,
    panel: Container,
  ): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, ICON_BTN_SIZE, ICON_BTN_SIZE, 4)
      .fill({ color: PixieTheme.accent600, alpha: 0.15 })
      .stroke({ width: 1, color: PixieTheme.accent600 });
    btn.addChild(bg);

    const icon = new Graphics();
    drawIcon(icon, ICON_BTN_SIZE);
    btn.addChild(icon);

    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());

    // tooltip on hover
    let tip: Container | null = null;
    btn.on("pointerenter", () => {
      tip = new Container();
      const tipText = txt(tooltip, { fill: PixieTheme.css.textPrimary, fontSize: 10 });
      const tw = tipText.width + 8;
      const tipBg = new Graphics();
      tipBg.roundRect(0, 0, tw, 18, 3).fill({ color: 0x000000, alpha: 0.85 });
      tip.addChild(tipBg);
      tipText.x = 4;
      tipText.y = 2;
      tip.addChild(tipText);
      tip.x = btn.x + (ICON_BTN_SIZE - tw) / 2;
      tip.y = btn.y + ICON_BTN_SIZE + 4;
      panel.addChild(tip);
    });
    btn.on("pointerleave", () => {
      if (tip) {
        tip.destroy();
        tip = null;
      }
    });

    return btn;
  }

  private close() {
    this.onClose();
    this.destroy({ children: true });
  }
}
