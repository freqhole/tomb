import type { AdminDataConfig } from "../../../hooks/useAdminData.js";
import type { AdminSong } from "../../admin/admin-api.js";
import { MusicListResponseSchema } from "../../admin/admin-api.js";

/**
 * Music-specific admin configuration
 */
export const musicAdminConfig: AdminDataConfig = {
  apiEndpoint: "/api/media/songs",
  defaultFilters: {
    // No filters by default - show all songs
  },
  defaultPagination: {
    page: 1,
    page_size: 100,
  },
  defaultSort: {
    field: "created_at",
    direction: "desc",
  },
  responseSchema: MusicListResponseSchema,
  debounceMs: 300,
  autoFetch: false, // Disable auto-fetch, AdminView will call fetchData manually
};

/**
 * Music admin grid column configurations
 */
export interface MusicGridColumn {
  key: keyof AdminSong | "actions" | "select";
  title: string;
  width?: number;
  sortable?: boolean;
  filterable?: boolean;
  editable?: boolean;
  visible?: boolean;
  resizable?: boolean;
}

export const musicGridColumns: MusicGridColumn[] = [
  {
    key: "select",
    title: "",
    width: 40,
    sortable: false,
    filterable: false,
    editable: false,
    visible: true,
    resizable: false,
  },
  {
    key: "thumbnail_blob_id",
    title: "artwork",
    width: 60,
    sortable: false,
    filterable: false,
    editable: false,
    visible: true,
    resizable: false,
  },
  {
    key: "title",
    title: "title",
    width: 250,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "artist",
    title: "artist",
    width: 200,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "album",
    title: "album",
    width: 200,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "duration_seconds",
    title: "duration",
    width: 80,
    sortable: true,
    filterable: false,
    editable: false,
    visible: true,
    resizable: false,
  },
  {
    key: "year",
    title: "year",
    width: 80,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: false,
  },
  {
    key: "genre",
    title: "genre",
    width: 150,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "rating",
    title: "rating",
    width: 100,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: false,
  },
  {
    key: "is_favorite",
    title: "favorite",
    width: 80,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: false,
  },
  {
    key: "tags",
    title: "tags",
    width: 200,
    sortable: false,
    filterable: true,
    editable: true,
    visible: false, // Hidden by default
    resizable: true,
  },
  {
    key: "bpm",
    title: "bpm",
    width: 80,
    sortable: true,
    filterable: false,
    editable: true,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "key_signature",
    title: "key",
    width: 80,
    sortable: true,
    filterable: false,
    editable: true,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "file_format",
    title: "format",
    width: 80,
    sortable: true,
    filterable: true,
    editable: false,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "file_size",
    title: "size",
    width: 80,
    sortable: true,
    filterable: false,
    editable: false,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "created_at",
    title: "added",
    width: 150,
    sortable: true,
    filterable: false,
    editable: false,
    visible: true,
    resizable: true,
  },
  {
    key: "actions",
    title: "actions",
    width: 120,
    sortable: false,
    filterable: false,
    editable: false,
    visible: true,
    resizable: false,
  },
];

/**
 * Default visible columns for different view modes
 */
export const defaultColumnVisibility = {
  compact: [
    "select",
    "thumbnail_blob_id",
    "title",
    "artist",
    "duration_seconds",
    "actions",
  ],
  standard: [
    "select",
    "thumbnail_blob_id",
    "title",
    "artist",
    "album",
    "duration_seconds",
    "year",
    "rating",
    "is_favorite",
    "created_at",
    "actions",
  ],
  detailed: [
    "select",
    "thumbnail_blob_id",
    "title",
    "artist",
    "album",
    "duration_seconds",
    "year",
    "genre",
    "rating",
    "is_favorite",
    "tags",
    "file_format",
    "created_at",
    "actions",
  ],
};

/**
 * Music-specific filter options
 */
