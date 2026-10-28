# freqhole-release

## 0.3.22

### Patch Changes

- 39fa432: fix buggy taxon editor so that taxons can be cross-domain (shared between music + video); improve graph viz logic a bit so seasons' vidz don't always flyout;
- 01f1040: try to wire up radio station streamz thru cenotaph player
- 10e5d01: re-wire add remote flow so knock form workz
- 5d4b20d: try to further tune video streamz and re-write rendition encoder so it's easy to stream (should just be able to copy, not need heavy cpu to re-encode for the radio stream)
- 509d44d: pi setup + charnel player polish

  pi setup turns off the red power LED, can set up a GPIO fan with speed
  control (default pin 14) and unattended-upgrades, and adds
  `freqhole-setup.sh uninstall`. player pairing now stays on after updates,
  because the config template was missing [player_pairing]. the OLED menu
  stays awake during updates and shows progress with "do not power off!",
  shows "playing..."/"paused!" briefly after play/pause, yank
  "see logs". charnel hides the cursor on linux even when booted without a
  mouse, and the expanded mini video player hides its buttons and the cursor
  when the pointer is idle.

## 0.3.21

### Patch Changes

- 183a371: try harder to prevent clipping of context menuz
- 9cade8d: try to prioritize image upload jobs over other jobz;
- 70e2123: try to improve taxon editor for videoz
- 9c7b6de: video play progress + continue button for series & movie video type, row background fill to show progress
- 8b1dfd7: add marquee text to video title rows in series detail view
- cf7abb6: reorder "send to radio station" modal (requests-first); change screenshot timing (1% → 10%) + thumb regen job; season edit modal: season title autocomplete (merge seasons); season edit modal: shared taxon editing;
- a0bb275: show fly-out menu if it's possible to stream video via a radio station when playing videos (a request-type radio station must be setup first!)
- fe786b9: try to improve mobile action button sizing

## 0.3.20

### Patch Changes

- a78b50b: improve raspi setup scriptz for handling existing installz
- 139427f: try to use system's hostname for default server name in setup flow; "enable p2p federation", "allow remote admin over p2p", and "enable radio", all default on/enabled in the setup flow
- 508cb4d: try to improve slow queryz related to offline media; also fix availability filter route;

## 0.3.19

### Patch Changes

- 4fc1118: try to improve cursor hide logic for cenotaph player view
- 59c8779: removable storage disk mount + add to library helperz; watch for mounted disks, interactive ui for adding stuff from mounted disk, and handle marking media offline after disk is unmounted
- a855614: add some setup scriptz to make a one-shot command for all the thingz needed to setup a raspberry pi
- da7cf10: try to fix issue where setup wizard never opens spume window when complete
- d5c2716: bunch of issues: fix remote audio device picker overlfowing window; fix remote "listen on" comet tail animation; marquee oled currently playing song + artist; fix explore panel getting placed under playerbar; update iroh and yank swarm discovery fork since my pr merged;
- bbabe5e: be more explicit about pause state when starting experimental libmpv playback so lingering paused items don't cause playback to stall

## 0.3.18

### Patch Changes

- 5e7bea9: try to improve media session updates after track skips (regression from prior refactor of media session stuff)
- 9496b04: hello augur! mdns stuff for iroh address lookup and discovery: peers on the same lan can discover eachother without knowing node ids, and if they do know node ids, address lookup doesn't require n0-computer's dns pkarr services
- 3d27978: try to improve top nav click handler on mobile (trying to fix bug where it takes two taps to open menu)
- b753718: generate og meta tags in cloudflare worker for better share link previewz
- 44637f9: try to improve share links to avoid generating links for nodes that can't be accessed (e.g. ios, android, and web app libraries)

## 0.3.17

### Patch Changes

- 86de727: and opt-in edge swipe feature to navigate back and forward
- d0ccf66: try to fix issue where search query gets pushed to history on views that can't be filtered (e.g. the album detail view) so after clearing, going back restores that search query
- 933ede5: add more handlers that convert double-click handlers to single click handlers so it's more as you'd expect on mobile/touch devicez
- 75d3d02: fix some modal bugz; fix safe area top margin on mini video player controlz; improve admin handler response causing error toastz in send-to-radio station picker; hide "select folder" button on ios (and android) in add media modal; add settings toggle to disable background images;

## 0.3.16

### Patch Changes

