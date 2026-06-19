import { buildPlaylistZip } from "@freqhole/playlistz/zip-bundle";
import type { BlobFetcher, PlaylistZipEntry } from "@freqhole/playlistz/zip-bundle";
import type { Transport } from "../../app/api/client";
import { getTransportForRemote } from "../../app/api/client";
import { getCurrentRemote } from "../data/currentState";
import { readAudioFromOPFS } from "./opfs/helpers";
import { getBlob, getBlobMetadata } from "./storage/blobs";
import type { Song, Playlist, ImageMetadata } from "./storage/types";

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
        imageType: imgMeta?.mime_type ?? undefined,
        fileSize: s.file_size ?? undefined,
        lyrics: s.lyrics ?? undefined,
      };
    }),
  );

  return {
    playlist: {
      id: playlist.playlist_id,
      title: playlist.title,
      description: playlist.description ?? undefined,
      imageSha: playlistImgSha,
      imageType: playlistImgMeta?.mime_type ?? undefined,
    },
    songs: songEntries,
  };
}

// builds a BlobFetcher that handles all spume storage backends:
//
//   local/downloaded/synced songs  -> opfs_path -> readAudioFromOPFS
//   local song images               -> local_blob_id -> readThumbnailFromOPFS
//   remote songs (any transport)    -> media_blob_id -> transport.fetchBlob
//   remote images                   -> remote_blob_id -> transport.fetchBlob
//
// transport is only resolved when remote blobs are present.
// throws only if remote blobs exist but no remote is active.
async function makeSpumeBlobFetcher(playlist: Playlist, songs: Song[]): Promise<BlobFetcher> {
  // opfs maps: sha256 -> opfs audio path; local_blob_id -> thumbnail opfs key
  const opfsAudioMap = new Map<string, string>();
  const opfsImageMap = new Set<string>();

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
    } else if (s.sha256 && s.media_blob_id) {
      remoteBlobMap.set(s.sha256, { blobId: s.media_blob_id, blake3: s.blake3 ?? undefined });
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
    if (!remote) throw new Error("playlist has remote blobs but no active remote - cannot fetch blobs for zip");
    transport = await getTransportForRemote(remote);
  }

  return async (key: string) => {
    // local audio from opfs
    const opfsPath = opfsAudioMap.get(key);
    if (opfsPath) {
      try {
        const file = await readAudioFromOPFS(opfsPath);
        return file.arrayBuffer();
      } catch {
        return undefined;
      }
    }

    // local image from IDB blob store (local_blob_id is an IDB key, not an opfs path)
    if (opfsImageMap.has(key)) {
      try {
        const blob = await getBlob(key);
        return blob?.arrayBuffer();
      } catch {
        return undefined;
      }
    }

    // remote blob via transport
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

export type ZipDownloadResult =
  | { kind: "browser" }
  | { kind: "tauri"; filePath: string };

export async function downloadPlaylistZip(
  playlist: Playlist,
  songs: Song[],
): Promise<ZipDownloadResult> {
  const entry = await toPlaylistZipEntry(playlist, songs);
  const fetchBlob = await makeSpumeBlobFetcher(playlist, songs);
  const zipBlob = await buildPlaylistZip(entry, fetchBlob);
  const filename = `${playlist.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "playlist"}.zip`;

  // in tauri, write directly to ~/Downloads and return the path
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    const buf = await zipBlob.arrayBuffer();
    const filePath = await invoke<string>("save_zip_to_downloads", {
      bytes: Array.from(new Uint8Array(buf)),
      filename,
    });
    return { kind: "tauri", filePath };
  }

  // browser: trigger file download via anchor click
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { kind: "browser" };
}
