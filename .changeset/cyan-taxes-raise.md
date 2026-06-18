---
"freqhole-release": patch
---

add review step to add music fetch from url flow so user can review + confirm what yt-dlp will fetch first (will run if there's `precheck_command` set in freqhole-config.yaml). in addition, member (and admin but they could do this already) users can optionally review and edit music metadata for the music they upload; pending review items are persisted in a new tab in the add music modal so user can come back later to finish reviewing. also includes taxons and musicbrainz look up queries
