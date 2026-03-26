🧠 What you got right (this is the key insight)

This part of your analysis is basically correct:

createComputed tracks everything inside options → any reactive read retriggers → adapter calls measure() → cache wiped

And this is the killer:

getItemKey: (index) => props.messages[index]?.message_id

👉 That reads props.messages reactively

So now:

message mutation (reactions) ❌
append message ❌
anything touching messages ❌

→ invalidates the entire virtualizer

💥 Why this is fundamentally broken (for your use case)

The adapter assumes:

“If options changed → measurements are invalid → wipe cache”

But your case is:

same items
same layout structure
only content inside rows changed

👉 cache should be partially updated, not nuked

🔥 Root problem in one line

You made options reactive to data, not just configuration

✅ Fix #1 (most important): make getItemKey non-reactive

This is the biggest win.

❌ Current (bad)
getItemKey: index => props.messages[index]?.message_id

👉 tracks props.messages

✅ Fix: decouple keys from reactive reads

Create a stable key array:

const messageKeys = createMemo(() =>
props.messages.map(m => m.message_id)
)

Then:

getItemKey: index => messageKeys()[index]
⚠️ BUT — still reactive!

createMemo is still tracked by createComputed.

So we go one step further 👇

✅ Fix #2: use untrack inside options

This is the real fix.

import { untrack } from "solid-js"

getItemKey: index =>
untrack(() => props.messages[index]?.message_id)

👉 prevents dependency tracking
👉 stops createComputed from re-running

💡 Why this works
getItemKey still reads latest data
BUT does not subscribe to it

👉 adapter no longer thinks “options changed”

✅ Fix #3: isolate the virtualizer from reactive churn

Make sure your virtualizer is created like this:

const virtualizer = createVirtualizer({
count: () => props.messages.length, // only this should be reactive
estimateSize: () => 60,
getScrollElement: () => parentRef,
getItemKey: index =>
untrack(() => props.messages[index]?.message_id),
})

👉 Only count should change reactively

⚠️ Important nuance

Even count can trigger a reset — but:

append → usually OK
full replacement → reset expected
🧪 Fix #4: avoid measure() nukes

You correctly identified:

measure() = full cache wipe

So instead:

When reactions change:
virtualizer.measureElement(rowEl)

NOT:

virtualizer.measure()
⚠️ The h=0 issue (you nailed this too)

ref fires before layout → height = 0

Fix:

Delay measurement to next frame:

ref={el => {
if (!el) return
requestAnimationFrame(() => {
virtualizer.measureElement(el)
})
}}
Or better: let ResizeObserver win

TanStack already uses it.

So you can:

ref={el => el && virtualizer.measureElement(el)}

…but avoid manual early measurement elsewhere.

🚧 Fix #5 (advanced, but robust): freeze options object

Another strategy:

const virtualizer = createVirtualizer(
untrack(() => ({
count: props.messages.length,
estimateSize: () => 60,
getScrollElement: () => parentRef,
getItemKey: index => props.messages[index]?.message_id,
}))
)

👉 prevents any reactive tracking inside options

🧠 Big takeaway (this is the real lesson)

In Solid:

Anything passed into a reactive root must not accidentally depend on changing data

TanStack’s adapter violates this a bit by:

createComputed(() => resolveOptions(options))

So your job is to:

👉 make options depend only on:

structure (count, scroll element)
NOT content
🧩 If you want the “cleanest” architecture

For chat apps:

Separate:
structure layer
count
ordering
IDs
content layer
reactions
text
UI state

Only structure should affect virtualizer.

🏁 TL;DR

You were right. The issue is:

createComputed + reactive options → unintended cache invalidation

Fix stack:
✅ Wrap getItemKey in untrack
✅ Ensure options doesn’t depend on reactive message content
✅ Only let count be reactive
✅ Use measureElement, not measure
✅ Avoid measuring before layout (fix h=0)

If you want, I can show a fully “correct” chat virtualizer setup in Solid that avoids all of these pitfalls — including bottom anchoring and zero flicker.
