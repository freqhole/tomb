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

write more about how search should work!
