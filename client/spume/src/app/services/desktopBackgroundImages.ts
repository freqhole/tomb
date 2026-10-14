// background_images_enabled (charnel config, desktop-only) - lets a
// desktop-charnel user turn off the blurred full-page backdrop behind
// playlist/album/artist/video-series detail views, mirroring spume's own
// `AppState.background_images_enabled` (web/android/ios, set via
// LocalLibrarySettingsView/StorageSettingsView). desktop doesn't surface
// those spume settings pages as the primary way to reach settings, so the
// wizard's own settings view controls this one instead - see
// `FreqholeAppConfig.background_images_enabled`'s doc comment. mirrors
// backdropBlur.ts's plain signal pattern.
import { createSignal } from "solid-js";

const [desktopBackgroundImagesEnabled, setDesktopBackgroundImagesEnabledSignal] =
  createSignal(true);

export function setDesktopBackgroundImagesEnabled(enabled: boolean) {
  setDesktopBackgroundImagesEnabledSignal(enabled);
}

export function getDesktopBackgroundImagesEnabled(): boolean {
  return desktopBackgroundImagesEnabled();
}
