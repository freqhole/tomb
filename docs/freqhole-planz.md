oh hello again. so you recently helped me build this excellent zune metro ui inspired audio player! see here: client/js/src/web-components/zune-demo.tsx it's an excellent demo! but it's turning into a very long tsx file! so now i'd like to decompose it into more modular components.

here's a bunch of details about what i'd like help building:

i've started a new root here: client/js/src/views/freqhole/index.tsx, and made a copy if zune-demo.tsx here client/js/src/views/freqhole/zoony.tsx. what i'd like to do is start extracting small bits and pieces from zoony.tsx into other .tsx and .ts files in client/js/src/views/freqhole/ but also there will be stuff that goes into client/js/src/lib (like the api fetch() calls) as well as client/js/src/components/ (i think). i'd like your help in first writing up and reviewing a plan to work through this big file methodically, while also keeping a few other things in mind. those things are:

i'd like to start using tailwind css for as much styling as possible; i want to avoid .css files and also avoid inline `style={{}}` as much as possible and use tailwind classes instead.

one short-coming of the zune-demo was not handling infinite scrolling. by way of another demo there's client/js/src/components/infinite-data-grid which, i hope, maybe could also be used here? i'd like you to take a look and add a rough level-of-effort estimate for re-using the infinite-data-grid.

i'd like to first start with a good skeleton for the main component layouts and tailwind setup. so this means ignoring the zune-demo.tsx + zoony.tsx files until we get a solid layout structure working. this means having a good 3-col (sometimes 4) layout with a header nav, infinite scrolling containers, and a footer that will contain the player controls. the player will come in and out of view so having the main 3/4-col containers handle would be nice (like their padding should either account for the footer player being shown or not so the player doesn't cutoff their content). each of the three cols should be able to scroll independently. there will also need to be popover ui with `x` to close button and click-away listeners as well as a menu component that will be anchored to buttons and right click context menus.

i'd also like to get a vite.config.ts set that will enable the handy hot-reloading stuff; everything up to this point has been lib code and demo example web-components that each have their own entry point, i want to keep this, see client/js/vite.wc.config.ts. so i think i need to add a root index.tsx and an index.html file; also some new scripts in package.json; is there anything else?

so yeah, i think the major phases would be like:

1. get a more traditional vite build setup going to render a single root component `<Freqhole/>` with all the hot reloading magic.
2. get tailwind packages and config setup. add some simple tailwind classes to freqhole.tsx to demo it working
3. start working on the core structure, so header, footer, and three center cols using tailwind styles. start defining a good set of base dark theme colors and styles. i'd like the primary color pallette to be `black`, `white`, and `magenta` (tho it would be `fuchsia` in tailwind). the third column will usually contain a table, so it should take up the most (and remaining) screen width; the first two columns should take, roughly half the screen. perhaps
4. adapt the infinite scroll setup for 3 different main view types (all with sticky position headers): a simple list with row click handlers (displaying for example, artist names), a grid view of square tiles that might have image or placeholder image backgrounds with foreground text (but the text has background to ensure high contrast). and then a table view that has smart column sizing and a bunch of other features like selection, drag and drop re-ordering, row selection but also individual buttons (and a `...` menu), right click context, etc.
