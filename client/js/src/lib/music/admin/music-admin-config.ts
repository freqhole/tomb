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
    title: "Artwork",
    width: 60,
    sortable: false,
    filterable: false,
    editable: false,
    visible: true,
    resizable: false,
  },
  {
    key: "title",
    title: "Title",
    width: 250,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "artist",
    title: "Artist",
    width: 200,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "album",
    title: "Album",
    width: 200,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "duration_seconds",
    title: "Duration",
    width: 80,
    sortable: true,
    filterable: false,
    editable: false,
    visible: true,
    resizable: false,
  },
  {
    key: "year",
    title: "Year",
    width: 80,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: false,
  },
  {
    key: "genre",
    title: "Genre",
    width: 150,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: true,
  },
  {
    key: "rating",
    title: "Rating",
    width: 100,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: false,
  },
  {
    key: "is_favorite",
    title: "Favorite",
    width: 80,
    sortable: true,
    filterable: true,
    editable: true,
    visible: true,
    resizable: false,
  },
  {
    key: "tags",
    title: "Tags",
    width: 200,
    sortable: false,
    filterable: true,
    editable: true,
    visible: false, // Hidden by default
    resizable: true,
  },
  {
    key: "bpm",
    title: "BPM",
    width: 80,
    sortable: true,
    filterable: false,
    editable: true,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "key_signature",
    title: "Key",
    width: 80,
    sortable: true,
    filterable: false,
    editable: true,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "file_format",
    title: "Format",
    width: 80,
    sortable: true,
    filterable: true,
    editable: false,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "file_size",
    title: "Size",
    width: 80,
    sortable: true,
    filterable: false,
    editable: false,
    visible: false, // Hidden by default
    resizable: false,
  },
  {
    key: "created_at",
    title: "Added",
    width: 150,
    sortable: true,
    filterable: false,
    editable: false,
    visible: true,
    resizable: true,
  },
  {
    key: "actions",
    title: "Actions",
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
    { value: "title", label: "Title" },
    { value: "artist", label: "Artist" },
    { value: "album", label: "Album" },
    { value: "year", label: "Year" },
    { value: "genre", label: "Genre" },
    { value: "rating", label: "Rating" },
    { value: "duration_seconds", label: "Duration" },
    { value: "created_at", label: "Date Added" },
    { value: "updated_at", label: "Date Modified" },
  ],

  ratingOptions: [
    { value: 0, label: "No Rating" },
    { value: 1, label: "1 Star" },
    { value: 2, label: "2 Stars" },
    { value: 3, label: "3 Stars" },
    { value: 4, label: "4 Stars" },
    { value: 5, label: "5 Stars" },
  ],

  favoriteOptions: [
    { value: true, label: "Favorites Only" },
    { value: false, label: "Non-Favorites Only" },
  ],

  thumbnailOptions: [
    { value: true, label: "Has Artwork" },
    { value: false, label: "No Artwork" },
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
    message: "Title is required and must be 1-500 characters",
  },
  artist: {
    required: false,
    maxLength: 200,
    message: "Artist name must be 200 characters or less",
  },
  album: {
    required: false,
    maxLength: 200,
    message: "Album name must be 200 characters or less",
  },
  year: {
    required: false,
    min: 1900,
    max: new Date().getFullYear() + 1,
    message: `Year must be between 1900 and ${new Date().getFullYear() + 1}`,
  },
  rating: {
    required: false,
    min: 0,
    max: 5,
    message: "Rating must be between 0 and 5",
  },
  bpm: {
    required: false,
    min: 30,
    max: 300,
    message: "BPM must be between 30 and 300",
  },
  genre: {
    required: false,
    maxLength: 100,
    message: "Genre must be 100 characters or less",
  },
  key_signature: {
    required: false,
    pattern: /^[A-G][#b]?m?$/,
    message: "Key signature must be in format like 'C', 'C#', 'Dm', etc.",
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
  { id: "play", label: "Play", icon: "play", shortcut: "Space" },
  { id: "addToQueue", label: "Add to Queue", icon: "queue" },
  { separator: true },
  {
    id: "toggleFavorite",
    label: "Toggle Favorite",
    icon: "star",
    shortcut: "F",
  },
  { id: "rate", label: "Rate...", icon: "star-outline" },
  { separator: true },
  { id: "edit", label: "Edit", icon: "edit", shortcut: "Enter" },
  { id: "editTags", label: "Edit Tags", icon: "tag" },
  { id: "viewDetails", label: "View Details", icon: "info" },
  { separator: true },
  { id: "addToPlaylist", label: "Add to Playlist", icon: "playlist" },
  { id: "exportMetadata", label: "Export Metadata", icon: "download" },
  { separator: true },
  {
    id: "delete",
    label: "Delete",
    icon: "trash",
    shortcut: "Delete",
    dangerous: true,
  },
];

/**
 * Bulk operation options
 */
export const bulkOperationOptions = [
  { id: "rate", label: "Set Rating", icon: "star" },
  { id: "favorite", label: "Toggle Favorite", icon: "heart" },
  { id: "genre", label: "Set Genre", icon: "tag" },
  { id: "year", label: "Set Year", icon: "calendar" },
  { id: "tags", label: "Manage Tags", icon: "tags" },
  { id: "playlist", label: "Add to Playlist", icon: "playlist" },
  { id: "export", label: "Export", icon: "download" },
  { id: "delete", label: "Delete", icon: "trash", dangerous: true },
];
