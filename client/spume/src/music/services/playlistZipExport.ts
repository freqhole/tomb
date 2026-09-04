import { buildPlaylistZip, cleanupOpfsTempFile } from "@freqhole/playlistz/zip-bundle";
import type { BlobFetcher, PlaylistZipEntry } from "@freqhole/playlistz/zip-bundle";
import { generatePlaylistzJs, generateIndexHtml } from "@freqhole/playlistz/templates";
import type { Transport } from "../../app/api/client";
import { getTransportForRemote } from "../../app/api/client";
import { isCharnelMode } from "../../app/services/charnel/mode";
import { getCurrentRemote } from "../data/currentState";
import { readAudioFromOPFS } from "./opfs/helpers";
import { getBlob, getBlobMetadata } from "./storage/blobs";
import { getCachedBlob } from "./cache/blobCache";
import type { Song, Playlist, ImageMetadata } from "./storage/types";
import type { VideoSummary } from "../../video/data/types";

// picks the primary cover image from an ImageMetadata array.
// prefers blob_type "original", falls back to first entry with any blob id.
function pickPrimaryImage(images?: ImageMetadata[]): ImageMetadata | undefined {
  if (!images?.length) return undefined;
  return (
    images.find((i) => i.is_primary && i.blob_type === "original") ??
    images.find((i) => i.is_primary) ??
    images.find((i) => i.remote_blob_id ?? i.local_blob_id)
  );
}

async function toPlaylistZipEntry(playlist: Playlist, songs: Song[]): Promise<PlaylistZipEntry> {
  const playlistImg = pickPrimaryImage(playlist.images);
  const playlistImgSha = playlistImg?.local_blob_id ?? playlistImg?.remote_blob_id;
  const playlistImgMeta = playlistImgSha ? await getBlobMetadata(playlistImgSha) : null;

  const songEntries = await Promise.all(
    songs.map(async (s) => {
      const img = pickPrimaryImage(s.images);
      const imgSha = img?.remote_blob_id ?? img?.local_blob_id;
      const imgMeta = imgSha ? await getBlobMetadata(imgSha) : null;
      return {
        id: s.id,
        title: s.title,
        artist: s.artist_name,
        album: s.album_title,
        duration: s.duration_seconds,
        originalFilename: s.file_name ?? `${s.title}.mp3`,
        mimeType: s.mime_type ?? "audio/mpeg",
        sha: s.sha256,
        // prefer remote_blob_id (transport key), fall back to local_blob_id (opfs key)
        imageSha: imgSha,
        imageType: imgMeta?.mime ?? undefined,
        fileSize: s.file_size ?? undefined,
        lyrics: s.lyrics ?? undefined,
      };
    })
  );

  return {
    playlist: {
      id: playlist.playlist_id,
      title: playlist.title,
      description: playlist.description ?? undefined,
      imageSha: playlistImgSha,
      imageType: playlistImgMeta?.mime ?? undefined,
    },
    songs: songEntries,
  };
}