- ed3ac20: no more safe-area-bottom, ugh
- 52dbb04: try to fix broken image in local library view
- c04d0ff: fix stupid waveform display logic
- 08a40b4: fix bugz related to mirror favorite on remote to local library
- 0664a80: try to fix minor padding issue in favorites view

## 0.3.15

### Patch Changes

- 8b51a3d: add new music video type and include music + karaoke videoz on artist and album detail viewz
- dbd33d8: config for yt-dlp --cookie
- 73f26e4: try to fix ios github action ci yml
- 66823bd: hello ios!
- eaa5a5f: fight the safe-area and margin for top nav and player bar
- 2b7f33c: more background imagez: series, artist, and album detail get background imagez!
- a87a546: try again to fucking fix safe area marginz

## 0.3.14

### Patch Changes

- 1b2455a: try to fix some android crash + full screen video issuez
- 879d2bd: improve polyfill modal logic
- 534caef: update iroh + iroh-blobs + fix gate acl issuez
- 22dcf3b: rathole-- remote libmpv-dev hard dependency, try to improve player tui, try to make sure only one thing playz at once

## 0.3.13

### Patch Changes

- 5f65206: go to hell sha256! start yanking all sha256 fieldz (this is probably major but whatever)
- 62274db: try to fix favorites action buttonz getting placed under in-app toolbar and not clickable
- 38ae3cb: make libmpv and optional dependancy in charnel so ancient macs (<osx14) can run; switch rathole back to just shelling out to mpv bin, no libmpv hardlink;
- b6ed3c0: wire up ui in wizard library view for running maintenance jobs; add new maintenance to move fetched music + video files into nice dir/file.ext layout and write metadata into music filez
- f2ceca1: repair library maintenance jobz to fix missing waveform and imagez and also try to fix over-used album art images (for example a directory with a lot of unrelated music); tidy text marquee out animation; add full url to completed add media modal jobs status; add new karaoke video type;
- b0b8968: mirror remote favorites to local media (if it exists); add feed events for "send to remote" media;
- 3ad20e8: prune old config file backupz, keep rolling last 10; dev pre-release version handling (so i can re-run version bump migrations over and over); tidy removable storage in settingz view;
- e9385b9: try to fix some buggy cases where experimental player libmpv backend didn't start playing audio
- a9a4f33: fix regressionz around rolling ~30min queue downloadz as well as auto download; fix some issuez with review in add media flow; try harder to make retry button in add media modal work;
- 49c23a0: try to fix musicbrainz search queries with non-alpha chars like hyphen and colon
- 0a3a902: try to fix sending to remote multiple albums from albums table view

## 0.3.12

### Patch Changes

- 2cc0e53: add one retry to libmpv plays to catch any random errors that might come up
- 74709b4: try harder to avoid adding duplicate videos to library; also try to handle adding multiple scan dirz better; if experimental player is on, should first try to play original video, not rendition;
- d8d5e55: experimental player: handle closing video window when queue is over; fix video window + icon on mac; show player controls in video window;
- f2c7c78: try to avoid blank album detail view if album id changes
- 4f9d9d3: yeet lingering blob memstore and go all in fsstore; also try to improve blob transfer sync + retry; playlistz can sync videoz now!;
- 58a1f07: try harder to sync related images when sending stuff to a remote
- 95e2082: handle updating series detail view after making video edits
- 71af010: bundle mpv and ffmpeg into macos and windows builds; experimental player now on by default for mac + windows;
- 57cf4de: try harder to prevent flickering of playerbar's art image

## 0.3.11

### Patch Changes

- 7b8b549: libmpv is the new experimental player! much better than rodio and gst stuff; supports many more audio + video formats

## 0.3.10

### Patch Changes

- 999f190: add audio device picker; rework volume control ui;
- 3a16cce: bump default_max_upload_size_mb to 5gb; if a video rendition isn't available, get the original; handle video fetch config during setup;
- 07bb258: fix some issues with send to remote transfer progress
- b6a2cd0: wire rathole unix sockets into charnel; check ~/.local/bin/ for yt-dlp;
- ba49371: make the video detail page scroll its overflow
- 82d0d23: add new transfer progress fn to app acl (does up+download progress stuff)

## 0.3.9

### Patch Changes

- 971f431: fix some video playback issues and manual image uploadz

## 0.3.8

### Patch Changes

