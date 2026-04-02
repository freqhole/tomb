import { Component, onCleanup, onMount } from "solid-js";
import { Application } from "pixi.js";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";

export interface PixieCanvasProps {
  setup: (app: Application) => void | (() => void);
  class?: string;
}

// thin solidjs mount-point that creates a pixi application and hands it off.
// all visual content is pure pixi — the only dom element is the container div
// holding the canvas.
const PixieCanvas: Component<PixieCanvasProps> = (props) => {
  let container!: HTMLDivElement;
  let app: Application | null = null;
  let userTeardown: (() => void) | void = undefined;

  // register cleanup synchronously so solidjs tracks it
  onCleanup(() => {
    userTeardown?.();
    if (app) {
      app.destroy(true, { children: true });
      app = null;
    }
  });

  onMount(async () => {
    app = new Application();
    await app.init({
      background: 0x000000,
      antialias: true,
      resolution: window.devicePixelRatio || 2,
      autoDensity: true,
      resizeTo: container,
    });
    container.appendChild(app.canvas);

    // stage needs to be interactive so it can receive global pointer events
    // (used by Card for drag tracking)
    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;

    userTeardown = props.setup(app);
  });

  return (
    <div
      ref={container}
      class={props.class}
      style={{ width: "100%", height: "100%", overflow: "auto" }}
    />
  );
};

export default PixieCanvas;
