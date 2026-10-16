// share.freqhole.net — dedicated link-preview + redirect service.
//
// why a separate subdomain, not a function bolted onto the main spume
// project: spume.freqhole.net is a large SPA with lots of static
// sub-resources (hashed JS/CSS/images). cloudflare pages functions only
// invoke for routes NOT excluded by `_routes.json` (auto-generated to
// exclude static asset folders when `functions/` sits at the project's
// configured root directory) - but spume's build command/root directory
// already can't satisfy that placement requirement (root directory is
// pinned to the repo root for its own npm-workspace-style build step),
// and the alternative (`_worker.js` "advanced mode") routes EVERY request,
// including every JS/CSS/image sub-resource, through a function - with
// real ambiguity over whether `_routes.json`-style exclusion still works
// in that mode at all. this project sidesteps the whole question: it has
// no static asset tree of consequence (one logo, one fallback page), so
// "every request invokes a function" is a complete non-issue here - it's
// not a side effect to route around, it's the entire point.
//
// flow: a crawler (slack/discord/imessage/...) fetches this url, reads
// the static <title>/og:*/twitter:* tags from the response HTML, and
// never executes the inline redirect script - crawlers don't run js, so
// they only ever see the rich preview. a human clicking the same link
// gets bounced almost instantly into the real app (spume.freqhole.net,
// which owns all the actual resolve-this-share-link logic - this project
// has no access to anyone's local remotes/db, so it can't resolve
// anything itself).
//
// decoding is a small, standalone reimplementation of
// lib/haruspex/ts/src/share/codec.ts's wire format (not an import of that
// package) - deliberately dependency-free so there's no risk of a
// workspace package's dependency graph failing to bundle cleanly for the
// pages functions (workerd) runtime. this used to be duplicated in
// client/spume/functions/_middleware.ts too (spume.freqhole.net's own,
// never-successfully-deployed attempt at this same feature - see the
// DEFAULT_SHARE_WEB_HOST doc comment in permalink.ts for why that
// approach hit a real deployment blocker) - that file was removed once
// this dedicated subdomain replaced it, so there's only one copy now.

const APP_HOST = "https://spume.freqhole.net";
const OG_IMAGE_URL = "https://share.freqhole.net/freqhole.png";

interface SharePreviewInfo {
  kind: string;
  title?: string;
  artist?: string;
  album?: string;
  /** display name of the remote this was shared from (the sharer's own
   *  locally-cached label for it, not a canonical name). */
  remoteName?: string;
  /** video content_type ("series"|"movie"|"clip"|"karaoke"|"music_video") -
   *  only set for `kind === "video"`. */
  contentType?: string;
  /** title of the series a shared video belongs to, when attached to one -
   *  only set for `kind === "video"`. */
  seriesTitle?: string;
}

/** base64url (no padding) -> utf8 string, same alphabet
 *  lib/haruspex/ts/src/share/codec.ts's encoder uses. */