// builds a BlobFetcher that handles all spume storage backends:
//
//   local/downloaded/synced songs  -> opfs_path -> readAudioFromOPFS
//   local song images               -> local_blob_id -> IDB blob store
//   blob-cached audio               -> sha256 -> browser Cache API (getCachedBlob)
//   remote songs (any transport)    -> media_blob_id -> transport.fetchBlob
//   remote images                   -> remote_blob_id -> transport.fetchBlob
//
// transport is only resolved when remote blobs are present.
// throws only if remote blobs exist but no remote is active.
async function makeSpumeBlobFetcher(playlist: Playlist, songs: Song[]): Promise<BlobFetcher> {
  // opfs maps: sha256 -> opfs audio path; local_blob_id -> thumbnail opfs key
  const opfsAudioMap = new Map<string, string>();
  const opfsImageMap = new Set<string>();

  // blob cache map: sha256 -> remoteId (for getCachedBlob lookup)
  const blobCacheMap = new Map<string, string>();

  // remote map: sha256 or remote_blob_id -> { blobId, blake3? }
  const remoteBlobMap = new Map<string, { blobId: string; blake3?: string }>();

  // include playlist cover images in the fetcher
  for (const img of playlist.images ?? []) {
    if (img.local_blob_id) {
      opfsImageMap.add(img.local_blob_id);
    } else if (img.remote_blob_id) {
      remoteBlobMap.set(img.remote_blob_id, { blobId: img.remote_blob_id });
    }
  }

  for (const s of songs) {
    if (s.opfs_path) {
      opfsAudioMap.set(s.sha256, s.opfs_path);
    } else if (s.sha256) {
      // check blob cache (browser Cache API) before falling back to transport
      if (s.remote_server_id) {
        blobCacheMap.set(s.sha256, s.remote_server_id);
      }
      if (s.media_blob_id) {
        remoteBlobMap.set(s.sha256, { blobId: s.media_blob_id, blake3: s.blake3 ?? undefined });
      }
    }
    for (const img of s.images ?? []) {
      if (img.local_blob_id) {
        opfsImageMap.add(img.local_blob_id);
      } else if (img.remote_blob_id) {
        remoteBlobMap.set(img.remote_blob_id, { blobId: img.remote_blob_id });
      }
    }
  }

  let transport: Transport | null = null;
  if (remoteBlobMap.size > 0) {
    const remote = getCurrentRemote();
    if (!remote)
      throw new Error(
        "playlist has remote blobs but no active remote - cannot fetch blobs for zip"
      );
    transport = await getTransportForRemote(remote);
  }

  return async (key: string) => {
    // 1. local audio from opfs (fully synced, fastest)
    const opfsPath = opfsAudioMap.get(key);
    if (opfsPath) {
      try {
        const file = await readAudioFromOPFS(opfsPath);
        return file.arrayBuffer();
      } catch {
        return undefined;
      }
    }

    // 2. local image from IDB blob store
    if (opfsImageMap.has(key)) {
      try {
        const blob = await getBlob(key);
        return blob?.arrayBuffer();
      } catch {
        return undefined;
      }
    }

    // 3. blob cache (browser Cache API from previous streams) - avoids network if available
    const remoteId = blobCacheMap.get(key);
    if (remoteId) {
      try {
        const response = await getCachedBlob(remoteId, key);
        if (response) return response.arrayBuffer();
      } catch {
        // cache miss or error - fall through to transport
      }
    }

    // 4. remote blob via transport
    const entry = remoteBlobMap.get(key);
    if (entry && transport) {
      try {
        const { data } = await transport.fetchBlob(entry.blobId, entry.blake3);
        return data.buffer as ArrayBuffer;
      } catch {
        return undefined;
      }
    }

    return undefined;
  };
}

export type ZipDownloadResult = { kind: "browser" } | { kind: "tauri"; filePath: string };

export async function downloadPlaylistZip(
  playlist: Playlist,
  songs: Song[],
  videos: VideoSummary[] = []
): Promise<ZipDownloadResult> {
  const entry = await toPlaylistZipEntry(playlist, songs);
  const filename = `${playlist.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "playlist"}.zip`;
  const isTauri = isCharnelMode();

  // in tauri: stream bytes to rust one file at a time so only one song lives in
  // memory at once. rust writes each file to a temp zip on disk immediately.
  // videos are only supported here - see downloadPlaylistZipTauri's own doc
  // comment for why the browser path doesn't get them too.
  if (isTauri) {
    return downloadPlaylistZipTauri(entry, playlist, songs, videos, filename);
  }

  // browser: build zip in js (fflate → OPFS when available) then download.
  // buildPlaylistZip (from @freqhole/playlistz) is called with no options, so
  // it uses its defaults - notably generateM3U: true - see zipBuilder.ts.
  const fetchBlob = await makeSpumeBlobFetcher(playlist, songs);
  const zipBlob = await buildPlaylistZip(entry, fetchBlob);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if ("name" in zipBlob && typeof (zipBlob as File).name === "string") {
      void cleanupOpfsTempFile((zipBlob as File).name);
    }
  }, 1000);
  return { kind: "browser" };
}

