so, like, more modules! like a lil' library package, should orient around some feature, has versioning, will probably import other packages. so far have features like:

music domain, so a song player and browser ui

1. audio player
   a. mediaSession -- so browser system ui display and interactive controls)
   b. queue -- so handles collections of songs to play thru + ui
   c. core -- essentially would wrap browser audio player for play, pause, seek, time updates, etc.; what's currently playing (and how the queue works?)
   d. ui -- display current playing song, player controls, fav, context menu, queue toggle, etc.
2. collections -- so like these are derived from song attributes. these things can be sorted (but generally the sorting occurs after the "album" collection grouping) and filtered (so via a search query but also by tags (either has or does not have, some tags))
   a. albums -- this is composted with songs' `artist` + `album`. this is a particularly important collection of songs, because the order of the songs here should be preserved (songs' `disc_number` + `track_number`) in any further sorting (generally)!
   b. songs
   c. artists
   d. genres -- this one starts getting more elaborate because it can benefit by some aggregate groupings defined in a static (or user-defined, as in persisted elsewhere); for example a remote server or user or even in the code there could be a static collection of genre names and perhaps also a sub-list of genres that would group, think like "electronic" genre with sub-list for example: `["dance", "techno", "house", "gabber", ...etc]`. there would also be other derived lists from here, like a list of unique artists for each genre group; but finally it would resolve to a list of songs (but these songs are grouped and sorted by "album")
   e. playlists -- so these are like collections of songs but with some persisted metadata describing the collection like: name, description, a photo, song sort order, and when it was created and last updated; it's more of a user-specific thing (tho multiple users can mutate a playlist)
   f. favorites, ratings, play history -- these are user-specific collections (and each a feature) of songs

i really want to start working on a more offline-focused PWA application, so this includes some abstractions for:

1. persistent indexed db storage (but this is also a feature, so need to consider when indexdb isn't available or the user chooses not to use it).
2. a service worker abstraction for handling persistent caching of images and audio files, offline stuff including a way to update when the application code is updated
3. remotes -- so an server api-client that has a very clear encapsulation of data that comes from a remote server. the application will be able to coordinate with multiple remote servers. the user likely will have a primary "home server" but really there should be some kind of "sync" rules that orchestrate how data is persisted from the remote to the user's persistent indexed db and cache store. it should use zod and have a central representation of the data models it expects a remote server to provide-- so that it's clear what a server needs to provide so testing and implementation can be easy (as possible). the integration point here could have a test suite in order to ensure remote servers are providing the music data as needed by the client. so i guess a remote would have placeholder in application indexed db (or whatever persisted layer) and ui state that provide details on where and how to interact with the remote server. user can choose to "fully sync" with the remote (i guess this would be like a home server mode?), i guess enable or choose features like analytics stuff, user-role stuff (like admins can do more feature stuff), preferences (like favs and ratings, theme, etc.).

what i want to work on more, tho is:

1. the service worker setup and cache persistence
2. indexed db modeling (and updates)
3. a remote server api-client (application will let user have multiple remotes)
4. a good model for how to use solid-js createResource to load data from indexed db and the remote server. how caching and loading async data works (using a stale while revalidate approach). clear patterns for how to abstract collections of songs that get updated from user-interactions as well as remote server events. clear patterns for sorting, filtering, mutating data, and getting any ui components rendering that data, to update.
5. a good model for rendering virtualized infinite scroll lists (using aforementioned createResource stuff). as well as a good way to subscribe to different collections, like for example, the application might have all these rendered at once: a list of playlists, a list of genres, a list of artists, a list of albums, then player currently playing and also the current queue. there would be user interactions that might need one or more of these collections to re-render (like a user favorites a song, or collection of songs, or edits or deletes a song or collection, etc.). navigation and scroll position restoration is also a really important part of this.

i've attempted to make #4 + #5 many times and it's still not quite right. there's been a lot of duplication with slightly different abstractions; and still there hasn't been a good solve for loading data from the server into collections that are then rendered in virtualized infinite scroll lists. i'm hoping to make a plan on how to go about building out and modeling some of this larger application-wide logic. i'd like to find a better way to encapsulate code by feature; i think packages might be the way to go. i plan on having slightly different variations on how remote servers will work; they wouldn't provide some features, and there could be different implementations for how it loads data into the application-- i think proxying this thru the indexed db data is a good approach (i suppose it might be a little heavy if a user just wants to poke through a remote server once, like it'd be a lot of data potentially to have to load into persisted idb, but i do also think the idb data is a bit ephemeral).

i don't yet have any ui or anything that models multiple remote servers, or really any meaningful indexdb or service worker stuff; so thinking that could be a good place to start. i'd like to work out the initial application loading state and ui, data fetching and idb modeling that tracks what remote server it came from. i'm not sure how i want to model each remote. i do also want to enable an offline first application, and i also want to let the user decide how much data is persisted in indexed db. so being able to have like a application global set of data, and then also a way to delineate that data by remote server, is important (like when evicting data, syncing data, etc.). the user should still be able to use the application without any remote servers, so could like choose song files off disk and load them into the application to browse/sort and play them.

see also: docs/solid_offline_first_architecture_primitives_virtual.md (but i don't want to use `localforage` npm package!)