function base64UrlDecodeToString(token: string): string {
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** decodes just enough of a share token to build a link preview - accepts
 *  both the current wire version (`v:2`, share-kind `k:"entity"`, entity
 *  kind in `ek`) and the legacy `v:1` entity shape (no separate share-kind
 *  discriminant existed yet, so `k` directly held the entity kind - see
 *  codec.ts's `EntityLegacyV1Schema`). returns null for anything that
 *  doesn't parse, or for a non-entity share (a bare node/doc share, from a
 *  different freqhole app, has nothing to preview here). */
function decodeSharePreviewInfo(token: string): SharePreviewInfo | null {
  let json: unknown;
  try {
    json = JSON.parse(base64UrlDecodeToString(token));
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const w = json as Record<string, unknown>;

  let entityKind: string;
  if (w.v === 2 && w.k === "entity" && typeof w.ek === "string") {
    entityKind = w.ek;
  } else if (w.v === 1 && typeof w.s === "object" && w.s !== null && typeof w.k === "string") {
    entityKind = w.k;
  } else {
    return null;
  }

  return {
    kind: entityKind,
    title: typeof w.t === "string" ? w.t : undefined,
    artist: typeof w.a === "string" ? w.a : undefined,
    album: typeof w.al === "string" ? w.al : undefined,
    remoteName: typeof w.rn === "string" ? w.rn : undefined,
    contentType: typeof w.ct === "string" ? w.ct : undefined,
    seriesTitle: typeof w.st === "string" ? w.st : undefined,
  };
}

/** friendly label for a video's `content_type` - see grimoire's
 *  `Video::content_type` for the canonical value set. */
function contentTypeLabel(contentType?: string): string | undefined {
  switch (contentType) {
    case "music_video":
      return "music video";
    case "karaoke":
      return "karaoke video";
    case "movie":
      return "movie";
    case "clip":
      return "clip";
    default:
      return undefined;
  }
}

function buildPreviewText(info: SharePreviewInfo): { title: string; description: string } {
  const title = info.title?.trim() || "freqhole";
  let description: string;
  switch (info.kind) {
    case "song":
      description = [info.artist, info.album].filter(Boolean).join(" — ") || "song on freqhole";
      break;
    case "album":
      description = info.artist ? `album by ${info.artist}` : "album on freqhole";
      break;
    case "artist":
      description = "artist on freqhole";
      break;
    case "playlist":
      description = "playlist on freqhole";
      break;
    case "video":
      description = info.seriesTitle
        ? `episode of ${info.seriesTitle}`
        : contentTypeLabel(info.contentType) ?? "video on freqhole";
      break;
    case "video_series":
      description = "video series on freqhole";
      break;
    case "radio_station":
      description = "radio station on freqhole";
      break;
    default:
      description = "shared via freqhole";
  }
  if (info.remoteName) {
    description = `${description} · shared from ${info.remoteName}`;
  }
  return { title, description };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** renders the whole response document from scratch, rather than
 *  rewriting a pre-built static file via HTMLRewriter (the technique
 *  spume's own removed _middleware.ts attempt used) - this project has no
 *  complex SPA document to layer onto, so there's nothing to gain from
 *  incremental-rewrite machinery here. */
function renderPage(opts: { title: string; description: string; appUrl: string }): string {
  const title = escapeHtml(opts.title);
  const description = escapeHtml(opts.description);
  // JSON.stringify, not escapeHtml, for the script-embedded url - produces
  // a valid, safely-quoted JS string literal (handles embedded quotes
  // correctly), which html-escaping alone does not.
  const appUrlJs = JSON.stringify(opts.appUrl);
  const appUrlHtml = escapeHtml(opts.appUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} · freqhole</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="freqhole" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta name="description" content="${description}" />
<meta property="og:image" content="${OG_IMAGE_URL}" />
<meta name="twitter:card" content="summary" />
<link rel="icon" type="image/png" href="/freqhole.png" />
<meta name="robots" content="noindex" />
<script>location.replace(${appUrlJs});</script>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;">
  <div style="text-align: center; padding: 2rem; max-width: 28rem;">
    <img src="/freqhole.png" alt="" width="64" height="64" style="margin-bottom: 1rem; border-radius: 12px;" />
    <h1 style="font-size: 1.1rem; margin: 0 0 0.5rem;">${title}</h1>
    <p style="opacity: 0.7; margin: 0 0 1.5rem;">${description}</p>
    <a href="${appUrlHtml}" style="display: inline-block; padding: 0.6rem 1.2rem; background: #d946ef; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600;">open in freqhole</a>
  </div>
</body>
</html>`;
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("share");

  if (!token) {
    return htmlResponse(
      renderPage({
        title: "freqhole",
        description: "self-hosted music + video library",
        appUrl: APP_HOST,
      })
    );
  }

  // the app url always carries the token along, valid or not - spume's
  // own ResolveShareModal already renders an "invalid link" view for a
  // token that fails to decode there, so there's no need to duplicate
  // that handling here. this project's only job is the preview text.
  const appUrl = `${APP_HOST}/?share=${encodeURIComponent(token)}#`;

  const info = decodeSharePreviewInfo(token);
  const { title, description } = info
    ? buildPreviewText(info)
    : { title: "freqhole", description: "shared via freqhole" };

  return htmlResponse(renderPage({ title, description, appUrl }));
};
