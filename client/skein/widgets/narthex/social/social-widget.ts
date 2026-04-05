// ---------------------------------------------------------------------------
// social widget — combined card with tabbed sub-views
// ---------------------------------------------------------------------------

import { Container, Graphics, Text } from "pixi.js";
import type {
    WidgetController,
    WidgetFactory,
    WidgetMountContext,
} from "../../../src/widgets/widget-types";
import {
    ACCENT,
    BG,
    BORDER,
    CARD_RADIUS,
    FONT,
    HEADER_SIZE,
    PADDING_X,
    PADDING_Y,
    RESOLUTION,
    TAB_ACTIVE_COLOR,
    TAB_FONT_SIZE,
    TAB_HEIGHT,
    TAB_INACTIVE_COLOR,
    TEXT_COLOR,
} from "./constants";
import { createFriendsTab } from "./friends-tab";
import { createProfileTab } from "./profile-tab";
import { createRequestsTab } from "./requests-tab";
import { socialSchema } from "./schema";
import { createSettingsTab } from "./settings-tab";
import type { TabContext, TabController } from "./types";

// ---------------------------------------------------------------------------
// tab identifiers
// ---------------------------------------------------------------------------

type TabName = "friends" | "requests" | "profile" | "settings";

const TAB_NAMES: readonly TabName[] = ["friends", "requests", "profile", "settings"] as const;

// ---------------------------------------------------------------------------
// widget factory
// ---------------------------------------------------------------------------

export const socialWidget: WidgetFactory<typeof socialSchema> = {
  type: "social",
  metadata: {
    name: "social",
    description: "profile, friends, and social settings",
    version: "0.1.0",
    category: "narthex",
    singleton: true,
    singletonId: "skein-social",
    defaultWidth: 280,
    defaultHeight: 500,
  },
  schema: socialSchema,
  editableProps: [],

  create(ctx: WidgetMountContext<typeof socialSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;
    let activeTab: TabName = "friends";

    // -----------------------------------------------------------------------
    // card background
    // -----------------------------------------------------------------------

    const cardBg = new Graphics();
    container.addChild(cardBg);

    const drawCard = (w: number, h: number) => {
      cardBg.clear();
      cardBg.roundRect(0, 0, w, h, CARD_RADIUS);
      cardBg.fill({ color: BG });
      cardBg.stroke({ color: BORDER, width: 1 });
    };

    // -----------------------------------------------------------------------
    // header
    // -----------------------------------------------------------------------

    const headerText = new Text({
      text: "social",
      style: {
        fontFamily: FONT,
        fontSize: HEADER_SIZE,
        fontWeight: "bold",
        fill: TEXT_COLOR,
      },
      resolution: RESOLUTION,
    });
    headerText.eventMode = "none";
    container.addChild(headerText);

    const headerSep = new Graphics();
    container.addChild(headerSep);

    // -----------------------------------------------------------------------
    // tab bar
    // -----------------------------------------------------------------------

    const tabTexts: Record<TabName, Text> = {} as Record<TabName, Text>;
    for (const name of TAB_NAMES) {
      const t = new Text({
        text: name,
        style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE, fill: TAB_INACTIVE_COLOR },
        resolution: RESOLUTION,
      });
      t.eventMode = "static";
      t.cursor = "pointer";
      container.addChild(t);

      const tabName = name;
      t.on("pointertap", (e) => {
        e.stopPropagation();
        if (activeTab !== tabName) {
          activeTab = tabName;
          layout(currentWidth, currentHeight);
        }
      });

      tabTexts[name] = t;
    }

    const tabUnderline = new Graphics();
    container.addChild(tabUnderline);

    // -----------------------------------------------------------------------
    // tab controllers
    // -----------------------------------------------------------------------

    const tabCtx: TabContext = {
      doc: ctx.doc as any,
      canvasElement: ctx.canvasElement,
      keyboard: ctx.keyboard,
      widgetId: ctx.widgetId,
    };

    const tabs: Record<TabName, TabController> = {
      friends: createFriendsTab(tabCtx),
      requests: createRequestsTab(tabCtx),
      profile: createProfileTab(tabCtx),
      settings: createSettingsTab(tabCtx),
    };

    // tab content container — all tab containers live here
    const tabContent = new Container();
    container.addChild(tabContent);

    for (const tab of Object.values(tabs)) {
      tabContent.addChild(tab.container);
    }

    // -----------------------------------------------------------------------
    // layout
    // -----------------------------------------------------------------------

    const layout = (w: number, h: number) => {
      const state = ctx.doc.current;
      const contentW = w - PADDING_X * 2;
      let y = PADDING_Y;

      // card background
      drawCard(w, h);

      // header
      headerText.x = PADDING_X;
      headerText.y = y;
      y += HEADER_SIZE + 8;

      // header separator
      headerSep.clear();
      headerSep.moveTo(PADDING_X, y);
      headerSep.lineTo(w - PADDING_X, y);
      headerSep.stroke({ color: BORDER, width: 1, alpha: 0.6 });
      y += 6;

      // -- tab bar ----------------------------------------------------------

      // compute pending request count for the requests tab label
      const pendingCount =
        (state.pendingRequests ?? []).filter((r: any) => r.status === "pending").length +
        (state.outboundRequests ?? []).filter((r: any) => r.status === "pending").length;

      tabTexts.requests.text = pendingCount > 0 ? `requests (${pendingCount})` : "requests";

      // update tab text colors
      for (const name of TAB_NAMES) {
        tabTexts[name].style.fill = name === activeTab ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR;
      }

      // position tab labels left-to-right
      const tabGap = 16;
      let tx = PADDING_X;
      for (const name of TAB_NAMES) {
        const t = tabTexts[name];
        t.x = tx;
        t.y = y + (TAB_HEIGHT - TAB_FONT_SIZE) / 2;
        t.visible = true;
        tx += t.width + tabGap;
      }

      // accent underline under the active tab
      tabUnderline.clear();
      const activeText = tabTexts[activeTab];
      tabUnderline.moveTo(activeText.x, y + TAB_HEIGHT - 2);
      tabUnderline.lineTo(activeText.x + activeText.width, y + TAB_HEIGHT - 2);
      tabUnderline.stroke({ color: ACCENT, width: 2 });
      tabUnderline.visible = true;

      y += TAB_HEIGHT + 4;

      // -- content area ------------------------------------------------------

      const contentY = y;
      const contentH = Math.max(0, h - contentY - PADDING_Y);

      tabContent.x = PADDING_X;
      tabContent.y = contentY;

      // show only the active tab, hide the rest
      for (const name of TAB_NAMES) {
        tabs[name].container.visible = name === activeTab;
      }

      // layout the active tab within the available bounds
      tabs[activeTab].layout(contentW, contentH);
    };

    // -----------------------------------------------------------------------
    // subscribe to doc changes so the tab bar re-renders (e.g. pending count)
    // -----------------------------------------------------------------------

    const unsub = ctx.doc.on("change", () => {
      layout(currentWidth, currentHeight);
    });

    // initial layout
    layout(currentWidth, currentHeight);

    // -----------------------------------------------------------------------
    // controller
    // -----------------------------------------------------------------------

    return {
      container,
      destroy() {
        unsub();
        for (const tab of Object.values(tabs)) {
          tab.destroy();
        }
        container.destroy({ children: true });
      },
      resize(w: number, h: number) {
        currentWidth = w;
        currentHeight = h;
        layout(w, h);
      },
    };
  },
};
