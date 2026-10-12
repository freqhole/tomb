// best-effort title -> (content type, artist) guess, via grimoire's
// `guess_video_title` route so the classifier lives in exactly one place
// (the same one the yt-dlp/filename importers use). returns null when there
// is no remote to ask (local-only mode) or the call fails - a guess is
// only ever a convenience prefill.
import { getClientForRemote } from "../../app/api/client";
import { getCurrentRemote } from "../../music/data";

export interface VideoTitleGuess {
  /** "karaoke" when the title says so, otherwise null. */
  contentType: string | null;
  artist: string | null;
  songTitle: string | null;
}

export async function guessVideoTitle(title: string): Promise<VideoTitleGuess | null> {
  if (!title.trim()) return null;
  try {
    const remote = getCurrentRemote();
    if (!remote) return null;
    const client = await getClientForRemote(remote);
    const result = await client.video.guessVideoTitle({ title });
    if (!result.success) return null;
    return {
      contentType: result.data.content_type ?? null,
      artist: result.data.artist ?? null,
      songTitle: result.data.song_title ?? null,
    };
  } catch (err) {
    console.error("failed to guess video title:", err);
    return null;
  }
}
