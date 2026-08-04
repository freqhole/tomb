# freqhole-release

## 0.2.10

### Patch Changes

- 25d90cc: lib/reliquary: wire up in-flight blob transfer cancelz; track canvas <-> blobz;

## 0.2.9

### Patch Changes

- 8a9c8db: add `mark reviewed` shortcut button to add music modal reviews tab; yank click away close listener for album edit modal;
- e4b7a65: lib/reliquary: handle identity key gen a bit more safe way; handle grayscale webp img convert and add contain resize mode;
- dca0ee5: improve image carousel- add loading indicators and improve perf when there's a lot of imagez; also fix radio song's image carousel;
- f0e0bce: try to fix duplicate feed listening session eventz; fix minor feed time format; fix images relations for share modal "send to remote" and playlist syncz;
- b2783d5: track outgoing blob transferz

## 0.2.8

### Patch Changes

- 3e48704: lib/reliquary: don't compute bao tree every time a blob file is requested

## 0.2.7

### Patch Changes

- 5a464ae: show image carousel for radio art; try once again to fix remote image uploadz; try to tune radio stream buffer a bit more; lib/reliquary: try to handle locking and race conditionz better
- 7a4c8e3: android: add favorite song toggle to lock screen/media session controlz

## 0.2.6

### Patch Changes

- 908e753: bump some depz
- 51375c8: lib/reliquary: handle 0 byte and incomplete download blobz
- 1437830: show entity image buttonz always on touch device (no hoverz)

## 0.2.5

### Patch Changes

- 1f192b6: tidy artist + album detail view's action buttons row; add backdrop to fav play + shuffle btnz;
- a3c73b3: improve reliquary lib snatch stuff
- ac4bcb2: add more radio station filterz: favorite boolean, rating gte lte, play count lte gte, song length time gte lte, recently added days gte lte

## 0.2.4

### Patch Changes

- 1e2e578: improve playlist detail layout and tidy some bugz; try to fix playerbar height calc with radio is playing.

  **note:** sorting playlist songs is now enabled in "edit" mode on narrow/mobile devices.

- 309edb4: try to improve radio track switching and admin track skipz
- 018460e: add play + shuffle buttonz to favoritez view
- 018460e: add more loading state to buttons that add songs to queue

## 0.2.3

### Patch Changes

- d7d97df: try to avoid local tauri share linkz
- 408cae4: tomb/lib: carry more identity detail on friend + canvas invites && gossip identity updatez more often
- 4fe78d6: try to avoid stale or corrupted offline cache causing fatal load errors (like when cf deployment is deleted)
- a0514bc: try to recover orphaned images lost in reliquary migration
- 5c5b179: add the global search in to top nav to the all feeds, radio, and shared views
- 62aa9f4: try to fix qr scanner for adding new remotes

## 0.2.2

### Patch Changes

- 1ccce8d: midden lib: improve accept_bi handling

## 0.2.1

### Patch Changes

- 4beaf21: android: listen + pause audio on AudioManager.ACTION_AUDIO_BECOMING_NOISY eventz
- 8104727: extract all the identity-related stuff to haruspex lib, and all the storage-related stuff to reliquary, and wasm stuff to midden.

## 0.1.35

### Patch Changes

- 204447a: try to fix infinite loading loop in artist detail view
- 0d23498: add share button to artist detail view
- 05219fe: try to improve error + warning logging for playback issuez
- ad10adb: add multi-remote toggle button in explore view to control if one, or all (enabled) remotes' data is shown in the graph viz
- 721f0a7: try to improve image upload and add more error handling + logging
- 76945ae: notify AppLayout (and any other listener) so the remotez list in the top nav refreshez without requiring a page reload

## 0.1.34

### Patch Changes

- 7e6310d: fix some issues with search results ranking; add ... context menu button to playlist rows for touch devices and fix song row sorting; chmod +x rathole bin file
- 06698af: try to fix some playback bugz; add more error logging + try to improve existing song lookupz

## 0.1.33

### Patch Changes

- ca7e244: try to improve radio admin track skip

## 0.1.32

### Patch Changes

- 770c2c0: mostly some npm package stuff for playlistz
- d1fae39: add zip bundle download to playlistz. tidy'n some issues with graph viz.

## 0.1.31

### Patch Changes

- de9a816: add review step to add music fetch from url flow so user can review + confirm what yt-dlp will fetch first (will run if there's `precheck_command` set in freqhole-config.yaml). in addition, member (and admin but they could do this already) users can optionally review and edit music metadata for the music they upload; pending review items are persisted in a new tab in the add music modal so user can come back later to finish reviewing. also includes taxons and musicbrainz look up queries
- de9a816: route passkeys over p2p! browser users can use passkey to auth with a remote (in addition to knock access requests and invite codes). also can link out to spume.freqhole.net so charnel app users (desktop or android apps) can use browser for passkey.
- d4cf92c: you can change your username to something else (as long as it's not already taken!): see new `profile` option in the top nav's remote `...` flyout menu

## 0.1.30

### Patch Changes

- 395c438: some useful code extractionz for use over in freqhole/playlistz
- 6af5caa: try to improve sharing: include artist, album, and song (if applicable) to share link; don't show freqhole:// linkz + try to use window.location.origin before spume.freqhole.net
- 05ddb2c: try to chunk file uploadz for android build
- c9955ef: try to fix song seek for linux rodio player; and minor blob-resolver issue

## 0.1.29

### Patch Changes

- b00212c: re-work the graph viz for multi-remotes a bit + add disable remote toggle to prevent it from rendering graph viz stuff to prevent the multi-remote relations from cluttering up the graph viz.

  chores: tidy'n freqhole.net site + stub out github actions CI workflows for creating versioned releases and production build file artifacts
