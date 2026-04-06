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
    x: 80,
    y: 30,
    width: 600,
    height: 160,
    zIndex: 0,
    props: {
      text: "narthex",
      textColor: 0xd946ef,
      bgColor: -1,
      borderColor: -1,
      fontFamily: "cursive",
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
    x: 60,
    y: 200,
    width: 560,
    height: 280,
    zIndex: 2,
    props: {},
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
