// ---------------------------------------------------------------------------
// settings tab — privacy settings with pill-style option selectors
// ---------------------------------------------------------------------------

import { Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  setFriendRequestsFrom as bridgeSetFriendRequestsFrom,
  setProfileVisibility as bridgeSetProfileVisibility,
} from "../../../src/p2p/friendz-bridge";
import { exportIdentityBundle } from "../../../src/p2p/identity";
import { createSkeinInput, type SkeinInputHandle } from "../../../src/widgets/skein-input";
import {
  ACCENT,
  BUTTON_HEIGHT,
  BUTTON_RADIUS,
  FIELD_BG,
  FIELD_BORDER,
  FIELD_HEIGHT,
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
  TEXT_SIZE,
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
  // persistent state for export section
  // -----------------------------------------------------------

  let exportRevealed = false;
  let exportBundleStr = "";
  let exportInputHandle: SkeinInputHandle | null = null;
  let exportCopyLabel: Text | null = null;
  let exportCopyTimer: ReturnType<typeof setTimeout> | null = null;

  // -----------------------------------------------------------
  // rebuild all pill rows from current doc state
  // -----------------------------------------------------------
  const rebuild = () => {
    // clean up export input if it exists (will be recreated)
    if (exportInputHandle) {
      exportInputHandle.destroy();
      exportInputHandle = null;
    }

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
    offsetY += buildPillRow<"everyone" | "nobody">(container, offsetY, {
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

    // 3. export identity section
    const hasIdentity = !!ctx.doc.current.profile.nodeId;

    if (hasIdentity) {
      offsetY += 8;

      // section label
      const exportLabel = new Text({
        text: "identity backup",
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      exportLabel.eventMode = "none";
      exportLabel.x = 0;
      exportLabel.y = offsetY;
      container.addChild(exportLabel);
      offsetY += LABEL_SIZE + 6;

      // description
      const exportDesc = new Text({
        text: "export your private key and friend list as a bundle you can use to restore your identity on another device.",
        style: {
          fontFamily: FONT,
          fontSize: 10,
          fill: MUTED_TEXT,
          wordWrap: true,
          wordWrapWidth: 240,
        },
        resolution: RESOLUTION,
      });
      exportDesc.eventMode = "none";
      exportDesc.x = 0;
      exportDesc.y = offsetY;
      container.addChild(exportDesc);
      offsetY += exportDesc.height + 8;

      if (!exportRevealed) {
        // show the "export identity" button
        const exportBtn = new Container();
        exportBtn.eventMode = "static";
        exportBtn.cursor = "pointer";

        const exportBtnBg = new Graphics();
        // we'll size this after we know the layout width, but use a reasonable default
        const btnW = 240;
        exportBtnBg.roundRect(0, 0, btnW, BUTTON_HEIGHT, BUTTON_RADIUS);
        exportBtnBg.fill({ color: ACCENT });
        exportBtn.addChild(exportBtnBg);
        exportBtn.hitArea = new Rectangle(0, 0, btnW, BUTTON_HEIGHT);

        const exportBtnText = new Text({
          text: "export identity",
          style: { fontFamily: FONT, fontSize: TEXT_SIZE, fontWeight: "bold", fill: 0xffffff },
          resolution: RESOLUTION,
        });
        exportBtnText.eventMode = "none";
        exportBtnText.x = (btnW - exportBtnText.width) / 2;
        exportBtnText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;
        exportBtn.addChild(exportBtnText);

        exportBtn.x = 0;
        exportBtn.y = offsetY;
        container.addChild(exportBtn);

        exportBtn.on("pointertap", (e) => {
          e.stopPropagation();
          // gather all friend node IDs from the social doc
          const friends = ctx.doc.current.friends ?? [];
          const friendNodeIds: string[] = [];
          for (const f of friends) {
            for (const n of f.nodeIds ?? []) {
              if (n.nodeId) friendNodeIds.push(n.nodeId);
            }
          }

          const profile = ctx.doc.current.profile;
          exportIdentityBundle(friendNodeIds, {
            username: profile.username,
            bio: profile.bio,
          })
            .then((bundle) => {
              exportBundleStr = bundle;
              exportRevealed = true;
              rebuild();
            })
            .catch((err) => {
              console.error("[skein:social:settings] export failed:", err);
            });
        });

        offsetY += BUTTON_HEIGHT + 8;
      } else {
        // show the bundle string in a read-only input with copy button

        // warning text
        const warningText = new Text({
          text: "keep this secret — anyone with this key can impersonate you.",
          style: {
            fontFamily: FONT,
            fontSize: 10,
            fill: 0xef4444,
            wordWrap: true,
            wordWrapWidth: 240,
          },
          resolution: RESOLUTION,
        });
        warningText.eventMode = "none";
        warningText.x = 0;
        warningText.y = offsetY;
        container.addChild(warningText);
        offsetY += warningText.height + 8;

        // input field showing the bundle
        const inputW = 240;
        exportInputHandle = createSkeinInput({
          canvasElement: ctx.canvasElement,
          width: inputW,
          height: FIELD_HEIGHT,
          value: exportBundleStr,
        });
        exportInputHandle.input.x = 0;
        exportInputHandle.input.y = offsetY;
        container.addChild(exportInputHandle.input);
        offsetY += FIELD_HEIGHT + 8;

        // copy button row
        const copyRow = new Container();
        copyRow.eventMode = "static";
        copyRow.y = offsetY;
        container.addChild(copyRow);

        const copyBtn = new Container();
        copyBtn.eventMode = "static";
        copyBtn.cursor = "pointer";

        const copyBtnBg = new Graphics();
        const copyBtnW = 70;
        copyBtnBg.roundRect(0, 0, copyBtnW, 24, BUTTON_RADIUS);
        copyBtnBg.fill({ color: ACCENT });
        copyBtn.addChild(copyBtnBg);
        copyBtn.hitArea = new Rectangle(0, 0, copyBtnW, 24);

        exportCopyLabel = new Text({
          text: "copy",
          style: { fontFamily: FONT, fontSize: 10, fontWeight: "bold", fill: 0xffffff },
          resolution: RESOLUTION,
        });
        exportCopyLabel.eventMode = "none";
        exportCopyLabel.x = (copyBtnW - exportCopyLabel.width) / 2;
        exportCopyLabel.y = (24 - 10) / 2;
        copyBtn.addChild(exportCopyLabel);

        copyBtn.x = 0;
        copyRow.addChild(copyBtn);

        // hide button
        const hideBtn = new Container();
        hideBtn.eventMode = "static";
        hideBtn.cursor = "pointer";

        const hideBtnText = new Text({
          text: "hide",
          style: { fontFamily: FONT, fontSize: 10, fill: MUTED_TEXT },
          resolution: RESOLUTION,
        });
        hideBtnText.eventMode = "none";
        hideBtn.addChild(hideBtnText);
        hideBtn.x = copyBtnW + 12;
        hideBtn.y = (24 - 10) / 2;
        copyRow.addChild(hideBtn);

        copyBtn.on("pointertap", (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(exportBundleStr).catch(() => {});
          if (exportCopyLabel) {
            exportCopyLabel.text = "copied!";
            exportCopyLabel.x = (copyBtnW - exportCopyLabel.width) / 2;
          }
          if (exportCopyTimer) clearTimeout(exportCopyTimer);
          exportCopyTimer = setTimeout(() => {
            if (exportCopyLabel) {
              exportCopyLabel.text = "copy";
              exportCopyLabel.x = (copyBtnW - exportCopyLabel.width) / 2;
            }
          }, 5000);
        });

        hideBtn.on("pointertap", (e) => {
          e.stopPropagation();
          exportRevealed = false;
          exportBundleStr = "";
          rebuild();
        });

        offsetY += 24 + 8;
      }
    }
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
      if (exportCopyTimer) clearTimeout(exportCopyTimer);
      if (exportInputHandle) exportInputHandle.destroy();
      container.destroy({ children: true });
    },
  };
}
