# friends tab — drag-and-drop groups + bio display

> plan for adding drag-and-drop group management and bio preview to the friends list in `friends-tab.ts`.

## current state

`tomb/client/skein/widgets/narthex/social/friends-tab.ts` (~1558 lines) has three sub-views: list, detail, and add-friend. the list view already supports groups:

- friends are grouped by `friend.group` field (string, "" = ungrouped)
- group headers render with chevron expand/collapse (state in module-level `collapsedGroups` Set)
- groups are sorted alphabetically, ungrouped friends render at the bottom
- group assignment exists in the detail view via pill selector (tap to toggle)
- group creation exists in the detail view via a text input + confirm flow

what's missing: drag-and-drop for group management, bio preview in the list rows, and inline group rename.

## data model (already exists)

```
SocialState.friends[].group    — string, group name or "" for ungrouped
SocialState.groups[]           — { name: string, createdAt: string }
```

writes go through `ctx.doc.change(draft => { ... })` which handles both automerge (browser) and sqlite (tauri) via the diff engine.

## plan

### 1. show bio in list rows

**current row layout** (ROW_HEIGHT = 40px, single line):
```
[avatar] [name (alias)]                    [›]
```

**new row layout** (increase ROW_HEIGHT to ~52px, two lines):
```
[avatar] [name (alias)]                    [›]
         [bio truncated to ~1 line...]
```

changes:
- increase `ROW_HEIGHT` constant (or use a new `ROW_HEIGHT_WITH_BIO`)
- in `rebuildRows`, after the name text, add a bio line:
  - text: `truncate(bestBio, maxBioChars)` where `bestBio` comes from the friend's node profiles or falls back to ""
  - style: `{ fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT }` (already defined constants)
  - position: below name text, same x offset
- vertically center the name+bio pair within the row instead of just the name
- skip bio line if empty (row stays compact)

bio resolution: `friend.nodeIds[0]?.bio` or pick from the most recently seen node. the `resolveFriendDisplay()` helper from `sqlite-social-doc.ts` does this already but it's a function, not a pixi thing — just replicate the "pick best node" logic inline or import it.

### 2. drag-and-drop infrastructure

pixi.js doesn't have built-in drag-and-drop. implement it with pointer events on each friend row:

**drag detection:**
- `pointerdown` on a friend row: record start position + friend ID, start a 150ms hold timer
- `pointermove` (on stage or container): if held past threshold (~5px), enter drag mode
- `pointerup` / `pointerupoutside`: end drag, evaluate drop target

**drag visual:**
- create a "drag ghost" — a semi-transparent clone of the row, parented to the container (not listInner) so it floats above the scroll mask
- ghost follows pointer position
- original row dims (alpha 0.3) during drag

**drop zones:**
- rendered as a fixed bar at the TOP of the list area (outside the scroll mask so always visible)
- only visible while dragging
- layout: two side-by-side zones, each 50% width:
  - left: **"+ new group"** — always shown during drag
  - right: **"remove from group"** — only shown if the dragged friend is currently in a group
- visual: colored rectangles with text labels, highlight on hover (pointer enters bounds)
- additionally, existing group header rows act as drop targets — highlight when ghost overlaps

**drop behavior:**

| drop target | action |
|---|---|
| "+ new group" zone | create group with auto-name (e.g. "group 1", "group 2"), assign friend to it |
| "remove from group" zone | set `friend.group = ""` |
| existing group header | set `friend.group = headerGroupName` |
| nowhere (release in list area) | cancel, no change |

all mutations go through `ctx.doc.change()`:
```ts
ctx.doc.change(draft => {
  const f = draft.friends.find(f => f.id === draggedFriendId);
  if (f) f.group = targetGroupName;
});
```

for new group creation:
```ts
ctx.doc.change(draft => {
  const name = generateUniqueGroupName(draft.groups);
  draft.groups.push({ name, createdAt: new Date().toISOString() });
  const f = draft.friends.find(f => f.id === draggedFriendId);
  if (f) f.group = name;
});
```

### 3. group header — expand/collapse (already works)

no changes needed. `collapsedGroups` Set + chevron toggle already implemented.

### 4. group header — inline rename on double-click

**trigger:** `dblclick` (or `pointertap` with double-tap detection) on group header text.

**flow:**
1. replace group name text with a `SkeinInput` (already used for alias editing in detail view)
2. input pre-filled with current group name, auto-focused, text selected
3. **enter key** → confirm rename:
   ```ts
   ctx.doc.change(draft => {
     // rename in groups array
     const g = draft.groups.find(g => g.name === oldName);
     if (g) g.name = newName;
     // update all friends in this group
     for (const f of draft.friends) {
       if (f.group === oldName) f.group = newName;
     }
   });
   ```
4. **escape key** → cancel, restore original text
5. **blur** (click elsewhere) → cancel

state: add `editingGroupName: string | null` alongside existing `editingAlias` / `editingNewGroup` state vars.

### 5. auto-generated group names

helper function:
```ts
function generateUniqueGroupName(groups: FriendGroup[]): string {
  const existing = new Set(groups.map(g => g.name));
  let i = 1;
  while (existing.has(`group ${i}`)) i++;
  return `group ${i}`;
}
```

after dropping onto "+ new group", immediately enter inline rename mode on the new group header so the user can type a real name.

## implementation order

1. **bio in list rows** — small, self-contained, no interaction changes
2. **drag infrastructure** — pointer events, ghost, drag state machine
3. **drop zones** — the fixed bar at top with new group / remove from group
4. **drop onto group headers** — hit testing against existing headers
5. **inline group rename** — double-click + SkeinInput on group headers
6. **polish** — animations, scroll-while-dragging (auto-scroll when ghost near top/bottom of list), haptic-style visual feedback

## key files

- `tomb/client/skein/widgets/narthex/social/friends-tab.ts` — all changes here
- `tomb/client/skein/widgets/narthex/social/constants.ts` — ROW_HEIGHT and any new constants
- `tomb/client/skein/widgets/narthex/social/helpers.ts` — `friendDisplayName()`, `truncate()`
- `tomb/client/skein/widgets/narthex/social/schema.ts` — `FriendEntry`, `FriendGroup` types
- `tomb/client/skein/widgets/narthex/social/types.ts` — `SocialDoc` interface (no changes)
- `tomb/client/skein/src/p2p/sqlite-social-doc.ts` — `resolveFriendDisplay()` for bio resolution reference

## notes

- pixi.js drag needs `eventMode = "static"` on interactive elements (already set on rows)
- the scroll mask clips listInner — drag ghost must be added to `container` not `listInner` to float above the mask
- `rebuildRows` destroys and recreates all children on every call — drag state must survive rebuilds or prevent rebuilds during drag
- the drop zone bar should use a distinct visual treatment (e.g. dashed border, icon) so it's clearly a target and not a list item
- consider adding a subtle spring/bounce animation when a friend row snaps into a new group position after drop