export const musicFilterOptions = {
  sortFields: [
    { value: "title", label: "title" },
    { value: "artist", label: "artist" },
    { value: "album", label: "album" },
    { value: "year", label: "year" },
    { value: "genre", label: "genre" },
    { value: "rating", label: "rating" },
    { value: "duration_seconds", label: "duration" },
    { value: "created_at", label: "date added" },
    { value: "updated_at", label: "date modified" },
  ],

  ratingOptions: [
    { value: 0, label: "no rating" },
    { value: 1, label: "1 star" },
    { value: 2, label: "2 stars" },
    { value: 3, label: "3 stars" },
    { value: 4, label: "4 stars" },
    { value: 5, label: "5 stars" },
  ],

  favoriteOptions: [
    { value: true, label: "favorites only" },
    { value: false, label: "non-favorites only" },
  ],

  thumbnailOptions: [
    { value: true, label: "has artwork" },
    { value: false, label: "no artwork" },
  ],
};

/**
 * Music validation rules for inline editing
 */
export const musicValidationRules = {
  title: {
    required: true,
    minLength: 1,
    maxLength: 500,
    message: "title is required and must be 1-500 characters",
  },
  artist: {
    required: false,
    maxLength: 200,
    message: "artist name must be 200 characters or less",
  },
  album: {
    required: false,
    maxLength: 200,
    message: "album name must be 200 characters or less",
  },
  year: {
    required: false,
    min: 1900,
    max: new Date().getFullYear() + 1,
    message: `year must be between 1900 and ${new Date().getFullYear() + 1}`,
  },
  rating: {
    required: false,
    min: 0,
    max: 5,
    message: "rating must be between 0 and 5",
  },
  bpm: {
    required: false,
    min: 30,
    max: 300,
    message: "bpm must be between 30 and 300",
  },
  genre: {
    required: false,
    maxLength: 100,
    message: "genre must be 100 characters or less",
  },
  key_signature: {
    required: false,
    pattern: /^[A-G][#b]?m?$/,
    message: "key signature must be in format like 'C', 'C#', 'Dm', etc.",
  },
};

/**
 * Keyboard shortcuts for music admin interface
 */
export const musicKeyboardShortcuts = {
  // Global shortcuts
  "ctrl+a": "selectAll",
  escape: "clearSelection",
  delete: "deleteSelected",
  "ctrl+f": "focusSearch",
  "ctrl+r": "refresh",

  // Playback shortcuts
  space: "togglePlayback",
  "ctrl+right": "nextTrack",
  "ctrl+left": "prevTrack",

  // Rating shortcuts
  "1": "setRating1",
  "2": "setRating2",
  "3": "setRating3",
  "4": "setRating4",
  "5": "setRating5",
  "0": "clearRating",

  // Favorites
  f: "toggleFavorite",

  // View modes
  "ctrl+1": "compactView",
  "ctrl+2": "standardView",
  "ctrl+3": "detailedView",

  // Bulk operations
  "ctrl+shift+e": "bulkEdit",
  "ctrl+shift+t": "bulkTag",
  "ctrl+shift+r": "bulkRate",
};

/**
 * Context menu options for music items
 */
export const musicContextMenuOptions = [
  { id: "play", label: "play", icon: "play", shortcut: "Space" },
  { id: "addToQueue", label: "add to queue", icon: "queue" },
  { separator: true },
  {
    id: "toggleFavorite",
    label: "toggle favorite",
    icon: "star",
    shortcut: "F",
  },
  { id: "rate", label: "rate...", icon: "star-outline" },
  { separator: true },
  { id: "edit", label: "edit", icon: "edit", shortcut: "Enter" },
  { id: "editTags", label: "edit tags", icon: "tag" },
  { id: "viewDetails", label: "view details", icon: "info" },
  { separator: true },
  { id: "addToPlaylist", label: "add to playlist", icon: "playlist" },
  { id: "exportMetadata", label: "export metadata", icon: "download" },
  { separator: true },
  {
    id: "delete",
    label: "delete",
    icon: "trash",
    shortcut: "Delete",
    dangerous: true,
  },
];

/**
 * Bulk operation options
 */
export const bulkOperationOptions = [
  { id: "rate", label: "set rating", icon: "star" },
  { id: "favorite", label: "toggle favorite", icon: "heart" },
  { id: "genre", label: "set genre", icon: "tag" },
  { id: "year", label: "set year", icon: "calendar" },
  { id: "tags", label: "manage tags", icon: "tags" },
  { id: "playlist", label: "add to playlist", icon: "playlist" },
  { id: "export", label: "export", icon: "download" },
  { id: "delete", label: "delete", icon: "trash", dangerous: true },
];
