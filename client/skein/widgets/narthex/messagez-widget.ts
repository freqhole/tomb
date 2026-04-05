// ---------------------------------------------------------------------------
// messagez widget — headless singleton for messaging/sharing settings
//
// this widget has no visual representation. it exists solely to own an
// automerge doc that stores privacy settings for canvas invites and other
// messaging-related configuration. the protocol handler reads from this doc
// to decide whether to accept incoming invites.
//
// seeded in boot.ts with singletonId "skein-messagez". the inbox widget
// reads/writes settings from this doc for its settings UI.
// ---------------------------------------------------------------------------

import { Container } from "pixi.js";
import { z } from "zod";
import type {
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

export const messagezSchema = z.object({
  /** who can send us canvas invites. */
  canvasInvitesFrom: z.enum(["everyone", "friends", "nobody"]).default("everyone"),
});

export type MessagezState = z.infer<typeof messagezSchema>;

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export const messagezWidget: WidgetFactory<typeof messagezSchema> = {
  type: "messagez",
  metadata: {
    name: "messagez",
    description: "messaging and sharing privacy settings (headless)",
    version: "0.1.0",
    category: "narthex",
    hidden: true,
    singleton: true,
    singletonId: "skein-messagez",
    defaultWidth: 0,
    defaultHeight: 0,
  },
  schema: messagezSchema,
  editableProps: [],

  create(_ctx: WidgetMountContext<typeof messagezSchema>): WidgetController {
    // headless widget — empty container, no rendering
    const container = new Container();
    container.visible = false;

    return {
      container,
      destroy(): void {
        container.destroy({ children: true });
      },
    };
  },
};
