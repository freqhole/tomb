import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { useAdminTransport } from "../../admin/context";

interface CookiesStatus {
  exists: boolean;
  path: string;
  data_dir: string;
  contents: string;
  ytdlp_path: string | null;
  /** the TARGET machine's os (not the wizard's own) - see
   * `grimoire::admin_dispatch::handlers::fetch_cookies::status`'s doc
   * comment for why this has to ride along in the same response rather
   * than coming from the wizard's own local `get_build_info`. */
  target_os: string;
}

/** browsers yt-dlp's `--cookies-from-browser` can read a live session from -
 * mirrors yt-dlp's own supported list (chrome/chromium/brave/edge/firefox/
 * opera/safari/vivaldi/whale), kept in sync by hand since yt-dlp has no
 * machine-readable manifest of this to generate it from. */
const BROWSERS = [
  "chrome",
  "firefox",
  "brave",
  "chromium",
  "edge",
  "opera",
  "safari",
  "vivaldi",
  "whale",
] as const;

type Browser = (typeof BROWSERS)[number];

/** flyout accordion: generate/view/edit/clear a `cookies.txt` for yt-dlp's
 * `--cookies` fallback, plus a copyable two-line command (cd into the data
 * dir, then yt-dlp itself, built from the configured yt-dlp path + a picked
 * browser) for how to export one directly into place. lives at the bottom
 * of settings' "advanced settings" section, next to `MediaBinariesSettings`
 * - both are rarely-touched yt-dlp-adjacent config. the cookies file itself
 * is only ever read/written here and by grimoire's `fetch_cookies` module
 * (data_dir/cookies.txt) - see `music::fetch::service::download_media`'s
 * doc comment for when it actually gets used (a one-shot retry after a
 * plain HTTP 403, and only when this file has real content).
 *
 * works against a remote target too (not just this wizard's own embedded
 * instance) - every read/write below goes through `useAdminTransport()`'s
 * `fetch_cookies_*` admin commands rather than a direct local-only tauri
 * `invoke()`, so switching the wizard's active admin target re-points this
 * panel at whichever machine's data_dir/cookies.txt that target actually
 * has. the export command's "PowerShell vs terminal" + yt-dlp path also
 * reflect the TARGET machine, not the wizard's own. */
