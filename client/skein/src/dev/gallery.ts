import { Repo } from "@automerge/automerge-repo";
import { Application } from "pixi.js";
import { createTestRegistry } from "../../widgets/index";
import { createWidgetDoc } from "../widgets/widget-doc";
import type { WidgetDoc, WidgetFactory } from "../widgets/widget-types";

/**
 * mount the widget gallery — renders each registered widget
 * in its own pixi application for visual inspection.
 */
async function mountGallery(): Promise<void> {
  const registry = createTestRegistry();
  const gallery = document.getElementById("gallery")!;
  const repo = new Repo({});

  for (const factory of registry.all()) {
    const card = createCard(factory);
    gallery.appendChild(card);

    const mountEl = card.querySelector(".widget-mount") as HTMLElement;
    const defaultWidth = 200;
    const defaultHeight = 120;

    // create a pixi app for this widget
    const app = new Application();
    await app.init({
      width: defaultWidth,
      height: defaultHeight,
      background: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    mountEl.appendChild(app.canvas);

    // create the widget doc (real or no-op depending on schema)
    let doc: WidgetDoc<any>;
    if (factory.schema) {
      const handle = repo.create();
      const defaults = factory.schema.parse({});
      handle.change((d: any) => Object.assign(d, defaults));
      doc = createWidgetDoc(factory.schema, handle);
    } else {
      // stateless widgets don't use the doc, so provide a no-op facade
      doc = {
        get current() {
          return {};
        },
        change() {},
        on() {
          return () => {};
        },
      };
    }

    // mount the widget
    try {
      const ctrl = factory.create({ doc, width: defaultWidth, height: defaultHeight });
      app.stage.addChild(ctrl.container);
    } catch (err) {
      console.error(`failed to create widget "${factory.type}":`, err);
      mountEl.textContent = `error: ${err}`;
    }
  }
}

/** build the DOM card element for a single widget factory */
function createCard(factory: WidgetFactory): HTMLElement {
  const card = document.createElement("div");
  card.className = "widget-card";

  const title = document.createElement("h2");
  title.textContent = factory.metadata.name;
  card.appendChild(title);

  if (factory.metadata.description) {
    const desc = document.createElement("div");
    desc.className = "description";
    desc.textContent = factory.metadata.description;
    card.appendChild(desc);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const parts = [`type: ${factory.type}`, `v${factory.metadata.version}`];
  if (factory.metadata.category) parts.push(factory.metadata.category);
  if (factory.schema) parts.push("stateful");
  else parts.push("stateless");
  meta.textContent = parts.join(" · ");
  card.appendChild(meta);

  const mount = document.createElement("div");
  mount.className = "widget-mount";
  card.appendChild(mount);

  return card;
}

mountGallery().catch((err) => {
  console.error("gallery init failed:", err);
});
