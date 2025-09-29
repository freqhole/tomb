//! Audio Upload Service
//!
//! This service handles uploading audio files and managing music processing jobs,
//! including progress tracking, duplicate detection, and job status polling.

import { apiClient } from "../../../lib/api-client";

export interface UploadOptions {
  albumArtFor?: string;
  replaceDuplicate?: boolean;
}

export interface UploadResponse {
  id: string;
  local_path: string;
  sha256: string;
  size: number;
  mime_type?: string;
  created_at: string;
  job_id?: string;
}

export interface MusicJobStatusResponse {
  job_id: string;
  status: string;
  progress_percentage?: number;
  processing_step?: string;
  song_id?: string;
  error_message?: string;
  error_type?: string;
  can_retry: boolean;
  file_path: string;
  original_filename?: string;
  created_at: string;
  updated_at: string;
}

export interface CancelJobResponse {
  job_id: string;
  cancelled: boolean;
  message: string;
}

export interface DuplicateCheckResponse {
  exists: boolean;
  existing_song_id?: string;
  existing_blob_id?: string;
  original_filename?: string;
}

export class DuplicateFileError extends Error {
  constructor(public duplicateInfo: DuplicateCheckResponse) {
    super("File already exists");
    this.name = "DuplicateFileError";
  }
}

export class AudioUploadService {
  private authToken?: string;
  private pollingIntervals: Map<string, number> = new Map();

  constructor(authToken?: string) {
    this.authToken = authToken;
  }

  // Audio file extensions
  private readonly audioExtensions = [
    ".mp3",
    ".flac",
    ".wav",
    ".m4a",
    ".ogg",
    ".aac",
  ];

  /**
   * Calculate SHA256 hash of a file
   */
  private async calculateSHA256(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Check if a file is an audio file based on extension
   */
  private isAudioFile(file: File): boolean {
    return this.audioExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
  }

  /**
   * Check if a file with the given SHA256 hash already exists
   */
  async checkForDuplicate(sha256: string): Promise<DuplicateCheckResponse> {
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(
      `${apiClient.getBaseUrl()}/api/media_blob/check_duplicate/${sha256}`,
      {
        headers,
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to check for duplicates: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Upload a music file
   */
  async uploadMusicFile(
    file: File,
    options?: UploadOptions
  ): Promise<UploadResponse> {
    // Calculate SHA256 hash (client-side)
    const sha256 = await this.calculateSHA256(file);

    // Check for duplicates first (unless user chose to replace)
    if (!options?.replaceDuplicate) {
      const duplicateCheck = await this.checkForDuplicate(sha256);
      if (duplicateCheck.exists) {
        throw new DuplicateFileError(duplicateCheck);
      }
    }

    // Prepare upload request metadata
    const metadata: any = {
      process_music: this.isAudioFile(file),
      original_filename: file.name,
      replace_duplicate: options?.replaceDuplicate || false,
    };

    if (options?.albumArtFor) {
      metadata.album_art_for = options.albumArtFor;
    }

    const uploadRequest = {
      filename: file.name,
      mime_type: file.type,
      sha256: sha256,
      size: file.size,
      metadata,
    };

    // Create form data
    const formData = new FormData();
    formData.append("file", file);
    formData.append("metadata", JSON.stringify(uploadRequest));

    // Upload file
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(`${apiClient.getBaseUrl()}/api/upload`, {
      method: "POST",
      headers,
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get music job status
   */
  async getMusicJobStatus(jobId: string): Promise<MusicJobStatusResponse> {
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(
      `${apiClient.getBaseUrl()}/api/music_job_status/${jobId}`,
      {
        headers,
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get job status: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Cancel a music processing job
   */
  async cancelMusicJob(jobId: string): Promise<CancelJobResponse> {
    const headers: Record<string, string> = {};
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(
      `${apiClient.getBaseUrl()}/api/music_job_cancel/${jobId}`,
      {
        method: "POST",
        headers,
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to cancel job: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Start polling job status with a callback
   */
  startStatusPolling(
    jobId: string,
    callback: (status: MusicJobStatusResponse) => void,
    intervalMs: number = 2000
  ): void {
    // Clear any existing polling for this job
    this.stopStatusPolling(jobId);

    const poll = async () => {
      try {
        const status = await this.getMusicJobStatus(jobId);
        callback(status);

        // Stop polling if job is completed, failed, or cancelled
        if (
          ["completed", "failed", "failed_permanently", "cancelled"].includes(
            status.status
          )
        ) {
          this.stopStatusPolling(jobId);
        }
      } catch (error) {
        console.error(`Failed to poll job status for ${jobId}:`, error);
        // Continue polling even on error, but notify callback with error
        callback({
          job_id: jobId,
          status: "error",
          can_retry: true,
          file_path: "",
          created_at: "",
          updated_at: "",
          error_message:
            error instanceof Error ? error.message : "Unknown error",
        });
      }
    };

    // Start polling
    const intervalId = window.setInterval(poll, intervalMs);
    this.pollingIntervals.set(jobId, intervalId);

    // Initial poll
    poll();
  }

  /**
   * Stop polling job status
   */
  stopStatusPolling(jobId: string): void {
    const intervalId = this.pollingIntervals.get(jobId);
    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(jobId);
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling(): void {
    for (const [jobId] of this.pollingIntervals) {
      this.stopStatusPolling(jobId);
    }
  }

  /**
   * Check if a file is a supported audio format
   */
  isValidAudioFile(file: File): boolean {
    return this.isAudioFile(file);
  }

  /**
   * Check if a file is a supported image format
   */
  isValidImageFile(file: File): boolean {
    return file.type.startsWith("image/");
  }

  /**
   * Validate file before upload
   */
  validateFile(file: File): { valid: boolean; error?: string } {
    const maxSize = 1024 * 1024 * 1024; // 1GB

    if (file.size > maxSize) {
      return { valid: false, error: "File exceeds 1GB limit" };
    }

    const isAudio = this.isValidAudioFile(file);
    const isImage = this.isValidImageFile(file);

    if (!isAudio && !isImage) {
      return {
        valid: false,
        error:
          "Unsupported file type. Please upload audio files (mp3, flac, wav, m4a, ogg, aac) or images (jpg, png, gif, webp)",
      };
    }

    return { valid: true };
  }
}

// Default export for convenience
export default AudioUploadService;
