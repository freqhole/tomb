// sibyl demo ui wiring. **scaffolding** — pure dom glue between
// buttons and `SibylPlayer` calls.

import type { CachedSong } from "@sibyl/player";

export interface UiHandlers {
  pickFile: () => Promise<string | null>;
  hostFile: (path: string) => Promise<{ ticket: string; songId: string }>;
  loadTicket: (ticket: string) => Promise<void>;
  loadCached: (songId: string) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  /** stop the in-flight network download for the active song.
   *  audio keeps playing whatever is already buffered. */
  pauseDownload: () => void;
  /** resume a paused or interrupted download for the currently
   *  loaded manifest, or for the given cached song id (which must
   *  have a `ticket` in its manifest). */
  resumeDownload: (songId?: string) => Promise<void>;
  setVolume: (v: number) => void;

  listCache: () => Promise<CachedSong[]>;
  deleteCached: (id: string) => Promise<void>;
  clearCache: () => Promise<void>;

  log: (msg: string) => void;
}

export interface UiControls {
  /** force the cached-songs panel to re-read opfs and re-render. */
  refreshCache: () => Promise<void>;
  /** update the in-flight progress display for a peer download. */
  updateProgress: (songId: string, have: number, total?: number) => void;
  /** update the in-flight progress display for a host transcode. */
  updateHostProgress: (songId: string, chunksPublished: number) => void;
  /** render the diagnostics row. */
  updateStats: (s: {
    chunksDownloaded: number;
    bytesDownloaded: number;
    decodeMsAvg: number;
    timeToFirstChunkMs?: number;
    sessionMs: number;
  }) => void;
}

