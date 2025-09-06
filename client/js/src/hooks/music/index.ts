// Music hooks exports
export { createMusicUserData } from "./useMusicUserData.js";
export type { MusicUserData } from "./useMusicUserData.js";

export {
  MusicUserProvider,
  useMusicUser,
  useMusicUserPreferences,
  useMusicUserShortcuts,
  useMusicUserFilters,
} from "./MusicUserContext.js";

// Admin hooks (existing)
export { createMusicAdminData } from "./admin/useMusicAdminData.js";
export type { MusicAdminData } from "./admin/useMusicAdminData.js";
export { useMusicSearch } from "./admin/useMusicSearch.js";
