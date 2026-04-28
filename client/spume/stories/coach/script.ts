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
}

export const coachSteps: CoachStep[] = [
  {
    id: "welcome",
    title: "take the tour",
    body: "this is a live preview of freqhole — a local-first music library for your own collection plus the ones your friends share. nothing here is real (no music actually plays), but every screen + interaction is the real app. scroll down (or use the arrows) to walk through the features one slide at a time.",
    anchor: "stage",
    apply: (ctx) => {
      ctx.setLibraryMode("empty");
      ctx.setRoute("songs");
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setQueueOpen(false);
      ctx.seedNowPlaying(false);
    },
  },
  {
    id: "add-music",
    title: "point at a folder",
    body: "freqhole scans + indexes your audio files in place. nothing leaves your machine. watch the progress bar fill—then scroll on to see what landed in your library.",
    anchor: "add-music-button",
    apply: async (ctx) => {
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setLibraryMode("empty");
      ctx.setRoute("songs");
      // keep the empty/scanning view up after the bar fills — the next slide
      // ("songs") is what flips the library to populated.
      await ctx.runFakeScan({ durationMs: 1800, flipToPopulated: false });
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
    },
  },
  {
    id: "queue",
    title: "queue + history",
    body: "what's next, and what just played. drag rows to reorder, click to jump. lives in a slide-out sidebar so it stays out of the way.",
    anchor: "queue-sidebar",
    apply: (ctx) => {
      ctx.closeSearch();
      ctx.setRoute("songs");
      ctx.seedNowPlaying(true);
      ctx.setQueueOpen(true);
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
    },
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
    },
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
    },
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
      ctx.openSearch("pink");
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
    },
  },
  {
    id: "add-remote",
    title: "connect a friend",
    body: "paste a share code or url to mount someone else's library as a remote — here we're connecting to carp's basement.",
    anchor: "add-remote-button",
    apply: (ctx) => {
      ctx.setLibraryMode("populated");
      ctx.setRoute("songs");
      ctx.closeSearch();
      ctx.openModal("add-remote");
    },
  },
  {
    id: "browse-remote",
    title: "browse the remote",
    body: "once connected, their music shows up alongside yours in your normal views. dub, free jazz, library music — carp's eclectic.",
    anchor: "albums-grid",
    apply: (ctx) => {
      ctx.closeAllModals();
      ctx.closeSearch();
      ctx.setRoute("albums");
    },
  },
];

export const coachStepCount = coachSteps.length;
