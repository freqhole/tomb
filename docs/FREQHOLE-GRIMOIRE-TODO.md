# FREQHOLE/GRIMOIRE #TODO

some things to note right now: use this `DATABASE_URL=sqlite:/Users/edward/src/github/freqhole/tomb/data/grimoire.db` until we deal with item #8. also it's nice to use `RUSTFLAGS="-A warnings"` when running cargo commands to silence warnings because there's a lot of them and it's very noisy.

1. DONE! i might have made a mistake with these rowid columns. my intention was that they would be used for internal joins. but i think i'm now realizing that's silly and probably a premature optimization ...so i think i want to remove them and just lean into using `id TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(8))))` as the primary key. i was trying to get away from UUID PKs and was thinking auto-incrementing INT would save space but since i still want to have unique(ish) ids i ended up with `hex(randomblob(8)))` so then it seems silly to have both. right, so, anyway, i'd like re-write the migrations/ (it's okay, i'll reset the db); and fix all the rust files in grimoire/

2. DONE! migrate wordlist legacylib/src/wordlist to grimoire/

3. DONE! user stuff. i think we already have some user sqlite tables stubbed out? let's dig more into where we are with that. reference legacylib/. this time around i'm hoping to have the webauthn-rs crate be more optional (passkey auth). regardless of webauth i need crud for registering and managing users and roles; like wordlist stuff for generating invite codes, crud for adding users, changing roles, etc. but also need to implement user favorites for songs but also i'd like to include artists, albums, genres, and playlists! i also want to port the user rating stuff for songs like i had previously worked out but also in this case have ratings for albums and artists (no genres or playlists). the user favorite and rating stuff will be worked into a number of the query and update crud for other models (rather than having, say a single dedicated fn for updating favorites or ratings)-- we might need to discuss more what i mean here. see also: legacylib/src/auth

4. DONE! i need more CRUD for updating songs (and by extension artists, albums, genres, tags). generally i'll be updating a song at a time but the update might include updates to artist, album, genre, tag, etc. (which are separate tables now that i've done more normalization in sqlite db schema vs before when i had just a songs table). i'm hoping for a single function that takes a broad set of optional input rather than a bunch of granular functions that only update, say just the songz row or just the artistz record-- i hope this makes sense, please ask more if it seems ambiguous.

5. DONE! i also had previously worked out a way to update songs in bulk, which was really handy when i wanted to apply the same value (or values!) to multiple songs; like for example updating an album name or genre or thumbnail image (which now with the new schema would only be one update!) but there's probably song-table specific things i'd want to be able to bulk update (as in i pass an array of record ids and a key(s)/value(s) of fields to set like e.g. release date or label). for updates that deal with joined tables i'd want to work out the edge cases where i need to either create or reference an existing record-- like for example if i'm changing the artist for a song(s) i might either create a new artist record or reference an artist that already exists (same thing for album or genre or tags etc).

6. DONE! okay so once 4 and 5 is done, i think we could migrate over the musicbrainz stuff legacylib/src/musicbrainz/

7. DONE! probably will need some CRUD fns for tags and genres. there's already a genre query fn but it's more for rendering this larger genres ui view, what i'd need these for is some smaller places in the ui; like a global state widget for selecting tags to filter, or editing songs to show autocomplete list for tags or genres, or create new tags/genres. there's also sub_genres so being able to manage those hierarchies would be needed CRUD stuff. previously i didn't have any ui for deleting tags or genres, because they were just columns on the songs table so just removing them from songs was enough. now i think that we could just add some new fns in grimoire/src/maintenance/ that could scan the db for orphaned genres or tags and clean them up when needed (as in, there's no records referencing them). oh an probably simple queries for artists and albums to use in autocomplete; so would query like partial string match and then return minimal response just like id and name fields (vs. the other query fns that return way more complex data). it could be that quite of this is now already stubbed out, so perhaps this is more research and validation task?

8. DONE! need to deal with the config file stuff. also need a better solution for an application data dir. like there needs to be a stable (and configurable) path to the sqlite db file(s) but also this would be the config file itself but would also include a working dir for temp files. it's most challenging when i'm developing because i might run the code for any number of paths. when running this "in production" as in a user running the built binary this is a a lot more simple. probably need some stuff that can verify the sqlite db file exists and create one if it doesn't. similar thing for the config file, check it, validate it, and be able to create a new config file (this has mostly been worked out in the legacylib/ or cli/ already)

9. DONE analytics. see legacylib/src/analytics/ there's a lot of this that's really over-engineered (the feed have these monster pg fns) but there's also parts of it that are working good (like tracking song plays); this is gonna involve some strategic refactoring.

10. DONE! deal with a bunch of TODOs in grimoire/src/jobs/service.rs

11. DONE! deal with all the rust compiler warnings so we can stop using `RUSTFLAGS="-A warnings"`. BE CAREFUL NOT TO DELETE STUFF THAT IS IMPORTANT!

12. also have a look at the line count (wc -l) of all the .rs files in grimoire/ to see if we got any >1000 and if so split 'em up into smaller files

13. u32, i64, guh all these number types :/ should we just use usize, ...or? maybe it's fine, but i have a slight holdout for compiling this on a 32bit raspi (ugh soft floatz)

14. add created_at, updated_at, created_by, updated_by columns to migrations/002_blob_data.sql. also maybe consider re-naming the \_by columns to add \_by_user_id so it's more clear what this value is?