/// videos are exported as raw files (`data/<name>.<ext>`) plus `.m3u8`
/// entries only - not the self-contained player app the library builds
/// (playlistz.js/index.html only understand songs). tauri-only for now:
/// this function already builds the zip by hand file-by-file (unlike the
/// browser path, which delegates the whole thing to `buildPlaylistZip`),
/// so adding videos here needs no `@freqhole/playlistz` changes; the
/// browser path would need the library itself extended to accept extra
/// files, so it stays audio-only until that's worth doing.
async function downloadPlaylistZipTauri(
  entry: PlaylistZipEntry,
  playlist: Playlist,
  songs: Song[],
  videos: VideoSummary[],
  filename: string
): Promise<ZipDownloadResult> {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  const fetchBlob = await makeSpumeBlobFetcher(playlist, songs);

  const rootName = playlist.title.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim() || "playlist";
  const tempId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await invoke("zip_create", { tempId });

  const appendFile = async (path: string, bytes: Uint8Array) => {
    await invoke("zip_append_file", { tempId, path, bytes });
  };
  const appendText = async (path: string, text: string) => {
    await appendFile(path, new TextEncoder().encode(text));
  };

  try {
    // playlist cover
    let playlistImagePath: string | undefined;
    if (entry.playlist.imageSha) {
      const bytes = await fetchBlob(entry.playlist.imageSha);
      if (bytes) {
        const ext = extFromMime(entry.playlist.imageType ?? "image/jpeg");
        playlistImagePath = `data/playlist-cover${ext}`;
        await appendFile(`${rootName}/${playlistImagePath}`, new Uint8Array(bytes));
      }
    }

    // songs: one at a time so only one audio file is in memory at once
    const resolvedSongs: Array<{
      id: string;
      title: string;
      artist?: string;
      album?: string;
      duration: number;
      originalFilename: string;
      mimeType: string;
      sha?: string;
      audioPath: string;
      imagePath?: string;
      safeFilename: string;
      fileSize: number;
      imageType?: string;
    }> = [];

    for (const song of entry.songs) {
      const safeFilename = sanitizeForZip(song.originalFilename || `${song.title}.mp3`);
      const safeBase = safeFilename.replace(/\.[^.]+$/, "");
      const audioPath = `data/${safeFilename}`;
      let fileSize = song.fileSize ?? 0;

      if (song.sha) {
        const audioBytes = await fetchBlob(song.sha);
        if (audioBytes) {
          fileSize = audioBytes.byteLength;
          await appendFile(`${rootName}/${audioPath}`, new Uint8Array(audioBytes));
        }
      }

      let imagePath: string | undefined;
      if (song.imageSha) {
        const imageBytes = await fetchBlob(song.imageSha);
        if (imageBytes) {
          const ext = extFromMime(song.imageType ?? "image/jpeg");
          imagePath = `data/${safeBase}-cover${ext}`;
          await appendFile(`${rootName}/${imagePath}`, new Uint8Array(imageBytes));
        }
      }

      resolvedSongs.push({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        originalFilename: song.originalFilename,
        mimeType: song.mimeType,
        sha: song.sha,
        audioPath,
        imagePath,
        safeFilename,
        fileSize,
        imageType: song.imageType,
      });
    }

    // videos: raw files only, written straight to data/ and referenced from
    // the m3u8 below - no entry in playlistz.js (the self-contained player
    // app only understands songs), see downloadPlaylistZipTauri's doc comment.
    // fetched directly via the active remote's transport rather than through
    // fetchBlob/BlobFetcher: unlike Song, VideoSummary carries no sha256 or
    // mimeType of its own, and transport.fetchBlob's response already
    // includes the real contentType, so no extra blob_metadata round trip
    // is needed to pick a file extension.
    const resolvedVideos: Array<{ title: string; duration: number; videoPath: string }> = [];
    if (videos.length > 0) {
      const remote = getCurrentRemote();
      const transport = remote ? await getTransportForRemote(remote) : null;
      for (const video of videos) {
        if (!transport || !video.media_blob_id) continue;
        try {
          const { data, contentType } = await transport.fetchBlob(video.media_blob_id);
          const safeFilename = sanitizeForZip(`${video.title}${videoExtFromMime(contentType)}`);
          const videoPath = `data/${safeFilename}`;
          await appendFile(`${rootName}/${videoPath}`, data);
          resolvedVideos.push({
            title: video.title,
            duration: video.duration_seconds ?? 0,
            videoPath,
          });
        } catch (e) {
          console.error(`failed to fetch video blob for zip export (${video.id}):`, e);
        }
      }
    }

    // m3u8 file - paths inside are relative to the data/ folder it lives in
    const relativeToData = (p: string) => p.replace(/^data\//, "");
    const m3uContent = generateM3UContent(
      {
        id: entry.playlist.id,
        title: entry.playlist.title,
        description: entry.playlist.description,
        rev: entry.playlist.rev,
        imagePath: playlistImagePath && relativeToData(playlistImagePath),
      },
      resolvedSongs.map((r) => ({
        title: r.title,
        artist: r.artist ?? "",
        album: r.album ?? "",
        duration: r.duration,
        audioPath: relativeToData(r.audioPath),
        imagePath: r.imagePath && relativeToData(r.imagePath),
      })),
      resolvedVideos.map((v) => ({
        title: v.title,
        duration: v.duration,
        videoPath: relativeToData(v.videoPath),
      }))
    );
    await appendText(`${rootName}/data/${rootName}.m3u8`, m3uContent);

    // metadata files (small, no memory concern)
    const playlistzData = [
      {
        playlist: {
          id: entry.playlist.id,
          title: entry.playlist.title,
          description: entry.playlist.description,
          rev: entry.playlist.rev,
          imageMimeType:
            entry.playlist.imageType ??
            (playlistImagePath ? mimeFromPath(playlistImagePath) : undefined),
          imageFilePath: playlistImagePath,
          safeFilename: rootName,
        },
        songs: resolvedSongs.map((r) => ({
          id: r.id,
          title: r.title,
          artist: r.artist ?? "",
          album: r.album ?? "",
          duration: r.duration,
          originalFilename: r.originalFilename,
          filePath: r.audioPath,
          safeFilename: r.safeFilename,
          fileSize: r.fileSize,
          mimeType: r.mimeType,
          sha: r.sha,
          imageMimeType: r.imageType ?? (r.imagePath ? mimeFromPath(r.imagePath) : undefined),
          imageFilePath: r.imagePath,
        })),
      },
    ];

    // generatePlaylistzJs from the @freqhole/playlistz package
    await appendText(`${rootName}/playlistz.js`, generatePlaylistzJs(playlistzData));
    await appendText(`${rootName}/index.html`, generateIndexHtml());

    // try to grab the app bundle from the local server
    try {
      const res = await fetch(`${window.location.origin}/freqhole-playlistz.js`);
      if (res.ok) {
        await appendFile(
          `${rootName}/freqhole-playlistz.js`,
          new Uint8Array(await res.arrayBuffer())
        );
      }
    } catch {
      /* bundle not available - zip still works for http serving */
    }

    const filePath = await invoke<string>("zip_finish", { tempId, filename });
    return { kind: "tauri", filePath };
  } catch (err) {
    await invoke("zip_abort", { tempId }).catch(() => {});
    throw err;
  }
}

// derive a file extension from a mime type string
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
  };
  return map[mime] ?? ".jpg";
}

