import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import type {
  CompactInfo,
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../src/widgets/widget-types";

/**
 * Zod schema for the counter widget's internal state.
 * every field has a .default() so fixture(counterSchema) works
 * and new peers can initialize the document.
 */
export const counterSchema = z.object({
  count: z.number().default(0),
  step: z.number().default(1),
  label: z.string().default("counter"),
});

export type CounterState = z.infer<typeof counterSchema>;

/**
 * a stateful counter widget that syncs its count across peers.
 * demonstrates the WidgetDoc API: current, change(), on("change").
 */
export const counterWidget: WidgetFactory<typeof counterSchema> = {
  type: "counter",
  metadata: {
    name: "counter",
    description: "a simple counter that syncs across peers",
    version: "0.1.0",
    category: "examples",
  },
  schema: counterSchema,
  editableProps: [
    { key: "label", label: "label", type: "string" as const, default: "counter" },
    { key: "step", label: "step size", type: "number" as const, default: 1 },
  ],

  getCompactInfo: (state: CounterState): CompactInfo => ({
    label: `${state.label}: ${state.count}`,
  }),

  create(ctx: WidgetMountContext<typeof counterSchema>): WidgetController {
    const container = new Container();

    // background
    const bg = new Graphics();
    const drawBg = (w: number, h: number) => {
      bg.clear();
      bg.roundRect(0, 0, w, h, 8);
      bg.fill({ color: 0xeff6ff });
      bg.stroke({ color: 0x93c5fd, width: 1 });
    };
    drawBg(ctx.width, ctx.height);
    container.addChild(bg);

    // label text
    const labelText = new Text({
      text: ctx.doc.current.label,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fill: 0x64748b,
      },
    });
    labelText.anchor.set(0.5, 0);
    labelText.x = ctx.width / 2;
    labelText.y = 8;
    container.addChild(labelText);

    // count display
    const countText = new Text({
      text: String(ctx.doc.current.count),
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 24,
        fontWeight: "bold",
        fill: 0x1e40af,
      },
    });
    countText.anchor.set(0.5);
    countText.x = ctx.width / 2;
    countText.y = ctx.height / 2;
    container.addChild(countText);

    // increment button
    const btnWidth = 60;
    const btnHeight = 24;
    const btnContainer = new Container();
    btnContainer.x = (ctx.width - btnWidth) / 2;
    btnContainer.y = ctx.height - btnHeight - 8;
    btnContainer.eventMode = "static";
    btnContainer.cursor = "pointer";

    const btnBg = new Graphics();
    btnBg.roundRect(0, 0, btnWidth, btnHeight, 4);
    btnBg.fill({ color: 0x3b82f6 });
    btnContainer.addChild(btnBg);

    const btnLabel = new Text({
      text: `+${ctx.doc.current.step}`,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fill: 0xffffff,
      },
    });
    btnLabel.anchor.set(0.5);
    btnLabel.x = btnWidth / 2;
    btnLabel.y = btnHeight / 2;
    btnContainer.addChild(btnLabel);

    container.addChild(btnContainer);

    // click handler — mutates state via the WidgetDoc facade
    btnContainer.on("pointertap", () => {
      ctx.doc.change((draft) => {
        draft.count += draft.step;
      });
    });

    // subscribe to state changes (including from remote peers)
    const unsub = ctx.doc.on("change", (state) => {
      countText.text = String(state.count);
      labelText.text = state.label;
      btnLabel.text = `+${state.step}`;
    });

    return {
      container,
      destroy() {
        unsub();
        container.destroy({ children: true });
      },
      resize(width: number, height: number) {
        drawBg(width, height);
        labelText.x = width / 2;
        countText.x = width / 2;
        countText.y = height / 2;
        btnContainer.x = (width - btnWidth) / 2;
        btnContainer.y = height - btnHeight - 8;
      },
    };
  },
};
