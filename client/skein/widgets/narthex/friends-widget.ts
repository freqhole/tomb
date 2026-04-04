import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import type { KeyboardHandler } from "../../src/widgets/keyboard-driver";
import type {
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

const friendEntrySchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  nodeId: z.string().default(""),
  createdAt: z.string().default(""),
});

export const friendsSchema = z.object({
  friends: z.array(friendEntrySchema).default([]),
});

export type FriendsState = z.infer<typeof friendsSchema>;
export type FriendEntry = z.infer<typeof friendEntrySchema>;

// ---------------------------------------------------------------------------
// visual constants
// ---------------------------------------------------------------------------

const BG = 0x1a1a24;
const BORDER = 0x2a2a3e;
const FIELD_BG = 0x12121a;
const FIELD_BORDER = 0x333348;
const FIELD_BORDER_ACTIVE = 0x6366f1;
const LABEL_COLOR = 0x888898;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;
const ACCENT = 0x6366f1;

const COLOR_PALETTE = [
  0xd946ef, 0x6366f1, 0x06b6d4, 0x10b981, 0xeab308, 0xf97316, 0xef4444, 0x8b5cf6,
];

const CARD_RADIUS = 6;
const FIELD_RADIUS = 4;
const BUTTON_RADIUS = 4;
const PADDING_X = 16;
const PADDING_Y = 14;
const FIELD_HEIGHT = 28;
const LABEL_SIZE = 10;
const TEXT_SIZE = 12;
const HEADER_SIZE = 14;
const FIELD_GAP = 10;
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 8;
const FONT = "system-ui, sans-serif";
const RESOLUTION = 3;