export function mountUi(h: UiHandlers): UiControls {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;

  // -- host ---------------------------------------------------------------

  const hostStatus = $("host-status");
  const hostTicket = $<HTMLInputElement>("host-ticket");
  const hostCopy = $<HTMLButtonElement>("host-copy");

  $("host-pick").addEventListener("click", async () => {
    const path = await h.pickFile();
    if (!path) return;
    const leaf = path.split("/").pop() ?? path;
    hostStatus.textContent = `transcoding ${leaf}\u2026  (0 chunks)`;
    try {
      const r = await h.hostFile(path);
      hostTicket.value = r.ticket;
      hostCopy.disabled = false;
      hostStatus.textContent = `ready: ${leaf}  \u2192  ticket below`;
      h.log(`hosting song_id=${r.songId}`);
    } catch (e) {
      hostStatus.textContent = `host error: ${(e as Error).message}`;
      h.log(`host error: ${(e as Error).message}`);
    }
  });

  hostCopy.addEventListener("click", () => {
    if (hostTicket.value) navigator.clipboard.writeText(hostTicket.value);
  });

  // -- peer ---------------------------------------------------------------

  const peerStatus = $("peer-status");
  $("peer-load").addEventListener("click", async () => {
    const ticket = $<HTMLInputElement>("peer-ticket").value.trim();
    if (!ticket) return;
    peerStatus.textContent = "loading…";
    try {
      await h.loadTicket(ticket);
      await h.play();
      peerStatus.textContent = "playing";
    } catch (e) {
      peerStatus.textContent = "error";
      h.log(`peer error: ${(e as Error).message}`);
    }
  });

  $("peer-pause").addEventListener("click", () => h.pause());
  $("peer-resume").addEventListener("click", () => void h.play());
  $("peer-dl-pause").addEventListener("click", () => h.pauseDownload());
  $("peer-dl-resume").addEventListener("click", () => {
    void h.resumeDownload().catch((e) => h.log(`resume download error: ${(e as Error).message}`));
  });
  $<HTMLInputElement>("peer-vol").addEventListener("input", (e) => {
    h.setVolume(Number((e.target as HTMLInputElement).value));
  });

  // -- cache --------------------------------------------------------------

  const cacheList = $("cache-list");
  const cacheUsage = $("cache-usage");

  // tracks rendered rows so refreshCache() can do a keyed in-place
  // diff instead of nuking innerHTML on every tick. without this the
  // 500ms refresh-while-downloading rebuilds every <li> + <button>,
  // causing visible flicker, focus loss, and tooltip churn.
  type CacheRow = {
    li: HTMLLIElement;
    label: HTMLSpanElement;
    playBtn: HTMLButtonElement;
    copyBtn: HTMLButtonElement;
    delBtn: HTMLButtonElement;
    resumeBtn?: HTMLButtonElement;
    /** the last manifest ticket we attached a click handler for; if
     *  the ticket changes (e.g. backfilled on resume) we re-bind. */
    ticket?: string;
  };
  const rendered = new Map<string, CacheRow>();

  /** wait for any in-flight refresh to finish before starting a new
   *  one — back-to-back progress events used to fire overlapping
   *  refreshCache() calls and the second one would briefly observe
   *  the first one's empty list. */
  let refreshInFlight: Promise<void> = Promise.resolve();
  function refreshCache(): Promise<void> {
    refreshInFlight = refreshInFlight
      .catch(() => undefined)
      .then(() => doRefresh());
    return refreshInFlight;
  }

  async function doRefresh(): Promise<void> {
    let songs;
    try {
      songs = await h.listCache();
    } catch (e) {
      // a concurrent in-flight download may be writing into opfs while
      // we're iterating it; rather than wipe the list, leave the
      // previous render in place and let the next refresh try again.
      console.warn("[sibyl] refreshCache: listCache failed", e);
      return;
    }
    // sort by recency (most-recently-created first). manifest.created_at
    // is wall-clock ms, set on first chunk receive.
    songs.sort((a, b) => (b.manifest.created_at ?? 0) - (a.manifest.created_at ?? 0));

    const seen = new Set<string>();
    let prevSibling: ChildNode | null = null;
    for (const s of songs) {
      seen.add(s.song_id);
      const total = s.manifest.chunks_total;
      const isComplete = total !== undefined && s.chunk_count >= total;
      const badge = isComplete ? "[complete]" : `[${s.chunk_count}${total ? "/" + total : ""}]`;
      const labelText = `${s.title ?? s.song_id}  ${badge}  (${(s.bytes / 1024).toFixed(1)} KB) `;
      const ticket = s.manifest.ticket;

      let row = rendered.get(s.song_id);
      if (!row) {
        // first time rendering this song — build the row.
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = labelText;
        const playBtn = document.createElement("button");
        playBtn.textContent = "play";
        playBtn.addEventListener("click", async () => {
          await h.loadCached(s.song_id);
          await h.play();
        });
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "copy ticket";
        const delBtn = document.createElement("button");
        delBtn.textContent = "delete";
        delBtn.addEventListener("click", async () => {
          await h.deleteCached(s.song_id);
          await refreshCache();
        });
        li.append(label, playBtn, copyBtn, delBtn);
        row = { li, label, playBtn, copyBtn, delBtn };
        rendered.set(s.song_id, row);
      } else if (row.label.textContent !== labelText) {
        // mutate text only if it actually changed; avoids triggering
        // a layout/style recalc on every progress tick.
        row.label.textContent = labelText;
      }

      // (re)bind copy-ticket if the manifest's ticket value changed
      // (e.g. backfilled on resume). cloning the node drops the old
      // listener cleanly; this is a single-row op so it's fine.
      if (row.ticket !== ticket) {
        const fresh = row.copyBtn.cloneNode(true) as HTMLButtonElement;
        if (!ticket) {
          fresh.disabled = true;
          fresh.title = "no ticket stored for this cached song";
        } else {
          fresh.disabled = false;
          fresh.title = "";
          fresh.addEventListener("click", async () => {
            await navigator.clipboard.writeText(ticket);
            const prev = fresh.textContent;
            fresh.textContent = "copied!";
            setTimeout(() => { fresh.textContent = prev; }, 1200);
          });
        }
        row.copyBtn.replaceWith(fresh);
        row.copyBtn = fresh;
        row.ticket = ticket;
      }

      // resume-download button only exists on incomplete entries
      // with a ticket. add/remove it as state changes rather than
      // re-creating the whole row.
      const wantResume = !isComplete && !!ticket;
      if (wantResume && !row.resumeBtn) {
        const btn = document.createElement("button");
        btn.textContent = "resume download";
        btn.title = "continue downloading missing chunks for this song";
        btn.addEventListener("click", async () => {
          if (!ticket) return;
          try { await h.loadTicket(ticket); }
          catch (e) { h.log(`resume error: ${(e as Error).message}`); }
        });
        row.li.append(btn);
        row.resumeBtn = btn;
      } else if (!wantResume && row.resumeBtn) {
        row.resumeBtn.remove();
        row.resumeBtn = undefined;
      }

      // ensure the row is in the right slot (sort order may shift as
      // created_at-less manifests get backfilled). insertBefore is a
      // no-op when the node is already in place.
      const expectedNext: ChildNode | null = prevSibling ? prevSibling.nextSibling : cacheList.firstChild;
      if (expectedNext !== row.li) {
        cacheList.insertBefore(row.li, expectedNext);
      }
      prevSibling = row.li;
    }

    // drop rows for songs that no longer exist in opfs.
    for (const [id, row] of rendered) {
      if (!seen.has(id)) {
        row.li.remove();
        rendered.delete(id);
      }
    }
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      const used = (e.usage ?? 0) / 1_048_576;
      const total = (e.quota ?? 0) / 1_048_576;
      const pct = total > 0 ? (used / total) * 100 : 0;
      cacheUsage.textContent = `opfs: ${used.toFixed(1)} / ${total.toFixed(
        0,
      )} MB  (${pct.toFixed(1)}%)`;
    }
  }

  $("cache-refresh").addEventListener("click", refreshCache);
  $("cache-clear").addEventListener("click", async () => {
    await h.clearCache();
    await refreshCache();
  });
  void refreshCache();

  // -- log buttons --------------------------------------------------------

  $("log-copy").addEventListener("click", () => {
    const t = $("log").textContent ?? "";
    navigator.clipboard.writeText(t);
  });
  $("log-clear").addEventListener("click", () => {
    $("log").textContent = "";
  });

  function updateProgress(songId: string, have: number, total?: number): void {
    const pct = total ? `${Math.round((have / total) * 100)}%` : `${have}`;
    peerStatus.textContent =
      total !== undefined
        ? `${songId.slice(0, 8)}…  ${have}/${total}  (${pct})`
        : `${songId.slice(0, 8)}…  ${have} chunks`;
  }

  function updateHostProgress(songId: string, chunksPublished: number): void {
    // ~1.04 s of audio per chunk at MP3_DEFAULT.
    const seconds = (chunksPublished * 1.04).toFixed(1);
    hostStatus.textContent =
      `transcoding ${songId.slice(0, 8)}…  ${chunksPublished} chunks (~${seconds}s)`;
  }

  const statsRow = document.getElementById("stats");
  function updateStats(s: {
    chunksDownloaded: number;
    bytesDownloaded: number;
    decodeMsAvg: number;
    timeToFirstChunkMs?: number;
    sessionMs: number;
  }): void {
    if (!statsRow) return;
    if (s.chunksDownloaded === 0 && s.sessionMs < 500) {
      statsRow.textContent = "";
      return;
    }
    const kb = (s.bytesDownloaded / 1024).toFixed(1);
    const rate =
      s.sessionMs > 0
        ? ((s.bytesDownloaded / 1024) / (s.sessionMs / 1000)).toFixed(1)
        : "0.0";
    const ttfc =
      s.timeToFirstChunkMs !== undefined ? `${s.timeToFirstChunkMs} ms` : "—";
    statsRow.textContent =
      `chunks ${s.chunksDownloaded}  ` +
      `· ${kb} KB  ` +
      `· ${rate} KB/s  ` +
      `· decode ~${s.decodeMsAvg.toFixed(2)} ms  ` +
      `· ttfc ${ttfc}`;
  }

  return { refreshCache, updateProgress, updateHostProgress, updateStats };
}
