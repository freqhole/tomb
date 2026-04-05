// ---------------------------------------------------------------------------
// settings tab — privacy settings with pill-style option selectors
// ---------------------------------------------------------------------------

import { Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  setFriendRequestsFrom as bridgeSetFriendRequestsFrom,
  setProfileVisibility as bridgeSetProfileVisibility,
} from "../../../src/p2p/friendz-bridge";
import {
  ACCENT,
  FIELD_BG,
  FIELD_BORDER,
  FONT,
  LABEL_COLOR,
  LABEL_SIZE,
  MUTED_TEXT,
  OPTION_FONT_SIZE,
  OPTION_PILL_GAP,
  OPTION_PILL_HEIGHT,
  OPTION_PILL_RADIUS,
  RESOLUTION,
  SETTINGS_ROW_HEIGHT,
} from "./constants";
import type { TabContext, TabController } from "./types";

// ---------------------------------------------------------------------------
// pill builder — shared between both settings sections
// ---------------------------------------------------------------------------

interface PillRowOptions<T extends string> {
  /** label shown above the pill row */
  label: string;
  /** ordered options to render as pills */
  options: T[];
  /** returns the currently active value from the doc */
  readValue: () => T;
  /** called when user taps a pill */
  onSelect: (value: T) => void;
}

/**
 * render a label + row of pill toggles into `parent` at the given y offset.
 * returns the total height consumed so the caller can stack sections.
 */
function buildPillRow<T extends string>(
  parent: Container,
  y: number,
  opts: PillRowOptions<T>
): number {
  let sy = y;

  // section label
  const label = new Text({
    text: opts.label,
    style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
    resolution: RESOLUTION,
  });
  label.eventMode = "none";
  label.x = 0;
  label.y = sy;
  parent.addChild(label);
  sy += LABEL_SIZE + 8;

  let px = 0;
  const activeValue = opts.readValue();

  for (const opt of opts.options) {
    const isActive = activeValue === opt;
    const pillW = Math.max(60, opt.length * (OPTION_FONT_SIZE * 0.65) + 20);

    const pill = new Container();
    pill.eventMode = "static";
    pill.cursor = "pointer";
    pill.hitArea = new Rectangle(0, 0, pillW, OPTION_PILL_HEIGHT);
    pill.x = px;
    pill.y = sy;

    // background — filled accent when active, outlined field when inactive
    const pillBg = new Graphics();
    pillBg.roundRect(0, 0, pillW, OPTION_PILL_HEIGHT, OPTION_PILL_RADIUS);
    if (isActive) {
      pillBg.fill({ color: ACCENT });
    } else {
      pillBg.fill({ color: FIELD_BG });
      pillBg.stroke({ color: FIELD_BORDER, width: 1 });
    }
    pill.addChild(pillBg);

    const pillText = new Text({
      text: opt,
      style: {
        fontFamily: FONT,
        fontSize: OPTION_FONT_SIZE,
        fill: isActive ? 0xffffff : MUTED_TEXT,
      },
      resolution: RESOLUTION,
    });
    pillText.eventMode = "none";
    pillText.x = (pillW - pillText.width) / 2;
    pillText.y = (OPTION_PILL_HEIGHT - OPTION_FONT_SIZE) / 2;
    pill.addChild(pillText);

    // capture value for the closure
    const value = opt;
    pill.on("pointertap", (e) => {
      e.stopPropagation();
      opts.onSelect(value);
    });

    parent.addChild(pill);
    px += pillW + OPTION_PILL_GAP;
  }

  // total vertical space consumed: label height + gap + pill row + section spacing
  return sy - y + OPTION_PILL_HEIGHT + SETTINGS_ROW_HEIGHT;
}

// ---------------------------------------------------------------------------
// public factory
// ---------------------------------------------------------------------------

export function createSettingsTab(ctx: TabContext): TabController {
  const container = new Container();
  container.eventMode = "static";

  // -----------------------------------------------------------
  // rebuild all pill rows from current doc state
  // -----------------------------------------------------------
  const rebuild = () => {
    while (container.children.length > 0) {
      container.removeChildAt(0).destroy({ children: true });
    }

    let offsetY = 0;

    // 1. profile visibility — friends | everyone | nobody
    offsetY += buildPillRow<"friends" | "everyone" | "nobody">(container, offsetY, {
      label: "profile visibility",
      options: ["friends", "everyone", "nobody"],
      readValue: () => ctx.doc.current.profileVisibility,
      onSelect: (value) => {
        ctx.doc.change((draft) => {
          draft.profileVisibility = value;
        });
        bridgeSetProfileVisibility(value);
      },
    });

    // 2. incoming requests — everyone | nobody
    buildPillRow<"everyone" | "nobody">(container, offsetY, {
      label: "incoming requests",
      options: ["everyone", "nobody"],
      readValue: () => ctx.doc.current.friendRequestsFrom,
      onSelect: (value) => {
        ctx.doc.change((draft) => {
          draft.friendRequestsFrom = value;
        });
        bridgeSetFriendRequestsFrom(value);
      },
    });
  };

  // initial build
  rebuild();

  // re-render when the doc changes (e.g. synced from another device)
  const unsub = ctx.doc.on("change", () => {
    rebuild();
  });

  // -----------------------------------------------------------
  // TabController interface
  // -----------------------------------------------------------

  return {
    container,

    layout(_width: number, _height: number) {
      // pills are self-sizing; a rebuild picks up new doc state
      rebuild();
    },

    destroy() {
      unsub();
      container.destroy({ children: true });
    },
  };
}
