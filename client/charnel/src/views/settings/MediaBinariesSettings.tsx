import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface DependencyCheckResult {
  ffmpeg_installed: boolean;
  ytdlp_installed: boolean;
}

interface BuildInfo {
  target_os: string;
}

interface BinaryValidationResult {
  path: string;
  version_info: string;
}

interface FfmpegValidationResult {
  ffmpeg: BinaryValidationResult;
  ffprobe: BinaryValidationResult | null;
}

/** advanced-settings subsection: lets the user manually point ffmpeg/yt-dlp
 * at a binary when they couldn't be found automatically (nonstandard
 * install location, PATH not inherited by a GUI-launched app, etc). only
 * rendered when at least one of the two is actually missing - each button
 * disappears once its binary is found/validated. not shown on android,
 * since there's no local server/config there to point at binaries. lives
 * in its own file so `SettingsView.tsx` doesn't keep growing (matches
 * `StorageSettings.tsx`/`ExternalStorageSettings.tsx`). */
export default function MediaBinariesSettings() {
  const [loading, setLoading] = createSignal(true);
  const [androidHidden, setAndroidHidden] = createSignal(false);
  const [isWindows, setIsWindows] = createSignal(false);
  const [ffmpegInstalled, setFfmpegInstalled] = createSignal(true);
  const [ytdlpInstalled, setYtdlpInstalled] = createSignal(true);

  const [ffmpegBusy, setFfmpegBusy] = createSignal(false);
  const [ffmpegMessage, setFfmpegMessage] = createSignal("");
  const [ffmpegIsError, setFfmpegIsError] = createSignal(false);

  const [ytdlpBusy, setYtdlpBusy] = createSignal(false);
  const [ytdlpMessage, setYtdlpMessage] = createSignal("");
  const [ytdlpIsError, setYtdlpIsError] = createSignal(false);

  onMount(async () => {
    try {
      const [deps, build] = await Promise.all([
        invoke<DependencyCheckResult>("check_dependencies"),
        invoke<BuildInfo>("get_build_info"),
      ]);
      if (build.target_os === "android") {
        setAndroidHidden(true);
        return;
      }
      setIsWindows(build.target_os === "windows");
      setFfmpegInstalled(deps.ffmpeg_installed);
      setYtdlpInstalled(deps.ytdlp_installed);
    } catch (e) {
      console.error("failed to load media binary status:", e);
    } finally {
      setLoading(false);
    }
  });

  async function pickFfmpeg() {
    setFfmpegBusy(true);
    setFfmpegMessage("");
    setFfmpegIsError(false);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "choose ffmpeg binary",
        filters: isWindows() ? [{ name: "ffmpeg", extensions: ["exe"] }] : undefined,
      });
      if (!selected) return;
      const result = await invoke<FfmpegValidationResult>("validate_and_set_ffmpeg_path", {
        path: selected as string,
      });
      setFfmpegInstalled(true);
      const ffprobeNote = result.ffprobe
        ? ` (also found and saved ffprobe: ${result.ffprobe.version_info})`
        : " (couldn't find/verify ffprobe next to it - duration extraction may be limited)";
      setFfmpegMessage(`saved - ${result.ffmpeg.version_info}${ffprobeNote}`);
    } catch (e) {
      setFfmpegMessage(String(e));
      setFfmpegIsError(true);
    } finally {
      setFfmpegBusy(false);
    }
  }

  async function pickYtdlp() {
    setYtdlpBusy(true);
    setYtdlpMessage("");
    setYtdlpIsError(false);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: "choose yt-dlp binary",
        filters: isWindows() ? [{ name: "yt-dlp", extensions: ["exe"] }] : undefined,
      });
      if (!selected) return;
      const result = await invoke<BinaryValidationResult>("validate_and_set_ytdlp_path", {
        path: selected as string,
      });
      setYtdlpInstalled(true);
      setYtdlpMessage(`saved - ${result.version_info}`);
    } catch (e) {
      setYtdlpMessage(String(e));
      setYtdlpIsError(true);
    } finally {
      setYtdlpBusy(false);
    }
  }

  return (
    <Show when={!loading() && !androidHidden() && (!ffmpegInstalled() || !ytdlpInstalled())}>
      <div style={{ "margin-top": "1.5rem" }}>
        <div style={{ "font-weight": "500" }}>media binaries</div>
        <p
          style={{
            "font-size": "0.875rem",
            color: "var(--color-text-secondary, #888)",
            "margin-top": "0.25rem",
            "margin-bottom": "0.75rem",
          }}
        >
          ffmpeg and/or yt-dlp couldn't be found automatically. if either is installed somewhere
          nonstandard, point at the binary directly below.
        </p>

        <Show when={!ffmpegInstalled()}>
          <div style={{ "margin-bottom": "1rem" }}>
            <button class="button" onClick={pickFfmpeg} disabled={ffmpegBusy()}>
              {ffmpegBusy() ? "checking..." : "select ffmpeg binary"}
            </button>
            <p
              style={{
                "font-size": "0.8125rem",
                color: "var(--color-text-secondary, #888)",
                margin: "0.35rem 0 0 0",
              }}
            >
              ffprobe will be inferred automatically from the same folder.
            </p>
            <Show when={ffmpegMessage()}>
              <div
                style={{
                  "font-size": "0.8125rem",
                  color: ffmpegIsError()
                    ? "var(--color-error-500, #ff4d6d)"
                    : "var(--color-text-secondary, #888)",
                  "margin-top": "0.5rem",
                }}
              >
                {ffmpegMessage()}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={!ytdlpInstalled()}>
          <div>
            <button class="button" onClick={pickYtdlp} disabled={ytdlpBusy()}>
              {ytdlpBusy() ? "checking..." : "select yt-dlp binary"}
            </button>
            <Show when={ytdlpMessage()}>
              <div
                style={{
                  "font-size": "0.8125rem",
                  color: ytdlpIsError()
                    ? "var(--color-error-500, #ff4d6d)"
                    : "var(--color-text-secondary, #888)",
                  "margin-top": "0.5rem",
                }}
              >
                {ytdlpMessage()}
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
