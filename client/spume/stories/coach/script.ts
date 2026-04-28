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
    title: "point at a folder",
    body: "freqhole scans + indexes your audio files in place. nothing leaves your machine.",
    anchor: "add-music-button",
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
    anchor: "songs-list",
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
    body: "what's next, and what just played. drag to reorder, click to jump. lives in a slide-out sidebar so it stays out of the way.",
    anchor: "queue-sidebar",
    apply: (ctx) => {
      ctx.closeSearch();
      ctx.setRoute("songs");
      ctx.seedNowPlaying(true);
      ctx.setQueueOpen(true);
      ctx.setSpotlight?.(null);
      ctx.setQueueTab?.("queue");
    },
    // first half: queue tab. second half: switch to history tab.
    onProgress: (ctx, p) => {
      ctx.setQueueTab?.(p < 0.5 ? "queue" : "history");
    },
  },
  {
    id: "albums",
    title: "albums",
    body: "covers + badges. click to drill into an album and see its tracklist.",
    anchor: "albums-grid",
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
    body: "two-column with alphabet jump nav.",
    anchor: "artists-list",
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
    body: "drag rows to reorder. all local — playlists stay on your machine.",
    anchor: "playlists-list",
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
    anchor: "favorites-grid",
    apply: (ctx) => {
      ctx.setRoute("favorites");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setListProgress?.("favoritesGrid", 0);
    },
    onProgress: (ctx, p) => ctx.setListProgress?.("favoritesGrid", p),
  },
  {
    id: "feed",
    title: "feed",
    body: "see what's happening on remotes you follow — plays, favorites, new shares.",
    anchor: "feed-list",
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
    body: "tune in to other people's stations — carp's basement is live with dub + jazz right now.",
    anchor: "radio-stations",
    apply: (ctx) => {
      ctx.setRoute("radio");
      ctx.setQueueOpen(false);
      ctx.closeSearch();
      ctx.setSpotlight?.(null);
    },
  },
  {
    id: "search",
    title: "search anything",
    body: "cmd+k or just type. matches across artists, albums, songs — both local + remote. results show inline as you type.",
    anchor: "topnav-search",
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
    body: "click any search result (or any album in the grid) to drill in. you get the cover, full tracklist, share + edit buttons, and any badges.",
    anchor: "album-detail",
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
    title: "edit + musicbrainz",
    body: "edit metadata by hand, or pull canonical info (cover art, year, track titles, credits) from the musicbrainz database in one click. great for cleaning up rips.",
    anchor: "album-edit-modal",
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
    body: "generate a share link from any album, playlist, or station. copy + send — your friend pastes it into their freqhole and the music shows up alongside theirs.",
    anchor: "share-modal",
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
    body: "when someone shares with you, freqhole asks before mounting it. accept once and it's permanent — every share you've ever received lives here, ready to re-mount.",
    anchor: "shares-list",
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
    body: "paste a node id or share url to mount a friend's library. here we're knocking on carp.basement.",
    anchor: "add-remote-button",
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
    anchor: "add-remote-button",
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
      const name = "dj edward";
      const msg = "hey carp, mind if i borrow your dub crates?";
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
    body: "your knock is sent. once carp approves, hit refresh and the remote mounts.",
    anchor: "add-remote-button",
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
    body: "approved! their music shows up alongside yours in your normal views — dub, free jazz, library oddities. carp's eclectic.",
    anchor: "albums-grid",
    apply: (ctx) => {
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setRoute("albums");
      ctx.setSpotlight?.(null);
      ctx.setListProgress?.("albumsGrid", 0);
    },
    onProgress: (ctx, p) => ctx.setListProgress?.("albumsGrid", p),
  },
];

export const coachStepCount = coachSteps.length;
