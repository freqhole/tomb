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
  setVolume: (v: number) => void;

  listCache: () => Promise<CachedSong[]>;
  deleteCached: (id: string) => Promise<void>;
  clearCache: () => Promise<void>;

  log: (msg: string) => void;
}

export function mountUi(h: UiHandlers): void {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;

  // -- host ---------------------------------------------------------------

  const hostStatus = $("host-status");
  const hostTicket = $<HTMLInputElement>("host-ticket");
  const hostCopy = $<HTMLButtonElement>("host-copy");

  $("host-pick").addEventListener("click", async () => {
    const path = await h.pickFile();
    if (!path) return;
    hostStatus.textContent = `hosting: ${path.split("/").pop()}`;
    try {
      const r = await h.hostFile(path);
      hostTicket.value = r.ticket;
      hostCopy.disabled = false;
      h.log(`hosting song_id=${r.songId}`);
    } catch (e) {
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
  $<HTMLInputElement>("peer-vol").addEventListener("input", (e) => {
    h.setVolume(Number((e.target as HTMLInputElement).value));
  });

  // -- cache --------------------------------------------------------------

  const cacheList = $("cache-list");
  const cacheUsage = $("cache-usage");

  async function refreshCache(): Promise<void> {
    cacheList.innerHTML = "";
    const songs = await h.listCache();
    for (const s of songs) {
      const li = document.createElement("li");
      li.textContent = `${s.title ?? s.song_id}  (${s.chunk_count} chunks, ${(
        s.bytes / 1024
      ).toFixed(1)} KB) `;
      const playBtn = document.createElement("button");
      playBtn.textContent = "play";
      playBtn.addEventListener("click", async () => {
        await h.loadCached(s.song_id);
        await h.play();
      });
      const delBtn = document.createElement("button");
      delBtn.textContent = "delete";
      delBtn.addEventListener("click", async () => {
        await h.deleteCached(s.song_id);
        await refreshCache();
      });
      li.append(playBtn, delBtn);
      cacheList.append(li);
    }
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      cacheUsage.textContent = `opfs: ${((e.usage ?? 0) / 1_048_576).toFixed(
        1,
      )} / ${((e.quota ?? 0) / 1_048_576).toFixed(0)} MB`;
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
}
