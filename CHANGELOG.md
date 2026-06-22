# freqhole-release

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
