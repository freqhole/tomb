// scroll-coach demo — declarative step script
//
// each step describes:
//   - id: stable string for testing / progress dots
//   - title + body: tooltip copy
//   - anchor: data-coach-anchor selector that the tooltip should point at
//             (or "stage" for full-screen / no-anchor steps)
//   - apply: callback that mutates demo state (route/modal/etc) when the
//            step becomes active
//
// copy lives here, not in the real spume code. ownership: storybook story.

import type { CoachContext } from "./coachState";

export interface CoachStep {
  id: string;
  title: string;
  body: string;
  anchor: string; // matches a data-coach-anchor="…" somewhere in the demo
  apply: (ctx: CoachContext) => void | Promise<void>;
  /**
   * scroll-driven animation hook. fires continuously as the user scrolls
   * within this slide. `p` is 0 at the start of the slide, 1 at the end.
   * use it to drive blur/spotlight focus, scroll lists, type characters,
   * cycle through items, etc.
   */
  onProgress?: (ctx: CoachContext, p: number) => void;
}

export const coachSteps: CoachStep[] = [
  {
    id: "add-music",
    title: "take a quick tour",
    body: "freqhole scans + indexes your audio files in place. GUI app for macOS, linux, & android. CLI for headless servers (like a raspberry pi).",
    anchor: "addMusicButton",
    apply: (ctx) => {
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setLibraryMode("empty");
      ctx.setRoute("songs");
      ctx.setQueueOpen(false);
      ctx.seedNowPlaying(false);
      // initial visual state: scan paused at 0; spotlight off. onProgress
      // ramps both as the user scrolls through this slide.
      ctx.setScanProgress?.(0);
      ctx.setSpotlight?.("addMusicButton", 0);
    },
    // first half: spotlight ramps up around the add-music button.
    // second half: spotlight stays, scan progress fills 0→100%.
    onProgress: (ctx, p) => {
      const blurP = Math.min(1, p / 0.5); // 0..0.5 -> 0..1
      const scanP = Math.max(0, (p - 0.4) / 0.6); // 0.4..1 -> 0..1
      ctx.setSpotlight?.("addMusicButton", blurP);
      ctx.setScanProgress?.(Math.min(1, scanP));
    },
  },
  {
    id: "songs",
    title: "songs",
    body: "every track in your library. sortable, filterable, virtualized — handles huge collections without breaking a sweat.",
    anchor: "songsList",
    apply: (ctx) => {
      ctx.setLibraryMode("populated");
      ctx.setRoute("songs");
      ctx.setQueueOpen(false);
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setSpotlight?.(null);
      ctx.setListProgress?.("songsList", 0);
    },
    onProgress: (ctx, p) => ctx.setListProgress?.("songsList", p),
  },
  {
    id: "queue",
    title: "queue + history",
    body: "what's next, and what just played. drag to reorder.",
    anchor: "queueSidebar",
    apply: (ctx) => {
      ctx.closeSearch();
      ctx.setRoute("songs");
      ctx.seedNowPlaying(true);
      ctx.setQueueOpen(true);
      ctx.setSpotlight?.(null);
      ctx.setQueueTab?.("queue");
      ctx.setListProgress?.("queueSidebar", 0);
    },
    // first half: scroll the queue tab. midway: swap to history. second
    // half: scroll the history tab. each half remaps to its own 0..1 so
    // both panels animate fully along with page scroll.
    onProgress: (ctx, p) => {
      const tab = p < 0.5 ? "queue" : "history";
      ctx.setQueueTab?.(tab);
      const localP = p < 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
      ctx.setListProgress?.("queueSidebar", localP);
    },
  },
  {
    id: "albums",
    title: "albums",
    body: "sortable grid layout.",
    anchor: "albumsGrid",
    apply: (ctx) => {
      ctx.setRoute("albums");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setListProgress?.("albumsGrid", 0);
    },
    onProgress: (ctx, p) => ctx.setListProgress?.("albumsGrid", p),
  },
  {
    id: "artists",
    title: "artists",
    body: "sortable & filterable two-column layout with alphabet quick nav.",
    anchor: "artistsView",
    apply: (ctx) => {
      ctx.setRoute("artists");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setSpotlight?.(null);
      ctx.setSelectedListItem?.("artistsView", 0);
      ctx.setListProgress?.("artistsView:detail", 0);
    },
    // walk through the first 4 artists; for each, scroll the detail panel
    // start → end. divides the scroll into N slots.
    onProgress: (ctx, p) => {
      const N = 4;
      const slot = Math.min(N - 1, Math.floor(p * N));
      const subP = p * N - slot;
      ctx.setSelectedListItem?.("artistsView", slot);
      ctx.setListProgress?.("artistsView:detail", subP);
    },
  },
  {
    id: "playlists",
    title: "playlists",
    body: "full-page background images; drag-and-drop song (re)ordering.",
    anchor: "playlistsView",
    apply: (ctx) => {
      ctx.setRoute("playlists");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setSpotlight?.(null);
      ctx.setSelectedListItem?.("playlistsView", 0);
      ctx.setListProgress?.("playlistsView:detail", 0);
    },
    onProgress: (ctx, p) => {
      const N = 4;
      const slot = Math.min(N - 1, Math.floor(p * N));
      const subP = p * N - slot;
      ctx.setSelectedListItem?.("playlistsView", slot);
      ctx.setListProgress?.("playlistsView:detail", subP);
    },
  },
  {
    id: "favorites",
    title: "favorites",
    body: "songs, albums, artists, playlists — all in one place.",
    anchor: "favoritesGrid",
    apply: (ctx) => {
      ctx.setRoute("favorites");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setListProgress?.("favoritesGrid", 0);
    },
    onProgress: (ctx, p) => ctx.setListProgress?.("favoritesGrid", p),
  },
  {
    id: "library-graph",
    title: "library graph",
    body: "your whole collection as a navigable map. drill from remotes into genres, eras, artists, and albums. the same force-directed walker powers it everywhere.",
    anchor: "libraryGraph",
    apply: (ctx) => {
      ctx.setRoute("library");
      ctx.setQueueOpen(false);
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setSpotlight?.(null);
      ctx.walkLibraryGraph?.(0);
    },
    onProgress: (ctx, p) => ctx.walkLibraryGraph?.(p),
  },
  {
    id: "feed",
    title: "feed",
    body: "see what's happening on remotes you follow — new music, what other people are listening to and adding to their favorites.",
    anchor: "feedList",
    apply: (ctx) => {
      ctx.setRoute("feed");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setListProgress?.("feedList", 0);
    },
    onProgress: (ctx, p) => ctx.setListProgress?.("feedList", p),
  },
  {
    id: "radio",
    title: "radio",
    body: "create live radio streams that anyone can listen to; or set private so only your friends can access.",
    anchor: "radioStations",
    apply: (ctx) => {
      ctx.setRoute("radio");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setSpotlight?.(null);
    },
  },
  {
    id: "search",
    title: "search anything (cmd+k)",
    body: "matches across artists, albums, songs, genres, and playlists.",
    anchor: "topnavSearch",
    apply: (ctx) => {
      ctx.closeAllModals();
      ctx.setRoute("songs");
      ctx.setQueueOpen(false);
      // open the search input but start with empty query — onProgress
      // ramps the typed text char-by-char.
      ctx.openSearch();
      ctx.setSearchQuery?.("");
    },
    onProgress: (ctx, p) => {
      const word = "pink";
      // first 30% reserved for the input expand animation; the rest types
      // one char at a time over the remaining scroll.
      const typeP = Math.max(0, (p - 0.2) / 0.6);
      const n = Math.min(word.length, Math.round(typeP * word.length));
      ctx.setSearchQuery?.(word.slice(0, n));
    },
  },
  {
    id: "album-detail",
    title: "album detail",
    body: "browse all album art images and full track list.",
    anchor: "albumDetail",
    apply: (ctx) => {
      ctx.closeSearch();
      ctx.closeAllModals();
      ctx.setRoute("album-detail");
      ctx.setQueueOpen(false);
      ctx.setSpotlight?.(null);
      ctx.setListProgress?.("albumDetail", 0);
    },
    // first half: scroll the tracklist. second half: spotlight ramps up
    // around the album-edit button to telegraph the next step.
    onProgress: (ctx, p) => {
      const scrollP = Math.min(1, p / 0.5);
      ctx.setListProgress?.("albumDetail", scrollP);
      const blurP = Math.max(0, (p - 0.5) / 0.5);
      ctx.setSpotlight?.(blurP > 0 ? "albumEditButton" : null, blurP);
    },
  },
  {
    id: "album-edit",
    title: "edit (with musicbrainz)",
    body: "edit metadata by hand, or pull canonical info (cover art, year, track titles, credits, etc.) from the musicbrainz database. great for cleaning up rips.",
    anchor: "albumEditModal",
    apply: (ctx) => {
      ctx.closeSearch();
      ctx.setRoute("album-detail");
      ctx.openModal("album-edit");
      ctx.setSpotlight?.(null);
      ctx.setInputValue?.("albumEditTitle", "");
    },
    // type a corrected title into the title field char-by-char during the
    // first 80% of the slide. last 20% pauses on the final value.
    onProgress: (ctx, p) => {
      const corrected = "the dark side of the moon (2011 remaster)";
      const typeP = Math.min(1, p / 0.8);
      const n = Math.round(typeP * corrected.length);
      ctx.setInputValue?.("albumEditTitle", corrected.slice(0, n));
    },
  },
  {
    id: "share",
    title: "share with friends",
    body: "generate a share link from any album, playlist, or station. copy + send to your friends.",
    anchor: "shareModal",
    apply: (ctx) => {
      ctx.closeSearch();
      ctx.setRoute("album-detail");
      ctx.closeModal("album-edit");
      ctx.openModal("share");
      ctx.setSpotlight?.(null);
    },
  },
  {
    id: "resolve-share",
    title: "the other side",
    body: "when someone shares things with you, it lives here.",
    anchor: "sharesList",
    apply: (ctx) => {
      ctx.closeSearch();
      ctx.closeModal("share");
      ctx.setRoute("shares");
      ctx.openModal("resolve-share");
      ctx.setSpotlight?.(null);
      ctx.setListProgress?.("sharesList", 0);
    },
    // first half scrolls through the shares list; second half closes the
    // modal so the list is unobscured (handled in apply via threshold).
    onProgress: (ctx, p) => {
      ctx.setListProgress?.("sharesList", Math.min(1, p / 0.6));
      if (p > 0.5) ctx.closeModal("resolve-share");
    },
  },
  {
    id: "add-remote",
    title: "add a remote",
    body: "paste a node id or share url to browse a friend's library. use invite codes or knock to request access.",
    anchor: "addRemoteButton",
    apply: (ctx) => {
      ctx.setLibraryMode("populated");
      ctx.setRoute("songs");
      ctx.closeSearch();
      ctx.setKnockPhase?.("id-form");
      ctx.openModal("add-remote");
      ctx.setSpotlight?.(null);
      ctx.setInputValue?.("knockNodeIdInput", "");
    },
    // type the node id char-by-char during 0..0.85, then transition to
    // the loading spinner for the last 15% of the slide.
    onProgress: (ctx, p) => {
      const url = "freqhole://carp.basement/share/abc123";
      const typeP = Math.min(1, p / 0.85);
      const n = Math.round(typeP * url.length);
      ctx.setInputValue?.("knockNodeIdInput", url.slice(0, n));
      if (p > 0.9) ctx.setKnockPhase?.("loading");
      else ctx.setKnockPhase?.("id-form");
    },
  },
  {
    id: "knock-request",
    title: "request access",
    body: "carp's basement needs approval. send a knock with your name and a quick note.",
    anchor: "addRemoteButton",
    apply: (ctx) => {
      ctx.setRoute("songs");
      ctx.closeSearch();
      ctx.openModal("add-remote");
      ctx.setKnockPhase?.("request-form");
      ctx.setSpotlight?.(null);
      ctx.setInputValue?.("knockNameInput", "");
      ctx.setInputValue?.("knockMessageInput", "");
    },
    // type name during 0..0.4, message during 0.4..0.9, last 0.1 -> pending
    onProgress: (ctx, p) => {
      const name = "dj suddenly i'm miss midwest midnight checkout queen";
      const msg = "hey carpiez, mind if i borrow your dub crates?";
      const nameP = Math.min(1, p / 0.4);
      const msgP = Math.max(0, Math.min(1, (p - 0.4) / 0.5));
      ctx.setInputValue?.("knockNameInput", name.slice(0, Math.round(nameP * name.length)));
      ctx.setInputValue?.("knockMessageInput", msg.slice(0, Math.round(msgP * msg.length)));
      if (p > 0.92) ctx.setKnockPhase?.("pending");
      else ctx.setKnockPhase?.("request-form");
    },
  },
  {
    id: "knock-pending",
    title: "waiting on carp",
    body: "your knock is sent. once carp approves, and hit refresh.",
    anchor: "addRemoteButton",
    apply: (ctx) => {
      ctx.setRoute("songs");
      ctx.closeSearch();
      ctx.openModal("add-remote");
      ctx.setKnockPhase?.("pending");
      ctx.setSpotlight?.(null);
    },
    // ramp up spotlight on the refresh button across the slide.
    onProgress: (ctx, p) => {
      ctx.setSpotlight?.(p > 0.05 ? "knockRefreshButton" : null, p);
      if (p > 0.95) ctx.setKnockPhase?.("approved");
    },
  },
  {
    id: "browse-remote",
    title: "browse the remote",
    body: "approved! you can now browse and listen to your friend's music!",
    anchor: "albumsGrid",
    apply: (ctx) => {
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setRoute("albums");
      ctx.setSpotlight?.(null);
      ctx.setListProgress?.("albumsGrid", 0);
    },
    onProgress: (ctx, p) => ctx.setListProgress?.("albumsGrid", p),
  },
  {
    id: "switch-remotes",
    title: "switch between remotes",
    body: "tap the freqhole icon to open the menu. pick local library or any approved remote.",
    anchor: "remoteSourceList",
    apply: (ctx) => {
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setRoute("songs");
      ctx.setQueueOpen(false);
      ctx.setSpotlight?.(null);
      ctx.setTopNavMenuOpen?.(true);
    },
    // ramp a soft spotlight onto the source list as the slide settles in.
    // intentionally do NOT re-assert setTopNavMenuOpen(true) here — once the
    // menu has been opened by `apply`, leave it under user control so they
    // can hover/click to close + re-open it manually on this slide.
    onProgress: (ctx, p) => {
      ctx.setSpotlight?.("remoteSourceList", Math.min(1, p / 0.3));
    },
  },
];

export const coachStepCount = coachSteps.length;
