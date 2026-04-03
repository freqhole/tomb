import { Container, Graphics, Text } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { WidgetController } from "../widgets/widget-types";

/**
 * create a crashed placeholder widget.
 * renders a red-tinted box with an error message.
 * used when a widget factory throws or when the type is unknown.
 */
export function createCrashedPlaceholder(
  width: number,
  height: number,
  reason: string,
  theme: SkeinTheme
): WidgetController {
  const container = new Container();

  const bg = new Graphics();
  const drawBg = (w: number, h: number) => {
    bg.clear();
    bg.roundRect(0, 0, w, h, theme.frameCornerRadius);
    bg.fill({ color: 0x2a1a1a });
    bg.stroke({ color: theme.error, width: 1 });
  };
  drawBg(width, height);
  container.addChild(bg);

  const icon = new Text({
    text: "!",
    resolution: theme.textResolution,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: 20,
      fontWeight: "bold",
      fill: theme.error,
    },
  });
  icon.anchor.set(0.5);
  icon.x = width / 2;
  icon.y = height / 2 - 12;
  container.addChild(icon);

  const msg = new Text({
    text: reason.length > 40 ? reason.slice(0, 37) + "..." : reason,
    resolution: theme.textResolution,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: 0x888888,
    },
  });
  msg.anchor.set(0.5);
  msg.x = width / 2;
  msg.y = height / 2 + 12;
  container.addChild(msg);

  return {
    container,
    destroy() {
      container.destroy({ children: true });
    },
    resize(w: number, h: number) {
      drawBg(w, h);
      icon.x = w / 2;
      icon.y = h / 2 - 12;
      msg.x = w / 2;
      msg.y = h / 2 + 12;
    },
  };
}