// derive a file extension from a video mime type (mirrors extFromMime above).
// falls back to .mp4, the most common web-compatible container.
function videoExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-matroska": ".mkv",
    "video/mpeg": ".mpeg",
    "video/3gpp": ".3gp",
    "video/x-msvideo": ".avi",
  };
  return map[mime] ?? ".mp4";
}

// derive a mime type from a file path extension (for playlistzData)
function mimeFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
  };
  return ext && map[ext] ? map[ext]! : "image/jpeg";
}

// sanitize a filename for use in a zip path (strip unsafe chars)
function sanitizeForZip(name: string): string {
  return (
    name
      .replace(/[/\\:*?"<>|]/g, "_")
      .replace(/^\.+/, "")
      .trim() || "file"
  );
}

// mirrors @freqhole/playlistz's zip-bundle/m3u.ts format exactly (not
// currently exported from that package's public surface - duplicated here
// rather than reaching into its internal src path). the tauri export path
// builds its own zip by hand (unlike the browser path, which delegates to
// buildPlaylistZip and gets this for free), so it needs its own m3u8 step.
interface M3uSong {
  title: string;
  artist: string;
  album: string;
  duration: number;
  audioPath: string;
  imagePath?: string;
}

// video entries: no artist/album/cover concept, just title + duration -
// see downloadPlaylistZipTauri's doc comment for why videos only ever get
// this far (raw file + m3u8 line, no self-player app awareness).
interface M3uVideo {
  title: string;
  duration: number;
  videoPath: string;
}

interface M3uPlaylist {
  id: string;
  title: string;
  description?: string;
  rev?: number;
  imagePath?: string;
}

function generateM3UContent(
  playlist: M3uPlaylist,
  songs: M3uSong[],
  videos: M3uVideo[] = []
): string {
  let out = "#EXTM3U\n";
  out += `# Playlist: ${playlist.title}\n`;
  out += `# PlaylistId: ${playlist.id}\n`;
  out += `# PlaylistRev: ${playlist.rev ?? 0}\n`;
  if (playlist.description) out += `# Description: ${playlist.description}\n`;
  if (playlist.imagePath) out += `# PlaylistImage: ${playlist.imagePath}\n`;
  out += "\n";

  for (const song of songs) {
    const duration = Math.round(song.duration);
    out += `#EXTINF:${duration}, ${song.artist} - ${song.title}\n`;
    out += `# Title: ${song.title}\n`;
    out += `# Artist: ${song.artist}\n`;
    out += `# Album: ${song.album}\n`;
    if (song.imagePath) out += `# Image: ${song.imagePath}\n`;
    out += `${song.audioPath}\n\n`;
  }

  for (const video of videos) {
    const duration = Math.round(video.duration);
    out += `#EXTINF:${duration}, ${video.title}\n`;
    out += `# Title: ${video.title}\n`;
    out += `${video.videoPath}\n\n`;
  }

  return out;
}