- 8648384: 0. new "request" radio station type that are just live requestz no filter playlist, so member users can queue music or video on these stationz
  1. so work in a video view sql query and also include blake3 in queries; add parent id relation to movie videos to handle relationships with extras
  2. bunch of refactoring to try and unify blob transferz;
  3. a bunch more work on the radio streams to try and avoid stalls and dropouts and also try to show the currently playing song better
  4. fix some lingering issues: transfer progress for currently playing song; video series grid min size; edit video modal logic; improve movie detail page extra relationz;
  5. try to fix some rendering instability; try to improve radio history links back to music or video detail viewz; try to fix top nav local library image lookup; add progress bar ui to cenotaph player;

## 0.3.7

### Patch Changes

- 15e3847: tv on the radio! so radio can stream video now! and mobile safari can now do proper audio + video streams; rathole + linux uses mpv; and some other minor bug fixes

## 0.3.6

### Patch Changes

- 76aa8a8: fix delete-after-play leaking from cenotaph player; tidy cenotaph view; try to fix log-level filter; add more offset top to feed views;

## 0.3.5

### Patch Changes

- ed7673b: rathole getz a cenotaph player (so can remotly queue music + video); linux charnel getz cenotaph player improvementz when using experimental rodio + gstreamer playerz; lotz of improvement to remote queueing; try to fix iroh remote relay urlz with trailing dot harder; try to fix fullscreen video for android
- 7ff2729: re-work file uploadz a bit- add them to local library first, then go thru review, then send to a remote
- c2a9642: android can do fullscreen video!
- 036f5e1: fix bug where if a remote doesn't have an image, the top nav image wouldn't change when switching remotez
- 62207de: only show share linkz from libraries thta support incoming connections (so no android and web)

## 0.3.4

### Patch Changes

- 0b1e9ef: try harder to find song locally when playing back from queue (instead of re-fetching from remote)
- 3ba24e2: try to fix android playback issuez, yank silly linux useragent workaround
- 38d58f4: work out custom relay urls for both charnel and web wasm buildz
- 8c1eac1: try to improve remote view-switcher sub-routes in top nav on mobile touch devicez

## 0.3.3

### Patch Changes

- 466a6d4: feat: private playlistz; when on, only admin users can see the playlist (and hopefully it's not included in search results or feed view)
- ca9a505: add hamburger menu for linux and add stoplight variationz so it's not no mac-y
- da850cb: add re-process button in video edit modal to re-run ffprobe + ffmpeg rendition (transcode only if needed)
- 22c84d4: show new flyout menu in top nav for each remote to get to each remote's routes
- 2fafc1c: feat: collaborative playlistz
- f050eed: add new wizard thing that checks if ffmpeg and yt-dlp are configured valid binz and if not let's user browse + pick 'em
- 5c62511: fix bug where playlistz were not getting included in search resultz
- 2bab740: lib/reliquary: before rejecting duplicate blob, check if the local_path is still a file, and if not, update.

## 0.3.2

### Patch Changes

- 5ddca91: pin tauri version to avoid android boot crashes
- f0a09ea: try to handle remote import errorz better
- 1b7a637: fix issue with adding UNC-style windows file path

## 0.3.1

### Patch Changes

- e98c6df: macos app now has option for chromeless title bar. edge2edge!
- b0435e1: viewer roles can create feed sessions + play analytics
- c9bffce: only navigate back when removable storage is ejected && if on storage overview route

## 0.2.15

### Patch Changes

- ed4527b: fix +radio action button bug when trying to add music to a local radio station
- 2fe58d2: bump @freqhole/playlistz 0.0.6 to fix m3u8 playlist song file pathz
- 8011a27: backfill sha256/blake3/blob_type/parent_blob_id idb blob db
- 2145e9e: removable media sync feature; sync stuff to removable storage! re-use radio filterz to select music to sync, write artist/album/song.ext files and add mp3 id3 metadata, and can re-encode filez as well!

## 0.2.14

### Patch Changes

- 167a735: use trixi for, hopefully, newer version of webkitgtk
- dfa3822: show sync queue to local setting for android userz

## 0.2.13

### Patch Changes

- 4121d96: fix some perf issues in haruspex + midden

## 0.2.12

### Patch Changes

- b8de110: rathole: try to clean up scan header notif when done;
- ffccb7a: try to fix entire folder music upload; some more error loggin'; add open trigger to ci; disable click away on artist + song edit modalz;

## 0.2.11

### Patch Changes

- 04648d3: stub out local blob CRUD (for skein)
- f82cc02: try to get the lint errorz cleaned up!

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
