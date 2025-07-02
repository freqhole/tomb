//! Domain Configurations
//!
//! This module defines the configuration for different sync domains (music, photos,
//! documents, videos). Each domain has its own API endpoints, data transforms,
//! and binary handling rules.

import type {
  DomainConfig,
  SyncDomain,
  DomainEndpoints,
  BinaryConfig,
  DataTransforms,
  SyncDomainOptions,
} from "./types.js";

/**
 * Music domain configuration
 */
const MUSIC_CONFIG: DomainConfig = {
  domain: "music",
  endpoints: {
    list: "/api/media/songs",
    item: "/api/media/songs/{id}",
    sync: "/api/sync/songs",
    binary: "/api/blobs/{blob_id}",
  },
  defaultOptions: {
    pageSize: 50,
    includeBinaryData: true,
    forceFullSync: false,
  },
  binaryConfig: {
    priorityMimeTypes: ["audio/", "image/"],
    maxFileSize: 50 * 1024 * 1024, // 50MB for audio files
    batchSize: 3, // Process 3 binary items at a time
  },
  transforms: {
    fromApi: (data: any) => ({
      id: data.id,
      name: data.name,
      artist: data.artist,
      album: data.album,
      duration: data.duration,
      blob_id: data.blob_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      metadata: data.metadata || {},
    }),
    toStorage: (data: any) => ({
      ...data,
      _sync_version: 1,
      _last_modified: new Date().toISOString(),
    }),
    fromStorage: (data: any) => {
      const { _sync_version, _last_modified, _domain, _stored_at, ...item } =
        data;
      return item;
    },
  },
};

/**
 * Photos domain configuration
 */
const PHOTOS_CONFIG: DomainConfig = {
  domain: "photos",
  endpoints: {
    list: "/api/photos",
    item: "/api/photos/{id}",
    sync: "/api/sync/photos",
    binary: "/api/blobs/{blob_id}",
  },
  defaultOptions: {
    pageSize: 100,
    includeBinaryData: true,
    forceFullSync: false,
  },
  binaryConfig: {
    priorityMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxFileSize: 20 * 1024 * 1024, // 20MB for photos
    batchSize: 5, // Process 5 photos at a time
  },
  transforms: {
    fromApi: (data: any) => ({
      id: data.id,
      title: data.title,
      description: data.description,
      width: data.width,
      height: data.height,
      blob_id: data.blob_id,
      thumbnail_blob_id: data.thumbnail_blob_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      location: data.location,
      camera_info: data.camera_info,
      metadata: data.metadata || {},
    }),
    toStorage: (data: any) => ({
      ...data,
      _sync_version: 1,
      _last_modified: new Date().toISOString(),
    }),
    fromStorage: (data: any) => {
      const { _sync_version, _last_modified, _domain, _stored_at, ...item } =
        data;
      return item;
    },
  },
};

/**
 * Documents domain configuration
 */
const DOCUMENTS_CONFIG: DomainConfig = {
  domain: "documents",
  endpoints: {
    list: "/api/documents",
    item: "/api/documents/{id}",
    sync: "/api/sync/documents",
    binary: "/api/blobs/{blob_id}",
  },
  defaultOptions: {
    pageSize: 25,
    includeBinaryData: false, // Documents might be large, sync on-demand
    forceFullSync: false,
  },
  binaryConfig: {
    priorityMimeTypes: ["application/pdf", "text/", "application/msword"],
    maxFileSize: 100 * 1024 * 1024, // 100MB for documents
    batchSize: 2, // Process 2 documents at a time
  },
  transforms: {
    fromApi: (data: any) => ({
      id: data.id,
      title: data.title,
      content: data.content,
      author: data.author,
      mime_type: data.mime_type,
      file_size: data.file_size,
      blob_id: data.blob_id,
      version: data.version,
      created_at: data.created_at,
      updated_at: data.updated_at,
      tags: data.tags || [],
      metadata: data.metadata || {},
    }),
    toStorage: (data: any) => ({
      ...data,
      _sync_version: 1,
      _last_modified: new Date().toISOString(),
    }),
    fromStorage: (data: any) => {
      const { _sync_version, _last_modified, _domain, _stored_at, ...item } =
        data;
      return item;
    },
  },
};

/**
 * Videos domain configuration
 */
