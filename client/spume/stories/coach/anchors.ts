// scroll-coach demo — anchor IDs
//
// central registry of data-coach-anchor values used across the demo. keep
// this file in sync with script.ts and the data-coach-anchor attrs in the
// SuperStory / CoachStory tree.

export const COACH_ANCHORS = {
  stage: "stage",
  addMusicButton: "add-music-button",
  addRemoteButton: "add-remote-button",
  remotesList: "remotes-list",
  songsList: "songs-list",
  albumsGrid: "albums-grid",
  artistsList: "artists-list",
  playlistsList: "playlists-list",
  favoritesGrid: "favorites-grid",
  feedList: "feed-list",
  radioStations: "radio-stations",
  queueSidebar: "queue-sidebar",
  topnavSearch: "topnav-search",
  libraryGraph: "library-graph",
} as const;

export type CoachAnchor = (typeof COACH_ANCHORS)[keyof typeof COACH_ANCHORS];
