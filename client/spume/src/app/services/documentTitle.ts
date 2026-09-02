// shared browser/window title formatting - keeps the "freqhole ▸ ..."
// convention (see index.html's static <title>freqhole</title> for the
// base app name) in one place instead of duplicated per-layout.
import { isCharnelMode, setWindowTitle } from "./charnel";

const APP_NAME = "freqhole";

/**
 * set document.title (and the tauri window title, when running in
 * charnel/tauri mode) from an ordered list of segments, e.g.
 * `setAppDocumentTitle(["local", "album name"])` -> "freqhole ▸ local ▸ album name".
 * falsy/empty segments are dropped.
 */
export function setAppDocumentTitle(segments: Array<string | undefined | null>): void {
  const parts = [APP_NAME, ...segments.filter((s): s is string => !!s)];
  const title = parts.join(" ▸ ");
  document.title = title;
  if (isCharnelMode()) {
    void setWindowTitle(title);
  }
}
