// scroll-coach demo — anchor IDs
//
// central registry of data-coach-anchor values used across the demo. keep
// this file in sync with script.ts and the data-coach-anchor attrs in the
// SuperStory / CoachStory tree.

export const COACH_ANCHORS = {
  stage: "stage",
  addMusicButton: "addMusicButton",
  addRemoteButton: "addRemoteButton",
  remotesList: "remotesList",
  songsList: "songsList",
  albumsGrid: "albumsGrid",
  artistsList: "artistsView",
  playlistsList: "playlistsView",
  favoritesGrid: "favoritesGrid",
  feedList: "feedList",
  radioStations: "radioStations",
  queueSidebar: "queueSidebar",
  topnavSearch: "topnavSearch",
  libraryGraph: "libraryGraph",
  albumDetail: "albumDetail",
  albumEditModal: "albumEditModal",
  shareModal: "shareModal",
  sharesList: "sharesList",
  remoteSourceList: "remoteSourceList",
} as const;

export type CoachAnchor = (typeof COACH_ANCHORS)[keyof typeof COACH_ANCHORS];