const VIDEOS_CONFIG: DomainConfig = {
  domain: "videos",
  endpoints: {
    list: "/api/videos",
    item: "/api/videos/{id}",
    sync: "/api/sync/videos",
    binary: "/api/blobs/{blob_id}",
  },
  defaultOptions: {
    pageSize: 20,
    includeBinaryData: false, // Videos are large, sync on-demand
    forceFullSync: false,
  },
  binaryConfig: {
    priorityMimeTypes: ["video/mp4", "video/webm", "image/"], // Include thumbnails
    maxFileSize: 500 * 1024 * 1024, // 500MB for videos
    batchSize: 1, // Process 1 video at a time
  },
  transforms: {
    fromApi: (data: any) => ({
      id: data.id,
      title: data.title,
      description: data.description,
      duration: data.duration,
      width: data.width,
      height: data.height,
      blob_id: data.blob_id,
      thumbnail_blob_id: data.thumbnail_blob_id,
      preview_blob_id: data.preview_blob_id,
      created_at: data.created_at,
      updated_at: data.updated_at,
      quality: data.quality,
      codec: data.codec,
      metadata: data.metadata || {},
    }),
    toStorage: (data: any) => ({
      ...data,
      _sync_version: 1,
      _last_modified: new Date().toISOString(),
    }),
    fromStorage: (data: any) => {
      const { _sync_version, _last_modified, _domain, _stored_at, ...item } =
        data;
      return item;
    },
  },
};

/**
 * Map of all domain configurations
 */
const DOMAIN_CONFIGS: Record<SyncDomain, DomainConfig> = {
  music: MUSIC_CONFIG,
  photos: PHOTOS_CONFIG,
  documents: DOCUMENTS_CONFIG,
  videos: VIDEOS_CONFIG,
};

/**
 * Create domain configurations with optional overrides
 */
export function createDomainConfigs(
  overrides?: Partial<Record<SyncDomain, Partial<DomainConfig>>>
): Record<SyncDomain, DomainConfig> {
  if (!overrides) {
    return { ...DOMAIN_CONFIGS };
  }

  const configs = { ...DOMAIN_CONFIGS };

  for (const [domain, override] of Object.entries(overrides)) {
    const domainKey = domain as SyncDomain;
    if (configs[domainKey]) {
      configs[domainKey] = {
        ...configs[domainKey],
        ...override,
        endpoints: {
          ...configs[domainKey].endpoints,
          ...override.endpoints,
        },
        defaultOptions: {
          ...configs[domainKey].defaultOptions,
          ...override.defaultOptions,
        },
        binaryConfig: override.binaryConfig
          ? {
              ...configs[domainKey].binaryConfig,
              ...override.binaryConfig,
            }
          : configs[domainKey].binaryConfig,
        transforms: {
          ...configs[domainKey].transforms,
          ...override.transforms,
        },
      };
    }
  }

  return configs;
}

/**
 * Get configuration for a specific domain
 */
export function getDomainConfig(domain: SyncDomain): DomainConfig {
  const config = DOMAIN_CONFIGS[domain];
  if (!config) {
    throw new Error(`Unknown domain: ${domain}`);
  }
  return config;
}

/**
 * Get default sync options for a domain
 */
export function getDefaultSyncOptions(domain: SyncDomain): SyncDomainOptions {
  return getDomainConfig(domain).defaultOptions;
}

/**
 * Get binary configuration for a domain
 */
export function getBinaryConfig(domain: SyncDomain): BinaryConfig | undefined {
  return getDomainConfig(domain).binaryConfig;
}

/**
 * Check if a domain supports binary data
 */
export function supportsBinaryData(domain: SyncDomain): boolean {
  return !!getDomainConfig(domain).binaryConfig;
}

/**
 * Get all supported domains
 */
export function getSupportedDomains(): SyncDomain[] {
  return Object.keys(DOMAIN_CONFIGS) as SyncDomain[];
}

/**
 * Validate domain configuration
 */
export function validateDomainConfig(config: DomainConfig): boolean {
  // Check required fields
  if (!config.domain || !config.endpoints || !config.transforms) {
    return false;
  }

  // Check endpoints
  const { list, item, sync } = config.endpoints;
  if (!list || !item || !sync) {
    return false;
  }

  // Check transforms
  const { fromApi, toStorage, fromStorage } = config.transforms;
  if (!fromApi || !toStorage || !fromStorage) {
    return false;
  }

  return true;
}

/**
 * Create a custom domain configuration
 */
export function createCustomDomainConfig(
  domain: SyncDomain,
  endpoints: DomainEndpoints,
  transforms: DataTransforms,
  options: {
    defaultOptions?: SyncDomainOptions;
    binaryConfig?: BinaryConfig;
  } = {}
): DomainConfig {
  return {
    domain,
    endpoints,
    transforms,
    defaultOptions: options.defaultOptions || {
      pageSize: 50,
      includeBinaryData: false,
      forceFullSync: false,
    },
    binaryConfig: options.binaryConfig,
  };
}
