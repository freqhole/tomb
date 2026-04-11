import type { DocumentId, Repo } from "@automerge/automerge-repo";
import { CanvasStore } from "../canvas/canvas-store";

// well-known singleton widget IDs — must match the singletonId in each factory's metadata
export const SOCIAL_WIDGET_ID = "skein-social";
export const MESSAGEZ_WIDGET_ID = "skein-messagez";

/**
 * creates a fresh narthex canvas document and seeds it with the default set of
 * widgets: a decorative label, social, and messagez.
 *
 * returns the CanvasStore so the caller can grab the documentId and persist it.
 */
export function createNarthexWithSeed(repo: Repo): CanvasStore {
  const store = CanvasStore.create(repo);

  // seed with a big pink cursive "narthex" title label in the center
  store.addWidget({
    id: crypto.randomUUID(),
    type: "label",
    title: "narthex",
    x: 80,
    y: 30,
    width: 560,
    height: 144,
    zIndex: 0,
    props: {
      text: "narthex",
      textColor: 0xd946ef,
      bgColor: -1,
      borderColor: -1,
      fontFamily: "Silkscreen",
    },
    collapsed: false,
    docId: null,
    parentId: null,
  });

  // seed with a social widget in the top-right area
  store.addWidget({
    id: SOCIAL_WIDGET_ID,
    type: "social",
    x: 700,
    y: 30,
    width: 280,
    height: 500,
    zIndex: 1,
    props: {},
    collapsed: false,
    docId: null,
    parentId: null,
  });

  // seed with a messagez widget below the narthex label
  store.addWidget({
    id: MESSAGEZ_WIDGET_ID,
    type: "messagez",
    x: 80,
    y: 232,
    width: 560,
    height: 280,
    zIndex: 2,
    props: {},
    collapsed: false,
    docId: null,
    parentId: null,
  });

  // seed with a welcome markdown widget below the inbox
  store.addWidget({
    id: crypto.randomUUID(),
    type: "markdown",
    x: 80,
    y: 560,
    width: 560,
    height: 560,
    zIndex: 3,
    props: {
      text: "# welcome to skein 🧶\n\nthis is the **narthex**; yr home canvas where you can see all of your own stuff, frenz, and when frenz share stuff with you.\n\n## getting started\n\n- **create a canvas** by double-clicking any empty space in the canvas or using the `+` button in the top right\n- **drag and drop** widgetz to rearrange things however you like; put them in a bin to keep it tidy (or not, nobody will ever know how messy you are).\n- **double-click** this widget to edit this text\n\n## connect with frenz\n\nset up yr **identity** in the social widget to enable peer-to-peer sharing. generate an identity, then share your **node id** (a 64-character string) with frenz so you can share with each other.\n\nonce connected, you can **share and collaborate** together. it's fully peer-to-peer — frenz need to be online at the same time to sync.\n\nyou will see incoming canvas invitez in the message widget above.\n\n## what is a canvas?\n\na canvas is like a shared zine — add text, images, video, audio, PDFz, or any type of file. everyone invited to a canvas can see and contribute to it.\n\n*double-click to edit the text in this widget, or drag it to the trash bin to remove it.*\n\n## what is a widget?\n\na widget can be a image, or a file, or bin of other widgetz!\n\n---\n\nmade with <3 in NYC",
    },
    collapsed: false,
    docId: null,
    parentId: null,
  });

  return store;
}

/**
 * opens an existing narthex document and re-seeds any singleton widgets that
 * are missing. this handles cases where widgets were lost due to a bug or
 * schema migration.
 */
export async function ensureSingletonWidgets(repo: Repo, narthexDocId: DocumentId): Promise<void> {
  const store = await CanvasStore.open(repo, narthexDocId);
  const widgets = store.doc().widgets;

  if (!widgets[SOCIAL_WIDGET_ID]) {
    console.log("[skein] re-seeding missing social widget");
    store.addWidget({
      id: SOCIAL_WIDGET_ID,
      type: "social",
      x: 700,
      y: 30,
      width: 280,
      height: 500,
      zIndex: Object.keys(widgets).length + 1,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  }

  if (!widgets[MESSAGEZ_WIDGET_ID]) {
    console.log("[skein] re-seeding missing messagez widget");
    store.addWidget({
      id: MESSAGEZ_WIDGET_ID,
      type: "messagez",
      x: 60,
      y: 200,
      width: 560,
      height: 280,
      zIndex: Object.keys(widgets).length + 3,
      props: {},
      collapsed: false,
      docId: null,
      parentId: null,
    });
  }
}