export default function CookiesSettings() {
  const admin = useAdminTransport();

  const [loading, setLoading] = createSignal(true);
  const [path, setPath] = createSignal("");
  const [dataDir, setDataDir] = createSignal("");
  const [ytdlpPath, setYtdlpPath] = createSignal<string | null>(null);
  const [exists, setExists] = createSignal(false);
  const [initialContents, setInitialContents] = createSignal("");
  const [contents, setContents] = createSignal("");
  const [isWindows, setIsWindows] = createSignal(false);

  const [browser, setBrowser] = createSignal<Browser>("chrome");
  const [copied, setCopied] = createSignal(false);

  const [saving, setSaving] = createSignal(false);
  const [clearing, setClearing] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [isError, setIsError] = createSignal(false);

  const dirty = () => contents() !== initialContents();

  // fetches + populates status for the current admin target, always
  // clearing any previous message/error first - notably so a stale error
  // from a prior target (e.g. a remote that errored) never lingers once a
  // later target's own load succeeds. returns whether it succeeded, so
  // callers (reload()'s "reloaded from disk" message below) don't stomp a
  // real error with a false-positive success message.
  async function load(): Promise<boolean> {
    setMessage("");
    setIsError(false);
    try {
      const status = await admin.dispatchOrThrow<CookiesStatus>("fetch_cookies_status");
      setPath(status.path);
      setDataDir(status.data_dir);
      setYtdlpPath(status.ytdlp_path);
      setIsWindows(status.target_os === "windows");
      setExists(status.exists);
      setContents(status.contents);
      setInitialContents(status.contents);
      return true;
    } catch (e) {
      setMessage(String(e));
      setIsError(true);
      return false;
    }
  }

  // reload whenever the active admin target changes (incl. initial mount) -
  // mirrors FederationView.tsx's identical pattern for the same reason: a
  // local vs remote switch means an entirely different cookies.txt/data_dir.
  // `loading` (the full-panel fallback) is scoped to just this case, not to
  // the "reload from disk" button below - a manual reload keeps the form
  // visible and only flips its own button-level `reloading` state.
  createEffect(() => {
    admin.current();
    setLoading(true);
    void load().finally(() => setLoading(false));
  });

  async function reload() {
    setReloading(true);
    try {
      if (await load()) setMessage("reloaded from disk");
    } finally {
      setReloading(false);
    }
  }

  // `cd`s into the data dir first so the bare relative "cookies.txt" below
  // lands in exactly the place `fetch_cookies::cookies_path()` reads it back
  // from, rather than wherever the terminal happened to be. two separate
  // lines (not joined with `&&`/`;`) so pasting works unchanged whether the
  // user's on a POSIX shell or PowerShell - every shell runs pasted lines
  // sequentially either way. `--extractor-args youtubetab:skip=authcheck`
  // is yt-dlp's own suggested fix for a real error this exact invocation
  // otherwise hits (a cookie-bearing request to a youtube.com url it treats
  // as a channel/playlist "tab" triggers an unrelated auth-check warning
  // that can abort the run before cookies ever get written) - it only
  // affects this one-off export, never the app's own fetch calls.
  const exportCommand = createMemo(() => {
    const ytdlp = ytdlpPath() ?? "yt-dlp";
    return [
      `cd "${dataDir()}"`,
      `${ytdlp} --cookies-from-browser ${browser()} --extractor-args youtubetab:skip=authcheck --cookies cookies.txt "https://www.youtube.com/robots.txt"`,
    ];
  });

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(exportCommand().join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("failed to copy to clipboard:", e);
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    setIsError(false);
    try {
      await admin.dispatchOrThrow("fetch_cookies_save", { contents: contents() });
      setInitialContents(contents());
      setExists(contents().trim().length > 0);
      setMessage(contents().trim().length > 0 ? "saved" : "cleared (contents were blank)");
    } catch (e) {
      setMessage(String(e));
      setIsError(true);
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setClearing(true);
    setMessage("");
    setIsError(false);
    try {
      await admin.dispatchOrThrow("fetch_cookies_clear");
      setContents("");
      setInitialContents("");
      setExists(false);
      setMessage("cleared");
    } catch (e) {
      setMessage(String(e));
      setIsError(true);
    } finally {
      setClearing(false);
    }
  }

  return (
    <details class="flyout flyout--accent" style={{ "margin-top": "1.5rem" }}>
      <summary>yt-dlp fetch cookies</summary>

      <Show when={!loading()} fallback={<p class="help-text">loading...</p>}>
        <p class="help-text">
          some videoz (private/members-only/age- or sign-in-gated videos) fail to download. when
          that happens, fetching retries <strong>once, only after a failure,</strong> with a cookies
          file from your own logged-in browser session (never on an ordinary download). generate one
          below to enable; clear it to disable again.
        </p>

        <div class="form-row">
          <div class="form-group">
            <label for="cookies-browser">browser</label>
            <select
              id="cookies-browser"
              value={browser()}
              onChange={(e) => setBrowser(e.currentTarget.value as Browser)}
            >
              <For each={BROWSERS}>{(b) => <option value={b}>{b}</option>}</For>
            </select>
          </div>
        </div>

        <p class="help-text" style={{ "margin-bottom": "0.25rem" }}>
          run this in {isWindows() ? "PowerShell" : "a terminal"} (on a machine where you're logged
          in in that browser) - it writes <code>cookies.txt</code> directly into the data dir below,
          so hitting "reload" afterward is all that's left to do:
        </p>
        <div class="code-block">
          <For each={exportCommand()}>
            {(line) => <div style={{ "word-break": "break-all" }}>{line}</div>}
          </For>
        </div>
        <div class="section-actions" style={{ "margin-top": "0.5rem" }}>
          <button class="secondary small" onClick={() => void copyCommand()}>
            {copied() ? "copied!" : "copy command"}
          </button>
        </div>
        <Show when={!ytdlpPath()}>
          <p class="help-text" style={{ color: "var(--color-error-500, #ff4d6d)" }}>
            yt-dlp isn't configured yet (see "media binaries" above) - showing a bare "yt-dlp"
            placeholder until it is.
          </p>
        </Show>

        <div class="form-group" style={{ "margin-top": "1rem" }}>
          <label for="cookies-textarea">{exists() ? `${path()}` : "cookies.txt"} contents</label>
          <textarea
            id="cookies-textarea"
            rows={8}
            placeholder={"# Netscape HTTP Cookie File\n..."}
            value={contents()}
            onInput={(e) => setContents(e.currentTarget.value)}
            style={{ "font-family": "monospace", "font-size": "0.8125rem" }}
          />
        </div>

        <div class="section-actions" style={{ "margin-top": "0.75rem" }}>
          <button class="secondary" onClick={() => void reload()} disabled={reloading()}>
            {reloading() ? "reloading..." : "reload from disk"}
          </button>
          <button
            class="secondary"
            style={{ "margin-left": "0.5rem" }}
            onClick={() => void clear()}
            disabled={clearing() || !exists()}
          >
            {clearing() ? "clearing..." : "clear"}
          </button>
          <button
            style={{ "margin-left": "0.5rem" }}
            onClick={() => void save()}
            disabled={saving() || !dirty()}
          >
            {saving() ? "saving..." : "save"}
          </button>
        </div>

        <Show when={message()}>
          <p
            style={{
              color: isError()
                ? "var(--color-error-500, #ff4d6d)"
                : "var(--color-text-secondary, #888)",
              "font-size": "0.875rem",
              "margin-top": "0.5rem",
            }}
          >
            {message()}
          </p>
        </Show>
      </Show>
    </details>
  );
}
