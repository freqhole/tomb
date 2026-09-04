import { createSignal, Show } from "solid-js";
import { downloadPlaylistZip } from "../../services/playlistZipExport";
import { toast } from "../../../components/feedback/Toast";
import { DownloadZipIcon } from "../../../components/icons/registry";
import { LoaderIcon } from "../../../components/icons/registry";
import type { Playlist } from "../../services/storage/types";
import type { Song } from "../../data/types";
import type { VideoSummary } from "../../../video/data/types";

interface Props {
  playlist: Playlist;
  songs: Song[];
  videos?: VideoSummary[];
}

// shared download logic - reused by the icon button below and by narrow-view
// overflow flyout menus that just need the click behavior without the
// standalone icon button chrome.
export async function downloadPlaylistZipWithToast(
  playlist: Playlist,
  songs: Song[],
  videos: VideoSummary[] = []
) {
  try {
    const result = await downloadPlaylistZip(playlist, songs, videos);
    if (result.kind === "tauri") {
      const filePath = result.filePath;
      toast.success("zip bundle saved", {
        action: {
          label: "open folder",
          onClick: async () => {
            // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("open_path_in_folder", { path: filePath }).catch((e: unknown) =>
              console.error("open_path_in_folder failed:", e)
            );
          },
        },
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    toast.error(`zip download failed: ${msg}`);
  }
}

export function DownloadPlaylistZipBundleButton(props: Props) {
  const [isDownloading, setIsDownloading] = createSignal(false);

  const handleClick = async () => {
    if (isDownloading()) return;
    setIsDownloading(true);
    try {
      await downloadPlaylistZipWithToast(props.playlist, props.songs, props.videos ?? []);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <button
      data-testid="btn-download-zip"
      title="download playlist as zip"
      disabled={isDownloading()}
      class="p-2 text-gray-400 hover:text-green-400 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={handleClick}
    >
      <Show when={!isDownloading()} fallback={<LoaderIcon size={16} className="animate-spin" />}>
        <DownloadZipIcon size={16} />
      </Show>
    </button>
  );
}
