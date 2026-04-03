import { Container, Graphics, Text } from "pixi.js";
import type { WidgetController, WidgetFactory, WidgetMountContext } from "../src/widgets/widget-types";

/**
 * a minimal stateless widget that renders "hello, world!" in a colored box.
 * demonstrates the simplest possible widget — no schema, no internal state.
 */
export const helloWorldWidget: WidgetFactory = {
  type: "hello-world",
  metadata: {
    name: "hello world",
    description: "a minimal stateless widget for testing",
    version: "0.1.0",
    category: "examples",
  },
  // no schema — this widget is stateless

  create(ctx: WidgetMountContext): WidgetController {
    const container = new Container();

    const bg = new Graphics();
    bg.roundRect(0, 0, ctx.width, ctx.height, 8);
    bg.fill({ color: 0xf0f4f8 });
    bg.stroke({ color: 0xcbd5e1, width: 1 });
    container.addChild(bg);

    const text = new Text({
      text: "hello, world!",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
        fill: 0x475569,
      },
    });
    text.anchor.set(0.5);
    text.x = ctx.width / 2;
    text.y = ctx.height / 2;
    container.addChild(text);

    return {
      container,
      destroy() {
        container.destroy({ children: true });
      },
      resize(width: number, height: number) {
        bg.clear();
        bg.roundRect(0, 0, width, height, 8);
        bg.fill({ color: 0xf0f4f8 });
        bg.stroke({ color: 0xcbd5e1, width: 1 });
        text.x = width / 2;
        text.y = height / 2;
      },
    };
  },
};
