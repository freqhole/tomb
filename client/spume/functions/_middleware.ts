// cloudflare pages function: rewrites og:title/og:description/<title>
// for share links so link previews (slack/discord/imessage/twitter/...)
// show what's actually being shared, instead of the static "freqhole"
// default every other page gets.
//
// why this has to be a function at all, not just client-side js: link
// preview crawlers fetch the url and parse the static html response - they
// don't execute javascript, so anything spume's own solid code does after
// load is invisible to them. this function runs server-side (well,
// edge-side) and rewrites the html *before* it reaches the crawler.
//
// why the share token has to be a real query param (`?share=...`), not in
// the url's hash fragment (`#...`) the way it used to be: the fragment is
// never sent to the server at all - that's basic http/browser behavior,
// not a cloudflare limitation. see utils/permalink.ts's buildShareUrls doc
// comment for the full story. a share link shared before that change
// still has its token stuck in the hash and can never get a dynamic
// preview after the fact - this function only ever sees `?share=`.
//
// og:image deliberately is NOT rewritten here - every freqhole page (see
// index.html) uses the same static logo, since no per-item artwork is (or
// should be) embedded in a share token - fetching real artwork at
// request time from a source that might be an unreachable p2p node is
// its own pile of complexity/reliability problems for very little payoff
// on a text-preview feature.
//
// decoding is a small, standalone reimplementation of
// lib/haruspex/ts/src/share/codec.ts's wire format (not an import of that
// package) - this only needs 4 display-only fields (entity kind, title,
// artist, album), none of which need the full codec's validation/legacy-
// shape support, and keeping this function free of workspace-package
// imports sidesteps any risk of that package's own dependency graph not
// bundling cleanly for the pages functions (workerd) runtime.

interface SharePreviewInfo {
  kind: string;
  title?: string;
  artist?: string;
  album?: string;
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
  };
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
    case "video_series":
      description = "video on freqhole";
      break;
    case "radio_station":
      description = "radio station on freqhole";
      break;
    default:
      description = "shared via freqhole";
  }
  return { title, description };
}

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("share");
  if (!token) return context.next();

  const info = decodeSharePreviewInfo(token);
  if (!info) return context.next();

  const response = await context.next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const { title, description } = buildPreviewText(info);

  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(`${title} · freqhole`);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .transform(response);
};
