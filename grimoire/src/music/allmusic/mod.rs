//! allmusic integration via apify scraper actor (scaffold).
//!
//! allmusic does **not** publish a public api. the apify actor
//! `lexis-solutions/allmusic-scraper`
//! (<https://apify.com/lexis-solutions/allmusic-scraper>) provides a
//! third-party scraper-as-a-service that returns structured json. the
//! tradeoffs vs musicbrainz / last.fm / audiodb:
//!
//! pros:
//! - allmusic has the **best curated mood vocabulary on the open web**
//!   (one of the few sources with first-class `moods: [..]` per album).
//! - rich curated `themes`, `styles`, `moods`, professional review text,
//!   credits, similar-album recommendations.
//! - **the only one** with actual editorial reviews (vs. user-submitted
//!   wiki blurbs).
//!
//! cons / risks:
//! - **third-party scraper** — neither allmusic-affiliated nor
//!   contractually stable. expect breakage; design retries + caching
//!   accordingly.
//! - **paid** (apify usage units; ~$0.50–$2 per 1k items at the time of
//!   writing). only run on explicitly-confirmed albums; never speculatively.
//! - tos compliance: allmusic's tos restricts scraping. **only run this
//!   on libraries the user owns and only at the user's explicit request**.
//!   do not background-fetch.
//! - rate-limited per apify plan; not per-host.
//!
//! design implications:
//! - default `enabled = false`; the operator must explicitly enable +
//!   provide an apify api token in config.
//! - calls go through the apify "run-sync-get-dataset-items" endpoint:
//!   `POST https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items?token={token}`
//!   with a small json input. this blocks until the run finishes or the
//!   timeout (configurable) expires.
//! - cache aggressively: persist results in `albumz.metadata.allmusic.*`
//!   and treat them as long-lived (months); only refetch on user request.

pub mod client;
pub mod models;

pub use client::AllMusicClient;
pub use models::{AllMusicAlbum, AllMusicCredit, AllMusicReview};