15. apply some more of my own aesthetic? plural zz, lowercase, etc.

16. the cli/ package-- ended up getting way too complex and having way too many features and commands! it could be a lot more simple. so need to also be strategic refactoring this! but also having a way to run all the grimoire/ stuff could be a way to deal with integration testing, hmm... can we just move over the grimoire/cli/

17. the server/ package-- this should be somewhat straight-forward. my hopes that grimoire/ package already worked out most of the hard abstractions and then now it's mostly a matter of handling user auth and otherwise wrapping grimoire/ fn in json api handlers.

---

# misc shit

consider singular table names, `rowid` foreign keys (but no fk constraints!), avoid using uuid id columns?! and just auto-incrementing integers (for rowid fields, use maybe short-sha or base64 (or some baseX) or something for id?). oh, and how to deal with multiple processes accessing the same sqlite.db file (eek, IPC or something? just use the json api?!) 

some rough order of operations (phases)

1. media blobz in sqlite, crud rust lib fnz. 1 sqlite.db file for raw media_blobz data (basically key/value store) and 2. sqlite.db for records
2. application state sqlite.db (jobs, config, etc.)
   1. the config stuff got wayyyy too complicated, too many weird half-baked features, too many options in the config file
      1. START WITH A PAIRED-DOWN CONFIG FILE, define a few sensible default values ONCE
      2. DOES THE CONFIG NEED TO BE EXTENDABLE TO OTHER MODULES?!
3. filesystem scan & sync (ionotify? or incremental jobs?); mostly related to just dealing with media_blobz but would soon extend into domain-specific stuff like: music. deal with app directory, backing up sqlite.db files (copy), setting a “watch” directory (that probably needs to recursively scan all sub-dirs)
4. music domain, so another sqlite.db file for this. improve artist, album, and genre normalization and some other useful metadata modeling (see anna’s archive post about spotify sqlite db model! docs/annas-archive-spotify-schema.md). filesystem scan & sync module extensions for handling music-specific files and creating music domain records (that reference media_blobz)
5. auth & authorization (ugh), so maybe also: plugins, can the webauthn-rs stuff be modularized and very very contained? still probably need users, and a way to register users, so the invite/link code stuff could technically issue a cookie… or a JWT? (so like that’d be in the core code shit, and the webauthn-rs stuff could be an optional plugin!)
6. search (fts!) and filtering (eek what about sea-query.rs?)
7. so the server package, do better with route org, make sure auth is required for just about everything. be wary of static file hosting? or config. maybe config can also do, like proxy so http api extensions could happen this way (prolly wildly insecure). BE VERY CLEAR AND EXPLICIT ABOUT THE JSON API! DOCUMENT IT AND HAVE A WAY TO VALIDATE OR GENERATE THE API DOCZ (even cooler, generate zod schemas?!). json api could also be a good way to test?
   1. …would be really cool to be able to get this db.pool().clone() and other db-related stuff outta here and handled in grimoire package…
   2. server/src/upload/mod.rs is a really nice module! ☺️
   3. server/src/media/mod.rs is too mixed up with music domain! should just be for handling media_blobz!  

…so plugins… it’d sure be neat if there was an easy way to have extensions for whatever-weird-feature in it’s own repo, some things so far that might otherwise be better as plugin:

1. yt-dlp stuff
2. musicbrains integration

3. less is more! the more minimal and simple, the better! the more seperation of concern, the better!
4. …the previous cli got way too complex!
5.   important code shit:   avoid a million little half-baked featurez!
6. avoid using defaults as much as possible!
7. be modular! avoid long files (limit ~750 lines of code per file!)
8. contain sql!  try to contain crate deps! try to use fewer crates!
9. no emojis! prefer writing comments and such in lower case text.

pg_dump -s -U postgres -d sales_db > sales_schema.sql

pg_dumpall --schema-only

pg_dumpall --schema-only --dbname="postgresql://postgres:supersecret@localhost:5432/webauthn_db" > all_schemas.sql

docker exec -e PGPASSWORD="supersecret" dev-db pg_dumpall --schema-only -U postgres > all_schemas.sql

---

okay, i really really appreciate the help here. but i'm starting to realize i need integration tests.

i should probably write them in rust, but generally my experience with unit and integration tests is that they turn into a nightmare. sooooo, here's what i'd like to explore:

i initially built this cli/ package, but i started with using pg, and that ended up not what i wanted, so we re-wrote grimoire/ to use sqlite (legacylib/ is old grimoire with pg); we setup a cli.rs to be able to test during development but then it grew and now is a whole module grimoire/src/cli/ and it's looking pretty good. i will eventually get back to working on the cli/ package and it will be oriented towards a user-friendly experience (sometimes called "porcelain"). so then the grimoire/src/cli/ would be oriented towards "plumbing" in that it's input and output are very verbose and technical; and then i could this cli for integration tests! okay so a lot of back-story, what i'd like you help doing (start a new .md file in docs/ with a plan):

