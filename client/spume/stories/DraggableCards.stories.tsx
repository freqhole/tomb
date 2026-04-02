import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { Application } from "pixi.js";
import { Container as PixiContainer, Graphics, Text, FederatedPointerEvent } from "pixi.js";
import { PixieCanvas, Card, Grid, Shelf, Bin, Toolbar, PixieTheme } from "../src/pixie";
import type { PixieCanvasProps } from "../src/pixie/PixieCanvas";
import type { DropZoneChecker, AlbumData } from "../src/pixie/Card";
import { AlbumDetail } from "../src/pixie/AlbumDetail";
import { mockAlbums, mockSongs } from "./mockData";

function randColor(): number {
  return Math.floor(Math.random() * 0xffffff);
}

// build AlbumData from mock data, attaching matching tracks
function albumDataFromMock(album: (typeof mockAlbums)[0]): AlbumData {
  const tracks = mockSongs
    .filter((s) => s.album === album.title)
    .map((s) => ({ title: s.title, durationSeconds: s.durationSeconds, rating: s.rating }));
  return {
    title: album.title,
    artist: album.artist,
    year: album.year,
    trackCount: album.trackCount,
    duration: album.duration,
    rating: album.rating,
    thumbnailUrl: album.thumbnailUrl,
    tracks,
  };
}

// -- helper to set up the demo scene --

function setupDemoScene(app: Application) {
  const stage = app.stage;
  let albumIdx = 0;

  // initial containers
  const grid = new Grid({
    x: 50,
    y: 50,
    cols: 4,
    rows: 3,
    cellSize: 110,
  });
  stage.addChild(grid);

  const shelf = new Shelf({
    x: 550,
    y: 50,
    cols: 6,
    rows: 4,
  });
  stage.addChild(shelf);

  const bin = new Bin({
    x: 50,
    y: 420,
    cols: 4,
    rows: 4,
  });
  stage.addChild(bin);

  const dropZones: (PixiContainer & DropZoneChecker)[] = [grid, shelf, bin];
  const cards: Card[] = [];

  // album detail overlay state
  let detailOverlay: AlbumDetail | null = null;

  // toolbar — wires up container/label lifecycle
  const toolbar = new Toolbar(app, {
    onContainerAdded: (c) => {
      dropZones.push(c);
      for (const card of cards) {
        card.registerDropZones(dropZones);
      }
    },
    onContainerRemoved: (c) => {
      const idx = dropZones.indexOf(c);
      if (idx >= 0) dropZones.splice(idx, 1);
      for (const card of cards) {
        card.registerDropZones(dropZones);
      }
    },
    onLabelAdded: () => {},
    onLabelRemoved: () => {},
  });

  // register initial containers with toolbar so edit mode works on them
  toolbar.registerContainer(grid);
  toolbar.registerContainer(shelf);
  toolbar.registerContainer(bin);

  stage.addChild(toolbar);

  // scene callbacks for card selection / edit mode / double-click
  const sceneCallbacks = {
    isEditMode: () => toolbar.isEditMode(),
    getSelectedCards: () => toolbar.getSelectedCards(),
    onCardClicked: (_card: Card, _e: unknown) => {},
    onCardDoubleClicked: (card: Card) => {
      if (detailOverlay) return; // already showing
      if (!card.albumData) return;
      detailOverlay = new AlbumDetail(app, card.albumData, () => {
        detailOverlay = null;
      });
      stage.addChild(detailOverlay);
    },
  };

  function addCards(n: number) {
    for (let i = 0; i < n; i++) {
      const album = mockAlbums[albumIdx % mockAlbums.length];
      albumIdx++;
      const card = new Card(app, {
        id: albumIdx,
        label: album.title,
        color: randColor(),
        imageUrl: album.thumbnailUrl,
        albumData: albumDataFromMock(album),
      });
      card.registerDropZones(dropZones);
      card.setSceneCallbacks(sceneCallbacks);
      card.x = 150 + Math.random() * 250;
      card.y = 560 + Math.random() * 60;
      stage.addChild(card);
      cards.push(card);
      toolbar.registerCard(card);
    }
  }

  addCards(8);

  // "add albums" button — bottom-left of canvas
  const addBtn = new Graphics();
  addBtn
    .roundRect(0, 0, 100, 32, 4)
    .fill({ color: PixieTheme.accent600, alpha: 0.2 })
    .stroke({ width: 1, color: PixieTheme.accent500 });
  const addText = new Text({
    text: "+ add albums",
    resolution: PixieTheme.textResolution,
    style: { fill: PixieTheme.css.textPrimary, fontSize: 11, fontFamily: PixieTheme.fontFamily },
  });
  addText.anchor.set(0.5);
  addText.x = 50;
  addText.y = 16;
  const addBtnContainer = new PixiContainer();
  addBtnContainer.addChild(addBtn, addText);
  addBtnContainer.x = 10;
  addBtnContainer.y = app.screen.height - 42;
  addBtnContainer.eventMode = "static";
  addBtnContainer.cursor = "pointer";
  addBtnContainer.on("pointerdown", (e: FederatedPointerEvent) => {
    e.stopPropagation();
    addCards(4);
  });
  stage.addChild(addBtnContainer);

  return undefined;
}

// -- storybook meta --

const meta = {
  title: "Pixie/DraggableCards",
  component: PixieCanvas,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "interactive pixi.js canvas with draggable album cards. 3-button toolbar: navigate (drag cards, lasso multi-select), edit (hover/select/move/delete containers), +add (flyout for grid/shelf/bin/label).",
      },
    },
  },
} satisfies Meta<typeof PixieCanvas>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    setup: setupDemoScene,
  },
  render: (props: PixieCanvasProps) => (
    <div style={{ width: "100vw", height: "100vh", background: "#000000" }}>
      <PixieCanvas {...props} />
    </div>
  ),
};
