//! theaudiodb integration module (scaffold)
//!
//! provides a thin client + models for the v1 (and limited v2) json api at
//! `https://www.theaudiodb.com/api/v1/json/{key}/...`. test key `2` is
//! freely usable for low-volume non-commercial requests; donate-to-patreon
//! gets you a real key.
//!
//! the **payoff** here vs musicbrainz / last.fm:
//! - **richer visual assets**: `strAlbumThumb` (cover), `strAlbumThumbBack`
//!   (back cover), `strAlbumCDart` (cd disk art), `strAlbumSpine`,
//!   `strAlbum3DCase`, `strAlbumThumbHQ`. great for hero / detail views.
//! - **structured prose**: `strDescriptionEN` (english + many other locales)
//!   per album and per artist, distinct from last.fm's wiki source.
//! - **structured genre/style/mood-ish fields**: `strGenre`, `strStyle`,
//!   `strMood`(!), `strLabel` on albums. **theaudiodb is the only one of
//!   these three sources with a typed `strMood` field**, so this is where
//!   the long-promised mood story actually starts.
//! - **scoring** (`intScore`, `intScoreVotes`) for surfacing community fav.
//!
//! lookup happens in two steps:
//! 1. `searchalbum.php?s={artist}&a={album}` → returns matching `Album[]`
//! 2. by mbid: `album-mb.php?i={mbid}` (or artist-mb / track-mb)
//!
//! audiodb does not document a hard rate limit but encourages "no more
//! than 2 r/s"; we use the shared 1 r/s limiter to be polite.

pub mod client;
pub mod models;

pub use client::AudioDbClient;
pub use models::{AudioDbAlbum, AudioDbArtist, AudioDbSearchAlbumsResponse};
