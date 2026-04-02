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
const BTN_W = 70;
const BTN_H = 28;
const BTN_GAP = 8;
const TRACK_ROW_H = 22;

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// full-screen overlay showing album detail when a card is double-clicked.
// rendered in pixi so it lives inside the canvas.
export class AlbumDetail extends Container {
  private app: Application;
  private onClose: () => void;

  constructor(app: Application, data: AlbumData, onClose: () => void) {
    super();
    this.app = app;
    this.onClose = onClose;

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

    // art placeholder (will be replaced by loaded image)
    const artPlaceholder = new Graphics();
    artPlaceholder.roundRect(PAD, PAD, ART_SIZE, ART_SIZE, 4).fill(PixieTheme.bgHover);
    panel.addChild(artPlaceholder);

    // metadata (right of art)
    const metaX = PAD + ART_SIZE + PAD;
    const title = txt(data.title, {
      fill: PixieTheme.css.textPrimary, fontSize: 18, fontWeight: "bold",
      wordWrap: true, wordWrapWidth: PANEL_W - metaX - PAD,
    });
    title.x = metaX;
    title.y = PAD;
    panel.addChild(title);

    const artist = txt(data.artist, { fill: PixieTheme.css.accent500, fontSize: 14 });
    artist.x = metaX;
    artist.y = PAD + 26;
    panel.addChild(artist);

    const info = txt(
      `${data.year}  --  ${data.trackCount} tracks  --  ${formatDuration(data.duration)}`,
      { fill: PixieTheme.css.textTertiary, fontSize: 11 },
    );
    info.x = metaX;
    info.y = PAD + 48;
    panel.addChild(info);

    // star rating
    const stars = txt(
      "★".repeat(Math.round(data.rating)) + "☆".repeat(5 - Math.round(data.rating)),
      { fill: PixieTheme.css.accent500, fontSize: 14 },
    );
    stars.x = metaX;
    stars.y = PAD + 68;
    panel.addChild(stars);

    // action buttons
    const actions = ["Play", "Queue", "Playlist", "Fav", "DL"];
    const btnY = PAD + 96;
    for (let i = 0; i < actions.length; i++) {
      const btn = this.makeButton(actions[i], PixieTheme.accent600);
      btn.x = metaX + i * (BTN_W + BTN_GAP);
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
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = data.thumbnailUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
      });

      const tex = Texture.from(img);
      const artSprite = new Sprite(tex);
      artSprite.width = ART_SIZE;
      artSprite.height = ART_SIZE;

      // position inside the panel
      const sw = this.app.screen.width;
      const sh = this.app.screen.height;
      artSprite.x = Math.round((sw - PANEL_W) / 2) + PAD;
      artSprite.y = Math.round((sh - PANEL_H) / 2) + PAD;
      this.addChild(artSprite);
    } catch {
      // failed to load, placeholder stays
    }
  }

  private makeButton(label: string, color: number): Container {
    const btn = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, BTN_W, BTN_H, 4).fill({ color, alpha: 0.15 })
      .stroke({ width: 1, color });
    btn.addChild(bg);

    const text = txt(label, { fill: PixieTheme.css.textPrimary, fontSize: 10 });
    text.anchor.set(0.5);
    text.x = BTN_W / 2;
    text.y = BTN_H / 2;
    btn.addChild(text);

    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      // placeholder — no actual action wired up yet
    });

    return btn;
  }

  private close() {
    this.onClose();
    this.destroy({ children: true });
  }
}