const ROW_HEIGHT = 44;
const ROW_PADDING_X = 10;
const ROW_AVATAR_SIZE = 16;
const ROW_NAME_SIZE = 12;
const ROW_SUB_SIZE = 10;
const ROW_ALT_BG = 0x1e1e2a;
const REMOVE_BTN_SIZE = 16;
const BADGE_HEIGHT = 18;
const BADGE_RADIUS = 9;
const BADGE_FONT_SIZE = 10;
const SCROLL_SPEED = 20;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// simple hash to pick a palette color from a string
function colorForName(name: string, index: number): number {
  if (!name) return COLOR_PALETTE[index % COLOR_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - 1).trimEnd() + "\u2026";
}

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export const friendsWidget: WidgetFactory<typeof friendsSchema> = {
  type: "friends",
  metadata: {
    name: "friends",
    description: "peer identity directory — add and manage friends",
    version: "0.1.0",
    category: "narthex",
    defaultWidth: 260,
    defaultHeight: 400,
  },
  schema: friendsSchema,
  editableProps: [],

  create(ctx: WidgetMountContext<typeof friendsSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // track the currently-active field's stop-editing closure
    let activeStopEditing: (() => void) | null = null;

    // whether we're in "add friend" mode
    let addMode = false;

    // scroll state
    let scrollY = 0;

    // ordered list of field stop/start helpers for tab navigation
    const fieldStarters: (() => void)[] = [];

    // ---------------------------------------------------------------------------
    // background card
    // ---------------------------------------------------------------------------

    const cardBg = new Graphics();
    container.addChild(cardBg);

    const drawCard = (w: number, h: number) => {
      cardBg.clear();
      cardBg.roundRect(0, 0, w, h, CARD_RADIUS);
      cardBg.fill({ color: BG });
      cardBg.stroke({ color: BORDER, width: 1 });
    };

    // ---------------------------------------------------------------------------
    // header
    // ---------------------------------------------------------------------------

    const headerText = new Text({
      text: "friends",
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

    // count badge
    const badgeBg = new Graphics();
    badgeBg.eventMode = "none";
    container.addChild(badgeBg);

    const badgeText = new Text({
      text: "0",
      style: {
        fontFamily: FONT,
        fontSize: BADGE_FONT_SIZE,
        fill: MUTED_TEXT,
      },
      resolution: RESOLUTION,
    });
    badgeText.eventMode = "none";
    container.addChild(badgeText);

    const headerSep = new Graphics();
    container.addChild(headerSep);

    const drawBadge = (count: number) => {
      badgeText.text = String(count);
      const textW = badgeText.width;
      const pillW = Math.max(BADGE_HEIGHT, textW + 12);

      badgeBg.clear();
      badgeBg.roundRect(0, 0, pillW, BADGE_HEIGHT, BADGE_RADIUS);
      badgeBg.fill({ color: FIELD_BG });
      badgeBg.stroke({ color: FIELD_BORDER, width: 1 });

      // position badge text centered in the pill
      badgeText.x = badgeBg.x + (pillW - textW) / 2;
      badgeText.y = badgeBg.y + (BADGE_HEIGHT - BADGE_FONT_SIZE) / 2;
    };

    // ---------------------------------------------------------------------------
    // friend list area (scrollable, masked)
    // ---------------------------------------------------------------------------

    const listContainer = new Container();
    listContainer.eventMode = "static";
    container.addChild(listContainer);

    const listMask = new Graphics();
    container.addChild(listMask);
    listContainer.mask = listMask;

    // inner container for friend rows — positioned by scrollY
    const listInner = new Container();
    listInner.eventMode = "static";
    listContainer.addChild(listInner);

    // placeholder text for empty state
    const emptyText = new Text({
      text: "no friends yet",
      style: {
        fontFamily: FONT,
        fontSize: 11,
        fill: MUTED_TEXT,
      },
      resolution: RESOLUTION,
    });
    emptyText.eventMode = "none";
    container.addChild(emptyText);

    // scroll handler on the list container
    listContainer.on("wheel", (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      scrollY += e.deltaY > 0 ? SCROLL_SPEED : -SCROLL_SPEED;
      clampScroll();
      positionListInner();
    });

    let listAreaY = 0;
    let listAreaHeight = 0;
    let totalListHeight = 0;

    const clampScroll = () => {
      const maxScroll = Math.max(0, totalListHeight - listAreaHeight);
      scrollY = Math.max(0, Math.min(scrollY, maxScroll));
    };

    const positionListInner = () => {
      listInner.y = -scrollY;
    };

    // ---------------------------------------------------------------------------
    // rebuild friend rows
    // ---------------------------------------------------------------------------

    const rebuildRows = (friends: FriendEntry[], contentW: number) => {
      // destroy old children of listInner
      while (listInner.children.length > 0) {
        listInner.removeChildAt(0).destroy({ children: true });
      }

      const maxNameChars = Math.max(
        6,
        Math.floor(
          (contentW - ROW_AVATAR_SIZE - ROW_PADDING_X * 3 - REMOVE_BTN_SIZE) /
            (ROW_NAME_SIZE * 0.55)
        )
      );
      const maxSubChars = Math.max(
        6,
        Math.floor(
          (contentW - ROW_AVATAR_SIZE - ROW_PADDING_X * 3 - REMOVE_BTN_SIZE) / (ROW_SUB_SIZE * 0.55)
        )
      );

      for (let i = 0; i < friends.length; i++) {
        const friend = friends[i];
        const rowY = i * ROW_HEIGHT;

        const rowContainer = new Container();
        rowContainer.eventMode = "static";
        rowContainer.y = rowY;
        listInner.addChild(rowContainer);

        // alternating row background
        const rowBg = new Graphics();
        rowBg.eventMode = "none";
        if (i % 2 === 1) {
          rowBg.rect(0, 0, contentW, ROW_HEIGHT);
          rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
        }
        rowContainer.addChild(rowBg);

        // avatar circle with initial letter
        const avatarColor = colorForName(friend.name, i);
        const avatarX = ROW_PADDING_X + ROW_AVATAR_SIZE / 2;
        const avatarY = ROW_HEIGHT / 2;

        const avatar = new Graphics();
        avatar.eventMode = "none";
        avatar.circle(avatarX, avatarY, ROW_AVATAR_SIZE / 2);
        avatar.fill({ color: avatarColor });
        rowContainer.addChild(avatar);

        const initial = friend.name.trim().charAt(0).toUpperCase() || "?";
        const avatarLetter = new Text({
          text: initial,
          style: {
            fontFamily: FONT,
            fontSize: 9,
            fontWeight: "bold",
            fill: 0xffffff,
            align: "center",
          },
          resolution: RESOLUTION,
        });
        avatarLetter.eventMode = "none";
        avatarLetter.anchor.set(0.5);
        avatarLetter.x = avatarX;
        avatarLetter.y = avatarY;
        rowContainer.addChild(avatarLetter);

        // name text
        const textX = ROW_PADDING_X + ROW_AVATAR_SIZE + ROW_PADDING_X;
        const nameText = new Text({
          text: truncate(friend.name || "unnamed", maxNameChars),
          style: {
            fontFamily: FONT,
            fontSize: ROW_NAME_SIZE,
            fontWeight: "bold",
            fill: TEXT_COLOR,
          },
          resolution: RESOLUTION,
        });
        nameText.eventMode = "none";
        nameText.x = textX;
        nameText.y = 6;
        rowContainer.addChild(nameText);

        // subtitle: description or nodeId
        const subtitle = friend.description || friend.nodeId || "";
        if (subtitle) {
          const subText = new Text({
            text: truncate(subtitle, maxSubChars),
            style: {
              fontFamily: FONT,
              fontSize: ROW_SUB_SIZE,
              fill: MUTED_TEXT,
            },
            resolution: RESOLUTION,
          });
          subText.eventMode = "none";
          subText.x = textX;
          subText.y = 24;
          rowContainer.addChild(subText);
        }

        // remove button
        const removeBtn = new Container();
        removeBtn.eventMode = "static";
        removeBtn.cursor = "pointer";
        removeBtn.x = contentW - REMOVE_BTN_SIZE - ROW_PADDING_X;
        removeBtn.y = (ROW_HEIGHT - REMOVE_BTN_SIZE) / 2;

        const removeBg = new Graphics();
        removeBg.eventMode = "none";
        removeBg.roundRect(0, 0, REMOVE_BTN_SIZE, REMOVE_BTN_SIZE, 3);
        removeBg.fill({ color: BG, alpha: 0 });
        removeBtn.addChild(removeBg);

        const removeX = new Text({
          text: "\u00d7",
          style: {
            fontFamily: FONT,
            fontSize: 14,
            fill: MUTED_TEXT,
          },
          resolution: RESOLUTION,
        });
        removeX.eventMode = "none";
        removeX.x = (REMOVE_BTN_SIZE - removeX.width) / 2;
        removeX.y = (REMOVE_BTN_SIZE - 14) / 2 - 1;
        removeBtn.addChild(removeX);

        // capture friend id for the closure
        const friendId = friend.id;
        removeBtn.on("pointertap", (e) => {
          e.stopPropagation();
          activeStopEditing?.();
          ctx.doc.change((draft) => {
            const idx = draft.friends.findIndex((f: FriendEntry) => f.id === friendId);
            if (idx !== -1) {
              draft.friends.splice(idx, 1);
            }
          });
        });

        // hover effect on remove button
        removeBtn.on("pointerover", () => {
          removeX.style.fill = 0xef4444;
        });
        removeBtn.on("pointerout", () => {
          removeX.style.fill = MUTED_TEXT;
        });

        rowContainer.addChild(removeBtn);
      }

      totalListHeight = friends.length * ROW_HEIGHT;
    };

    // ---------------------------------------------------------------------------
    // add-mode text fields (reuses same createTextField pattern as wizard)
    // ---------------------------------------------------------------------------

    const addModeContainer = new Container();
    addModeContainer.eventMode = "static";
    addModeContainer.visible = false;
    container.addChild(addModeContainer);

    // we need a local bg for add mode section
    const addModeBg = new Graphics();
    addModeBg.eventMode = "none";
    addModeContainer.addChild(addModeBg);

    interface FieldGroup {
      label: Text;
      fieldBg: Graphics;
      fieldText: Text;
      fieldMask: Graphics;
      startEditing: () => void;
      stopEditing: () => void;
      layoutAt: (x: number, y: number, w: number) => void;
      isEditing: () => boolean;
      getValue: () => string;
      reset: () => void;
    }

    let addNameValue = "";
    let addNodeIdValue = "";

    function createAddField(
      labelStr: string,
      parentContainer: Container,
      fieldIndex: number,
      getValueFn: () => string,
      setValueFn: (v: string) => void
    ): FieldGroup {
      let editing = false;

      const label = new Text({
        text: labelStr,
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      label.eventMode = "none";
      parentContainer.addChild(label);

      const fieldBg = new Graphics();
      fieldBg.eventMode = "static";
      fieldBg.cursor = "text";
      parentContainer.addChild(fieldBg);

      const fieldMask = new Graphics();
      parentContainer.addChild(fieldMask);

      const fieldText = new Text({
        text: "",
        style: { fontFamily: FONT, fontSize: TEXT_SIZE, fill: TEXT_COLOR },
        resolution: RESOLUTION,
      });
      fieldText.eventMode = "none";
      fieldText.mask = fieldMask;
      parentContainer.addChild(fieldText);

      let fieldX = 0;
      let fieldY = 0;
      let fieldW = 100;

      const drawFieldBg = () => {
        const borderColor = editing ? FIELD_BORDER_ACTIVE : FIELD_BORDER;
        fieldBg.clear();
        fieldBg.roundRect(fieldX, fieldY, fieldW, FIELD_HEIGHT, FIELD_RADIUS);
        fieldBg.fill({ color: FIELD_BG });
        fieldBg.stroke({ color: borderColor, width: 1 });
      };

      const drawFieldMask = () => {
        fieldMask.clear();
        fieldMask.rect(fieldX + 6, fieldY, fieldW - 12, FIELD_HEIGHT);
        fieldMask.fill({ color: 0xffffff });
      };

      const stopEditing = () => {
        if (!editing) return;
        editing = false;
        if (activeStopEditing === stopEditing) {
          activeStopEditing = null;
        }
        ctx.keyboard.release();
        drawFieldBg();
      };

      const startEditing = () => {
        if (editing) return;
        activeStopEditing?.();

        editing = true;
        activeStopEditing = stopEditing;
        drawFieldBg();

        const handler: KeyboardHandler = {
          onInput(value: string) {
            fieldText.text = value;
            setValueFn(value);
          },
          onKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
              event.preventDefault();
              stopEditing();
            } else if (event.key === "Tab") {
              event.preventDefault();
              stopEditing();
              const nextIndex =
                (fieldIndex + (event.shiftKey ? -1 : 1) + fieldStarters.length) %
                fieldStarters.length;
              fieldStarters[nextIndex]();
            } else if (event.key === "Enter") {
              event.preventDefault();
              stopEditing();
            }
          },
          onBlur() {
            stopEditing();
          },
        };

        ctx.keyboard.acquire(handler, getValueFn());
      };

      fieldBg.on("pointertap", (e) => {
        e.stopPropagation();
        startEditing();
      });

      const layoutAt = (x: number, y: number, w: number) => {
        label.x = x;
        label.y = y;
        fieldX = x;
        fieldY = y + LABEL_SIZE + 4;
        fieldW = w;
        drawFieldBg();
        drawFieldMask();
        fieldText.x = fieldX + 8;
        fieldText.y = fieldY + (FIELD_HEIGHT - TEXT_SIZE) / 2;
      };

      return {
        label,
        fieldBg,
        fieldText,
        fieldMask,
        startEditing,
        stopEditing,
        layoutAt,
        isEditing: () => editing,
        getValue: getValueFn,
        reset: () => {
          setValueFn("");
          fieldText.text = "";
        },
      };
    }

    const nameField = createAddField(
      "name",
      addModeContainer,
      0,
      () => addNameValue,
      (v) => {
        addNameValue = v;
      }
    );

    const nodeIdField = createAddField(
      "node id",
      addModeContainer,
      1,
      () => addNodeIdValue,
      (v) => {
        addNodeIdValue = v;
      }
    );

    fieldStarters.push(nameField.startEditing, nodeIdField.startEditing);

    // add-mode buttons: cancel and add
    const addCancelBtn = new Container();
    addCancelBtn.eventMode = "static";
    addCancelBtn.cursor = "pointer";

    const addCancelBg = new Graphics();
    addCancelBtn.addChild(addCancelBg);

    const addCancelText = new Text({
      text: "cancel",
      style: { fontFamily: FONT, fontSize: TEXT_SIZE, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    addCancelText.eventMode = "none";
    addCancelBtn.addChild(addCancelText);
    addModeContainer.addChild(addCancelBtn);

    addCancelBtn.on("pointertap", (e) => {
      e.stopPropagation();
      activeStopEditing?.();
      addMode = false;
      addModeContainer.visible = false;
      nameField.reset();
      nodeIdField.reset();
      layout(currentWidth, currentHeight);
    });

    const addConfirmBtn = new Container();
    addConfirmBtn.eventMode = "static";
    addConfirmBtn.cursor = "pointer";

    const addConfirmBg = new Graphics();
    addConfirmBtn.addChild(addConfirmBg);

    const addConfirmText = new Text({
      text: "add",
      style: { fontFamily: FONT, fontSize: TEXT_SIZE, fontWeight: "bold", fill: 0xffffff },
      resolution: RESOLUTION,
    });
    addConfirmText.eventMode = "none";
    addConfirmBtn.addChild(addConfirmText);
    addModeContainer.addChild(addConfirmBtn);

    addConfirmBtn.on("pointertap", (e) => {
      e.stopPropagation();
      activeStopEditing?.();

      const name = addNameValue.trim();
      const nodeId = addNodeIdValue.trim();

      if (!name && !nodeId) {
        // nothing to add — just close
        addMode = false;
        addModeContainer.visible = false;
        nameField.reset();
        nodeIdField.reset();
        layout(currentWidth, currentHeight);
        return;
      }

      ctx.doc.change((draft) => {
        draft.friends.push({
          id: crypto.randomUUID(),
          name: name,
          description: "",
          nodeId: nodeId,
          createdAt: new Date().toISOString(),
        });
      });

      addMode = false;
      addModeContainer.visible = false;
      nameField.reset();
      nodeIdField.reset();

      // scroll to bottom to show the new friend
      // (will be clamped in next layout)
      scrollY = Infinity;
    });

    // ---------------------------------------------------------------------------
    // "add friend" button (shown in list view)
    // ---------------------------------------------------------------------------

    const addBtn = new Container();
    addBtn.eventMode = "static";
    addBtn.cursor = "pointer";

    const addBtnBg = new Graphics();
    addBtn.addChild(addBtnBg);

    const addBtnText = new Text({
      text: "add friend",
      style: { fontFamily: FONT, fontSize: TEXT_SIZE, fontWeight: "bold", fill: 0xffffff },
      resolution: RESOLUTION,
    });
    addBtnText.eventMode = "none";
    addBtn.addChild(addBtnText);
    container.addChild(addBtn);

    addBtn.on("pointertap", (e) => {
      e.stopPropagation();
      activeStopEditing?.();
      addMode = true;
      addModeContainer.visible = true;
      addBtn.visible = false;
      layout(currentWidth, currentHeight);
      // auto-focus the name field
      nameField.startEditing();
    });

    // ---------------------------------------------------------------------------
    // layout
    // ---------------------------------------------------------------------------

    const layout = (w: number, h: number) => {
      const state = ctx.doc.current;
      const friends = state.friends;
      const contentW = w - PADDING_X * 2;
      let y = PADDING_Y;

      // card background
      drawCard(w, h);

      // header
      headerText.x = PADDING_X;
      headerText.y = y;

      // count badge — positioned to the right of header text
      const badgeGap = 8;
      badgeBg.x = PADDING_X + headerText.width + badgeGap;
      badgeBg.y = y + (HEADER_SIZE - BADGE_HEIGHT) / 2;
      drawBadge(friends.length);

      y += HEADER_SIZE + 8;

      // header separator
      headerSep.clear();
      headerSep.moveTo(PADDING_X, y);
      headerSep.lineTo(w - PADDING_X, y);
      headerSep.stroke({ color: BORDER, width: 1, alpha: 0.6 });
      y += 10;

      if (addMode) {
        // hide the list section and add button, show add mode container
        addBtn.visible = false;
        listContainer.visible = false;
        emptyText.visible = false;
        addModeContainer.visible = true;

        // lay out the add mode fields and buttons in the remaining space
        let addY = 0;

        // background for add mode section
        addModeContainer.x = 0;
        addModeContainer.y = y;

        addModeBg.clear();
        addModeBg.rect(PADDING_X, 0, contentW, h - y - PADDING_Y);
        addModeBg.fill({ color: BG, alpha: 0 });

        // name field
        nameField.layoutAt(PADDING_X, addY, contentW);
        if (!nameField.isEditing()) nameField.fieldText.text = addNameValue;
        addY += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

        // node id field
        nodeIdField.layoutAt(PADDING_X, addY, contentW);
        if (!nodeIdField.isEditing()) nodeIdField.fieldText.text = addNodeIdValue;
        addY += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

        // buttons — anchored to the bottom of the card
        const buttonY = h - y - PADDING_Y - BUTTON_HEIGHT;
        const buttonW = (contentW - BUTTON_GAP) / 2;

        // cancel button
        addCancelBg.clear();
        addCancelBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
        addCancelBg.fill({ color: FIELD_BG });
        addCancelBg.stroke({ color: FIELD_BORDER, width: 1 });
        addCancelBtn.x = PADDING_X;
        addCancelBtn.y = buttonY;
        addCancelText.x = (buttonW - addCancelText.width) / 2;
        addCancelText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

        // add button
        addConfirmBg.clear();
        addConfirmBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
        addConfirmBg.fill({ color: ACCENT });
        addConfirmBtn.x = PADDING_X + buttonW + BUTTON_GAP;
        addConfirmBtn.y = buttonY;
        addConfirmText.x = (buttonW - addConfirmText.width) / 2;
        addConfirmText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;
      } else {
        // list mode
        addModeContainer.visible = false;
        listContainer.visible = true;

        // "add friend" button at the bottom
        addBtn.visible = true;
        const addBtnY = h - PADDING_Y - BUTTON_HEIGHT;

        addBtnBg.clear();
        addBtnBg.roundRect(0, 0, contentW, BUTTON_HEIGHT, BUTTON_RADIUS);
        addBtnBg.fill({ color: ACCENT });
        addBtn.x = PADDING_X;
        addBtn.y = addBtnY;
        addBtnText.x = (contentW - addBtnText.width) / 2;
        addBtnText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

        // list area
        listAreaY = y;
        listAreaHeight = addBtnY - y - 8;

        // update mask
        listMask.clear();
        listMask.rect(PADDING_X, listAreaY, contentW, listAreaHeight);
        listMask.fill({ color: 0xffffff });

        // position list container
        listContainer.x = PADDING_X;
        listContainer.y = listAreaY;

        // rebuild rows
        rebuildRows(friends, contentW);

        // clamp scroll after rebuilding
        clampScroll();
        positionListInner();

        // empty state
        if (friends.length === 0) {
          emptyText.visible = true;
          emptyText.x = PADDING_X + (contentW - emptyText.width) / 2;
          emptyText.y = listAreaY + listAreaHeight / 2 - 6;
        } else {
          emptyText.visible = false;
        }
      }
    };

    // initial draw
    layout(currentWidth, currentHeight);

    // subscribe to remote doc changes (automerge sync)
    const unsub = ctx.doc.on("change", () => {
      layout(currentWidth, currentHeight);
    });

    // ---------------------------------------------------------------------------
    // controller
    // ---------------------------------------------------------------------------

    return {
      container,

      destroy() {
        activeStopEditing?.();
        unsub();
        container.destroy({ children: true });
      },

      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        layout(width, height);
      },
    };
  },
};