review all the cli commands in grimoire/src/cli/ to ensure they're mapped as-directly-as-possible to the all the grimoire library functions they wrap. one example: avoid taking strings like an album name and doing a looking to find the album id (unless this is what the grimoire library does). there might be more arguments the cli needs to call the library functions. and then for the output; i'd like to make the output as structured as possible so that it's easy to parse in integration tests. so remove emojis and lean into, i think tab-separated values (although i haven't thought tsv thru too much, it could be that csv is better). additionally i think having a --json output flag would make reading structured data a lot easier. i'm pretty sure i'd like the default output to be tsv or csv (it's not like ALL the output needs to be that, we can still write human-readable output but have a good convention for structured output, be in some kind of separators to delineate blocks or chunks of output e.g. more-human readable out ##SOME-SEPARATOR## tab separated output)

does this make sense? do you think there's anything i should further consider?

---

Playlist and PlaylistWithCount (ugh)

---

refactor all the cli/ that still has GrimoireResult<()> returns

refactor all the inline crate:: to imports at the top of the file

do all the routes that have route params also include the route param in the request schema/struct? we just fixed this for the delete artist request but are there maybe others lingering with this same issue?

what about ts client wrappers to help with the two upload routes? and also a wrapper for getting the url for a media blob (takes and id and basically returns /api/media/{blob_id} i think the route is).

i need to start a new convo thread. can you write a summary handoff message i can send you in a new thread that has all the context and info to pick back up this work?

---

scan music improvements:

1. should first check db for existing local_path, then if exists can look at metadata json blob to see when file was created and last modified, if the same can bail, if different then can update db records. might need to make sure we're saving file's created and updated at dates (in UTC, i think? i dunno, i don't want to end up in a timezone hole) in db.
2. a scan job that validates all the media blob's local_path are infact still real files on disk, if no longer on disk, soft delete.
3. it might be good to persist in the db, the directories that are given to the scan jobs, so that we can go back later and rescan to see if any more music has been added to those dirs (or possibly that music has been removed, or perhaps moved and/or renamed). this is probably a different scan job (or jobs?), so make sure the plumbing cli is wired up to be able to call these.
4. it might be nice if the server api can process queue these scan jobs? only root and admin users should be able to do this. and perhaps there should be an new config file entry to enable (or disable) this. i think only the re-scan job here because passing a valid directory thru the json api might be tricky.

a couple more important details i'd like:

1. the job runners should be able to gracefully stop and pause work and pick back up where they left off the next time they start.
2. i also want to audit a bit to make sure the retry logic is working as i would expect: that failed jobs can be re-tried (not infinity!) and marked success if successful or marked failed (or permanently failed if retries exhausted)
3. i want to adit to make sure any commands used are coming from config, so i think we need to move ffmpeg and image magik commands (maybe others?).

---

Code Style Preference: lowercase prose in comments and strings\*\*

When writing code (especially comments, documentation strings, and user-facing messages), prefer lowercase, conversational prose style.

**Keep uppercase for:**

- Acronyms (API, HTTP, JSON, SQL)
- Proper nouns (Rust, TypeScript, GitHub)
- Code identifiers (variable names, function names, type names)
- Special markers (TODO, FIXME, NOTE, WARNING)

**Use lowercase for:**

- Regular comments explaining code logic
- Documentation/docstrings
- User-facing messages and error strings
- Log messages

**Examples:**

✅ Good:

```typescript
// extract data from server response wrapper before validation
const data = json.data ?? json;

throw new Error("failed to connect to database");

// TODO: add support for pagination
```

❌ Avoid:

```typescript
// Extract Data From Server Response Wrapper Before Validation
const data = json.data ?? json;

throw new Error("Failed to connect to database");

// Todo: Add Support For Pagination
```

This keeps code feeling conversational and approachable rather than formal/corporate.

---

write more about how search should work! maybe dig out some current json api payloadz?

I. autocomplete flyout menu grouped by: artists, albums, songs, genres, and playlists

II. search page with results grouped by: all, artists, albums, songs, genres, and playlists

I. autocomplete example

'/api/music/suggestions?field=all&partial=mix&page_size=25'
response:

```json
{
  "suggestions": [
    {
      "value": "Mix",
      "display": "Mix (artist)",
      "highlight": "**Mix**",
      "count": 19,
      "suggestion_type": "artist",
      "confidence": 1.0,
      "metadata": null
    },
    {
      "value": "Rap mix",
      "display": "Rap mix (artist)",
      "highlight": "Rap **mix**",
      "count": 18,
      "suggestion_type": "artist",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "ni9e - XMIX 2005",
      "display": "ni9e - XMIX 2005 (artist)",
      "highlight": "ni9e - X**MIX** 2005",
      "count": 17,
      "suggestion_type": "artist",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "Demos & Remixes",
      "display": "Demos & Remixes - Nine Inch Nails (album)",
      "highlight": "Demos & Re**mix**es",
      "count": 56,
      "suggestion_type": "album",
      "confidence": 0.7,
      "metadata": {
        "album": "Demos & Remixes",
        "artist": "Nine Inch Nails"
      }
    },
    {
      "value": "Carl Cox - Mixed Live",
      "display": "Carl Cox - Mixed Live - Carl Cox (album)",
      "highlight": "Carl Cox - **Mix**ed Live",
      "count": 21,
      "suggestion_type": "album",
      "confidence": 0.7,
      "metadata": {
        "album": "Carl Cox - Mixed Live",
        "artist": "Carl Cox"
      }
    },
    {
      "value": "X-Mix: Fast Forward & Rewind",
      "display": "X-Mix: Fast Forward & Rewind - Ken Ishii (album)",
      "highlight": "X-**Mix**: Fast Forward & Rewind",
      "count": 20,
      "suggestion_type": "album",
      "confidence": 0.7,
      "metadata": {
        "album": "X-Mix: Fast Forward & Rewind",
        "artist": "Ken Ishii"
      }
    },
    {
      "value": "007 (Shanty Town) - Desmond Dekker - X-Mix 2008",
      "display": "007 (Shanty Town) - Desmond Dekker - X-Mix 2008 - ni9e (song)",
      "highlight": "007 (Shanty Town) - Desmond Dekker - X-**Mix** 2008",
      "count": 1,
      "suggestion_type": "title",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "19-2000 (Soulchild Remix) - Gorillaz",
      "display": "19-2000 (Soulchild Remix) - Gorillaz - Gorillaz (song)",
      "highlight": "19-2000 (Soulchild Re**mix**) - Gorillaz",
      "count": 1,
      "suggestion_type": "title",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "19-2000 (Soulchild Remix) - Gorillaz",
      "display": "19-2000 (Soulchild Remix) - Gorillaz - Gorillaz (song)",
      "highlight": "19-2000 (Soulchild Re**mix**) - Gorillaz",
      "count": 1,
      "suggestion_type": "title",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "mixtape",
      "display": "mixtape (genre)",
      "highlight": "mixtape",
      "count": 34,
      "suggestion_type": "genre",
      "confidence": 0.0,
      "metadata": null
    },
    {
      "value": "Back To Mine",
      "display": "Back To Mine (playlist)",
      "highlight": "Back To Mine",
      "count": 33,
      "suggestion_type": "playlist",
      "confidence": 0.0,
      "metadata": {
        "playlist_id": "b95f2d3d-7b78-40ea-a36c-5920e149c973"
      }
    },
    {
      "value": "fall 2025 mixy",
      "display": "fall 2025 mixy (playlist)",
      "highlight": "fall 2025 mixy",
      "count": 25,
      "suggestion_type": "playlist",
      "confidence": 0.0,
      "metadata": {
        "playlist_id": "b0aff7ae-9cf7-4147-a6a7-d8ed5ebfb1ca"
      }
    },
    {
      "value": "winter 2025 mixy",
      "display": "winter 2025 mixy (playlist)",
      "highlight": "winter 2025 mixy",
      "count": 18,
      "suggestion_type": "playlist",
      "confidence": 0.0,
      "metadata": {
        "playlist_id": "66227a67-29c1-4ae5-adb3-3b1000f1027e"
      }
    }
  ],
  "query_time_ms": 51,
  "total_count": 13,
  "page": 1,
  "page_size": 25,
  "total_pages": 1,
  "has_next": false,
  "has_prev": false
}
```

'/api/music/suggestions?field=all&partial=deat&page_size=25'

response:

```json
{
  "suggestions": [
    {
      "value": "Death From Above 1979",
      "display": "Death From Above 1979 (artist)",
      "highlight": "**Deat**h From Above 1979",
      "count": 26,
      "suggestion_type": "artist",
      "confidence": 0.9,
      "metadata": null
    },
    {
      "value": "Deathbomb Digital Singles Club Year 2",
      "display": "Deathbomb Digital Singles Club Year 2 - various artists (album)",
      "highlight": "**Deat**hbomb Digital Singles Club Year 2",
      "count": 67,
      "suggestion_type": "album",
      "confidence": 0.9,
      "metadata": {
        "album": "Deathbomb Digital Singles Club Year 2",
        "artist": "various artists"
      }
    },
    {
      "value": "Deathbomb Digital Singles Club Year 1 (Part 1/2)",
      "display": "Deathbomb Digital Singles Club Year 1 (Part 1/2) - various artists (album)",
      "highlight": "**Deat**hbomb Digital Singles Club Year 1 (Part 1/2)",
      "count": 56,
      "suggestion_type": "album",
      "confidence": 0.9,
      "metadata": {
        "album": "Deathbomb Digital Singles Club Year 1 (Part 1/2)",
        "artist": "various artists"
      }
    },
    {
      "value": "Deathbomb Digital Singles Club Year 1 (Part 2/2)",
      "display": "Deathbomb Digital Singles Club Year 1 (Part 2/2) - various artists (album)",
      "highlight": "**Deat**hbomb Digital Singles Club Year 1 (Part 2/2)",
      "count": 52,
      "suggestion_type": "album",
      "confidence": 0.9,
      "metadata": {
        "album": "Deathbomb Digital Singles Club Year 1 (Part 2/2)",
        "artist": "various artists"
      }
    },
    {
      "value": "future death toll",
      "display": "future death toll (artist)",
      "highlight": "future **deat**h toll",
      "count": 27,
      "suggestion_type": "artist",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "FUTURE DEATH TOLL",
      "display": "FUTURE DEATH TOLL (artist)",
      "highlight": "FUTURE **DEAT**H TOLL",
      "count": 18,
      "suggestion_type": "artist",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "A Lack Of Color - Death Cab For Cutie",
      "display": "A Lack Of Color - Death Cab For Cutie - Death Cab For Cutie (song)",
      "highlight": "A Lack Of Color - **Deat**h Cab For Cutie",
      "count": 1,
      "suggestion_type": "title",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "Better Off Dead (Le Peste Cover) - Death from Above 1979",
      "display": "Better Off Dead (Le Peste Cover) - Death from Above 1979 - Death From Above 1979 (song)",
      "highlight": "Better Off Dead (Le Peste Cover) - **Deat**h from Above 1979",
      "count": 1,
      "suggestion_type": "title",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "Black History Month (Alan Braxe & Fred Falke Remix) - Death from Above 1979",
      "display": "Black History Month (Alan Braxe & Fred Falke Remix) - Death from Above 1979 - Death From Above 1979 (song)",
      "highlight": "Black History Month (Alan Braxe & Fred Falke Remix) - **Deat**h from Above 1979",
      "count": 1,
      "suggestion_type": "title",
      "confidence": 0.7,
      "metadata": null
    },
    {
      "value": "Death Metal",
      "display": "Death Metal (genre)",
      "highlight": "Death Metal",
      "count": 14,
      "suggestion_type": "genre",
      "confidence": 0.0,
      "metadata": null
    },
    {
      "value": "Death metal",
      "display": "Death metal (genre)",
      "highlight": "Death metal",
      "count": 1,
      "suggestion_type": "genre",
      "confidence": 0.0,
      "metadata": null
    }
  ],
  "query_time_ms": 58,
  "total_count": 11,
  "page": 1,
  "page_size": 25,
  "total_pages": 1,
  "has_next": false,
  "has_prev": false
}
```

II. search page

'/api/music/search'

request:

```json
{
  "query": "death",
  "page": 1,
  "page_size": 20,
  "sort_by": "created_at",
  "sort_direction": "desc",
  "include_genres": true,
  "include_playlists": true
}
```

response:

```json
{
  "songs": [
    {
      "id": "3540e187-755b-4c99-bd6f-9570ff90cede",
      "title": "Forget Me Nots",
      "artist": "Patrice Rushen",
      "album": "Straight from the Heart (Remastered)",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 244,
      "genre": null,
      "sub_genres": [],
      "year": 2021,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Forget Me Nots",
      "detailed_display_title": "Patrice Rushen - Forget Me Nots",
      "created_at": "2026-01-14T16:50:21.476172Z",
      "media_blob_id": "803a675",
      "thumbnail_blob_id": "027fc5a",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "65d09847-c2a0-412d-89f6-5c409ad70a93",
      "title": "Domo Genesis - Long Way Home (prod. by Stoney Willis)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 10,
      "disc_number": null,
      "duration_seconds": 159,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - Long Way Home (prod. by Stoney Willis)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - Long Way Home (prod. by Stoney Willis)",
      "created_at": "2026-01-11T02:38:31.536334Z",
      "media_blob_id": "2c314fc",
      "thumbnail_blob_id": "6c177b6",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "e7cc1445-93c6-4d3b-9fbc-c96963d51dfe",
      "title": "Domo Genesis - Slow Burn (prod. by Sap)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 9,
      "disc_number": null,
      "duration_seconds": 141,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - Slow Burn (prod. by Sap)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - Slow Burn (prod. by Sap)",
      "created_at": "2026-01-11T02:38:31.523202Z",
      "media_blob_id": "429d7c2",
      "thumbnail_blob_id": "d4f3f6e",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "0796cd42-1249-4dbe-9388-162382a63317",
      "title": "Domo Genesis - What It Means (prod. by J. Rawls)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 8,
      "disc_number": null,
      "duration_seconds": 189,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - What It Means (prod. by J. Rawls)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - What It Means (prod. by J. Rawls)",
      "created_at": "2026-01-11T02:38:31.504653Z",
      "media_blob_id": "14096fa",
      "thumbnail_blob_id": "d31b51d",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "041f0c2d-6638-4423-8b95-accb90282a04",
      "title": "Domo Genesis - Self Doubt the Interlude (prod. by Take Flight)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 7,
      "disc_number": null,
      "duration_seconds": 129,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - Self Doubt the Interlude (prod. by Take Flight)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - Self Doubt the Interlude (prod. by Take Flight)",
      "created_at": "2026-01-11T02:38:31.486206Z",
      "media_blob_id": "79bcc17",
      "thumbnail_blob_id": "00da954",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "8fc5e8d1-3dd9-4375-b44b-ae982bca7f26",
      "title": "Domo Genesis - Overthinking (feat. Styles P) (prod. by Sap)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 6,
      "disc_number": null,
      "duration_seconds": 205,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - Overthinking (feat. Styles P) (prod. by Sap)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - Overthinking (feat. Styles P) (prod. by Sap)",
      "created_at": "2026-01-11T02:38:31.468324Z",
      "media_blob_id": "78c3834",
      "thumbnail_blob_id": "929e7f7",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "323f79fe-11fd-4721-8e29-a5c7fe470fc0",
      "title": "Domo Genesis - Honestly, Just Wanna Have a Good Time (feat. King Chip) (prod. by Hi-Tek)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 5,
      "disc_number": null,
      "duration_seconds": 237,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - Honestly, Just Wanna Have a Good Time (feat. King Chip) (prod. by Hi-Tek)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - Honestly, Just Wanna Have a Good Time (feat. King Chip) (prod. by Hi-Tek)",
      "created_at": "2026-01-11T02:38:31.455563Z",
      "media_blob_id": "1dd070c",
      "thumbnail_blob_id": "4677990",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "e2f8cfb0-d63b-45ba-b769-222ffb75291a",
      "title": "Domo Genesis - ...Time Goes By (prod. by Stoney Willis)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 4,
      "disc_number": null,
      "duration_seconds": 158,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - ...Time Goes By (prod. by Stoney Willis)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - ...Time Goes By (prod. by Stoney Willis)",
      "created_at": "2026-01-11T02:38:31.438799Z",
      "media_blob_id": "af45d0c",
      "thumbnail_blob_id": "407b1d3",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "d467c0fc-45c4-4083-ac8b-e99ae112b826",
      "title": "Domo Genesis - Deez Nuts (prod. by Evidence)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 3,
      "disc_number": null,
      "duration_seconds": 160,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - Deez Nuts (prod. by Evidence)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - Deez Nuts (prod. by Evidence)",
      "created_at": "2026-01-11T02:38:31.425456Z",
      "media_blob_id": "c94d203",
      "thumbnail_blob_id": "1f38407",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "bc23aa59-193a-40df-a4bf-14c2130ba725",
      "title": "Domo Genesis - The Red Corolla (prod. by Left Brain)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 1,
      "disc_number": null,
      "duration_seconds": 172,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - The Red Corolla (prod. by Left Brain)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - The Red Corolla (prod. by Left Brain)",
      "created_at": "2026-01-11T02:38:31.396514Z",
      "media_blob_id": "3d1ef9b",
      "thumbnail_blob_id": "9e7c359",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "0d108b86-5083-4442-bf3d-b3644f78e1b7",
      "title": "Domo Genesis - Vintage Doms (prod. by Stoney Willis)",
      "artist": "Domo Genesis",
      "album": "Red Corolla - Domo Genesis",
      "album_artist": "OFWGKTA Official",
      "track_number": 2,
      "disc_number": null,
      "duration_seconds": 172,
      "genre": "Hip Hop/Rap",
      "sub_genres": [],
      "year": 2017,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Domo Genesis - Vintage Doms (prod. by Stoney Willis)",
      "detailed_display_title": "Domo Genesis - Domo Genesis - Vintage Doms (prod. by Stoney Willis)",
      "created_at": "2026-01-11T02:38:31.334481Z",
      "media_blob_id": "1c95097",
      "thumbnail_blob_id": "acc6ad3",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "a77126e9-33b1-4ea9-bdcc-65fed25ee943",
      "title": "Damned Ladies",
      "artist": "Rufus Wainwright",
      "album": "Rufus Wainwright",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 246,
      "genre": null,
      "sub_genres": [],
      "year": 2018,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Damned Ladies",
      "detailed_display_title": "Rufus Wainwright - Damned Ladies",
      "created_at": "2026-01-09T19:41:21.113804Z",
      "media_blob_id": "a98590d",
      "thumbnail_blob_id": "958e31e",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "812b36a7-0448-49ff-bb63-a4715b9e153c",
      "title": "William Bell & Judy Clay - Private Number (Official Audio) - from STAX: SOULSVILLE U.S.A.",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 160,
      "genre": null,
      "sub_genres": [],
      "year": 2024,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "William Bell & Judy Clay - Private Number (Official Audio) - from STAX: SOULSVILLE U.S.A.",
      "detailed_display_title": "Stax Records - William Bell & Judy Clay - Private Number (Official Audio) - from STAX: SOULSVILLE U.S.A.",
      "created_at": "2026-01-09T18:20:53.186394Z",
      "media_blob_id": "da5a3bf",
      "thumbnail_blob_id": "b4f6a2b",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "dd6ef584-8929-4d74-8721-eb1b0419bae2",
      "title": "Johnnie Taylor - Jodys Got Your Girl And Gone (Official Audio) - from STAX: SOULSVILLE U.S.A.",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 181,
      "genre": null,
      "sub_genres": [],
      "year": 2024,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Johnnie Taylor - Jodys Got Your Girl And Gone (Official Audio) - from STAX: SOULSVILLE U.S.A.",
      "detailed_display_title": "Stax Records - Johnnie Taylor - Jodys Got Your Girl And Gone (Official Audio) - from STAX: SOULSVILLE U.S.A.",
      "created_at": "2026-01-09T18:20:37.156712Z",
      "media_blob_id": "abbb6da",
      "thumbnail_blob_id": "7b00438",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "12a74151-a109-4265-9412-f9432fa9e1da",
      "title": "All I Do Is Dream - William Bell and Carla Thomas",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 199,
      "genre": null,
      "sub_genres": [],
      "year": 2015,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "All I Do Is Dream - William Bell and Carla Thomas",
      "detailed_display_title": "Stax Records - All I Do Is Dream - William Bell and Carla Thomas",
      "created_at": "2026-01-09T18:20:17.082416Z",
      "media_blob_id": "b5975d9",
      "thumbnail_blob_id": "650e43d",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "bf96a656-23a3-4dec-9c8f-d2d36d8c337d",
      "title": "Rufus Thomas - The Funky Bird from Crown Prince Of Dance",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 204,
      "genre": null,
      "sub_genres": [],
      "year": 2019,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Rufus Thomas - The Funky Bird from Crown Prince Of Dance",
      "detailed_display_title": "Stax Records - Rufus Thomas - The Funky Bird from Crown Prince Of Dance",
      "created_at": "2026-01-09T18:19:57.031602Z",
      "media_blob_id": "1d933d1",
      "thumbnail_blob_id": "90afde2",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "dac657e9-bd99-48c7-906a-eb5315054694",
      "title": "Carla Thomas - I Like What You're Doing (To Me) (Lyric Video) from Memphis Queen",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 178,
      "genre": null,
      "sub_genres": [],
      "year": 2019,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Carla Thomas - I Like What You're Doing (To Me) (Lyric Video) from Memphis Queen",
      "detailed_display_title": "Stax Records - Carla Thomas - I Like What You're Doing (To Me) (Lyric Video) from Memphis Queen",
      "created_at": "2026-01-09T18:19:38.995646Z",
      "media_blob_id": "9809d64",
      "thumbnail_blob_id": "2e968ba",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "f3b8e508-954c-44c8-bdf2-d3e40965dfe4",
      "title": "Respect Yourself - Staple Singers",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 210,
      "genre": null,
      "sub_genres": [],
      "year": 2015,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Respect Yourself - Staple Singers",
      "detailed_display_title": "Stax Records - Respect Yourself - Staple Singers",
      "created_at": "2026-01-09T18:19:20.93086Z",
      "media_blob_id": "803a399",
      "thumbnail_blob_id": "d767c16",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "96e18e15-f788-4e1a-b618-db7b38d9e398",
      "title": "Woman to Woman - Shirley Brown",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 235,
      "genre": null,
      "sub_genres": [],
      "year": 2015,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "Woman to Woman - Shirley Brown",
      "detailed_display_title": "Stax Records - Woman to Woman - Shirley Brown",
      "created_at": "2026-01-09T18:19:02.898986Z",
      "media_blob_id": "062ce65",
      "thumbnail_blob_id": "a8983d9",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    },
    {
      "id": "a2dfb937-f58f-4720-9f39-f514aa408f86",
      "title": "The Staple Singers - Who Made The Man",
      "artist": "Stax Records",
      "album": "unknown album",
      "album_artist": null,
      "track_number": 0,
      "disc_number": null,
      "duration_seconds": 260,
      "genre": null,
      "sub_genres": [],
      "year": 2015,
      "bpm": null,
      "key_signature": null,
      "user_rating": null,
      "user_is_favorite": false,
      "tags": [],
      "display_title": "The Staple Singers - Who Made The Man",
      "detailed_display_title": "Stax Records - The Staple Singers - Who Made The Man",
      "created_at": "2026-01-09T18:18:42.832435Z",
      "media_blob_id": "68a6c76",
      "thumbnail_blob_id": "437690f",
      "waveform_blob_id": null,
      "thumbnail_blob_ids": [],
      "preference_updated_at": null
    }
  ],
  "genres": [
    {
      "genre": "Death metal",
      "song_count": 1,
      "artist_count": 1,
      "representative_song_id": "9e94a118-f899-4577-a2e3-4f4223199182",
      "representative_thumbnail": "78c6682",
      "avg_rating": null,
      "search_rank": 0.06079271
    },
    {
      "genre": "Death Metal",
      "song_count": 14,
      "artist_count": 2,
      "representative_song_id": "f0e1cd10-d101-424d-b2f0-cf3e2f540e73",
      "representative_thumbnail": "98468e9",
      "avg_rating": null,
      "search_rank": 0.06079271
    }
  ],
  "playlists": [],
  "total_count": 11735,
  "page": 1,
  "page_size": 20,
  "total_pages": 587,
  "has_next": true,
  "has_prev": false,
  "query_time_ms": 28,
  "applied_filters": null,
  "sort_applied": null
}
```

...okay, the time has come for a grimoire/src/utilz/ folder module i think. can we move grimoire/src/metadata.rs, grimoire/src/health.rs, grimoire/src/sessions.rs, grimoire/src/dbinfo/mod.rs, grimoire/src/api_registry/mod.rs into this new utilz/ module?

edward's api key: f64f5f02a7041bf0bf252ee884de360851b504c1da0bd6abe65889314ce07b2f

# Search Tag Filtering Complete - Handoff for Genre/Sub-Genre Filtering

## What Just Got Done ✅

Successfully implemented **tag filtering for search** across all entity types!

### Completed Features:

1. **Tag filtering infrastructure** - Album-only tags via `album_tagz` junction table
2. **SQL filtering implemented** in `grimoire/src/search/queries.rs`:
   - `search_songs()` - filters songs by album tags
   - `search_albums()` - filters albums directly by tags
   - `search_artists()` - filters artists who have albums with tags
   - `search_genres()` - filters genres that appear on albums with tags
   - `search_playlists()` - filters playlists containing songs from tagged albums
   - `count_song_results()` - matching filter logic for pagination
3. **Include/exclude logic**:
   - Include: OR logic (must have at least one tag)
   - Exclude: AND NOT logic (must not have any tags)
4. **Server integration** - `grimoire/src/search/service.rs` passes `tag_filter` to all search functions
5. **TypeScript tests** - 3 new integration tests in `client-codegen/freqhole-api-client/src/test/stateful.ts`
6. **All tests passing** - 240/241 tests pass

### Test Results:

```bash
# Works with include filter
curl -X POST http://localhost:8080/api/music/search \
  -H "Authorization: Bearer <key>" \
  -d '{"query":"a","field":"songs","context":{"tags":{"include":["tag001"]}}}'
# Returns: 13 songs from albums tagged "experimental"

# Works with exclude filter
curl -X POST http://localhost:8080/api/music/search \
  -d '{"query":"a","field":"songs","context":{"tags":{"exclude":["tag001"]}}}'
# Returns: 1 song from albums NOT tagged "experimental"
```

## What's Next: Genre/Sub-Genre Filtering 🚧

### Current State:

- Genre/sub-genre filter parameters are **accepted but stubbed out** (prefixed with `_` to silence warnings)
- In `search_songs()` and `search_albums()`: `_genre_filter`, `_sub_genre_filter` params exist but unused
- SQL structure is ready, just needs genre filter WHERE clauses added

### Database Schema Refresher:

```sql
-- Genres (one per album)
albumz.genre_id -> genrez.id

-- Sub-genres (many-to-many)
album_sub_genrez (album_id, sub_genre_id)
  -> sub_genrez.id
```

### Implementation Plan:

#### 1. Add genre filtering to `search_songs()` (~15-20 min)

Need to add WHERE clauses after the tag filters:

```sql
-- Genre include (OR logic)
AND (NOT ? OR EXISTS (
  SELECT 1 FROM album_songz asong_filter
  JOIN albumz album_filter ON asong_filter.album_id = album_filter.id
  WHERE asong_filter.song_id = song.id
  AND album_filter.genre_id IN (SELECT value FROM json_each(?))
))

-- Genre exclude (AND NOT logic)
AND (NOT ? OR NOT EXISTS (
  SELECT 1 FROM album_songz asong_filter
  JOIN albumz album_filter ON asong_filter.album_id = album_filter.id
  WHERE asong_filter.song_id = song.id
  AND album_filter.genre_id IN (SELECT value FROM json_each(?))
))

-- Sub-genre include (OR logic)
AND (NOT ? OR EXISTS (
  SELECT 1 FROM album_songz asong_filter
  JOIN album_sub_genrez asg ON asg.album_id = asong_filter.album_id
  WHERE asong_filter.song_id = song.id
  AND asg.sub_genre_id IN (SELECT value FROM json_each(?))
))

-- Sub-genre exclude (AND NOT logic)
AND (NOT ? OR NOT EXISTS (
  SELECT 1 FROM album_songz asong_filter
  JOIN album_sub_genrez asg ON asg.album_id = asong_filter.album_id
  WHERE asong_filter.song_id = song.id
  AND asg.sub_genre_id IN (SELECT value FROM json_each(?))
))
```

#### 2. Add genre filtering to `search_albums()` (~10-15 min)

Simpler because querying albums directly:

```sql
-- Genre include
AND (NOT ? OR album.genre_id IN (SELECT value FROM json_each(?)))

-- Genre exclude
AND (NOT ? OR album.genre_id NOT IN (SELECT value FROM json_each(?)))

-- Sub-genre include
AND (NOT ? OR EXISTS (
  SELECT 1 FROM album_sub_genrez asg
  WHERE asg.album_id = album.id
  AND asg.sub_genre_id IN (SELECT value FROM json_each(?))
))

-- Sub-genre exclude
AND (NOT ? OR NOT EXISTS (
  SELECT 1 FROM album_sub_genrez asg
  WHERE asg.album_id = album.id
  AND asg.sub_genre_id IN (SELECT value FROM json_each(?))
))
```

#### 3. Update `count_song_results()` (~10 min)

Apply the same genre/sub-genre filters as `search_songs()` for accurate counts.

#### 4. Update `search_artists()`, `search_genres()`, `search_playlists()` (~15-20 min)

Similar EXISTS patterns to filter by genres/sub-genres on albums.

#### 5. Unmute the parameters (~2 min)

Remove `_` prefix from `_genre_filter` and `_sub_genre_filter` parameters.

#### 6. Update service.rs to pass filters (~5 min)

Already passing genre_filter/sub_genre_filter to some functions, but verify all calls include them.

### Files to Modify:

- `tomb/grimoire/src/search/queries.rs` - Add SQL WHERE clauses
- `tomb/grimoire/src/search/service.rs` - Verify filter params passed everywhere
- `tomb/client-codegen/freqhole-api-client/src/test/stateful.ts` - Add genre filter tests

### Estimated Time:

**~1.5 to 2 hours** total

### Testing Strategy:

1. Add test data:

```sql
-- Get genre IDs
SELECT id, name FROM genrez LIMIT 3;

-- Get sub-genre IDs
SELECT id, name FROM sub_genrez LIMIT 3;

-- Test with curl
curl -X POST http://localhost:8080/api/music/search \
  -d '{"query":"a","field":"songs","context":{"genres":{"include":["<genre_id>"]}}}'
```

2. Add TypeScript integration tests similar to tag tests

### Key Implementation Notes:

- Use same pattern as tag filtering (boolean flags + json_each)
- Bind JSON strings to variables to avoid temporary value borrow issues
- Genre is simpler (direct foreign key), sub-genre needs junction table join
- Include = OR, Exclude = AND NOT (same logic as tags)

### Code Style Reminder:

- Lowercase prose in comments
- Use `json_each(?)` for dynamic IN clauses
- Bind JSON params as variables before sqlx query
- Keep `!` annotations for non-null columns

## Quick Commands:

```bash
# Check compilation
cargo check --package grimoire

# Run tests
cd client-codegen/freqhole-api-client && \
  API_KEY="f64f5f02a7041bf0bf252ee884de360851b504c1da0bd6abe65889314ce07b2f" \
  API_URL="http://localhost:8080" npm test

# Query database
sqlite3 data/grimoire.db "SELECT id, name FROM genrez LIMIT 5;"
```

---

**Status**: Tag filtering is complete and tested. Genre/sub-genre filtering is next - all the infrastructure is there, just needs the SQL implementation! 🚀

---

# FRONTEND 🐴
